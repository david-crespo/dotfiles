#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=osascript,ai,ghostty-tab-title

// Keeps Ghostty tab titles stable across split panes and agent sessions.
//
// # Data model
//
// There are two layers: persistent state on disk, and the tab's actual title as
// rendered by Ghostty. Every tab title write goes through a helper that reads
// the latest session state right before rendering, so concurrent writers (async
// summarizer vs. sync state hooks) don't produce stale combinations.
//
// Ghostty terminology: a "terminal" is a single pane. Tabs contain one or more
// terminals; splitting a tab creates a second terminal in it. Both terminal ids
// and tab ids are stable for the lifetime of their objects — what changes
// across a pane drag is which tab contains which terminal, not the ids
// themselves. We pin terminals (not tabs) because a Claude session is anchored
// to the pane it was launched in, and look up the current tab at render time.
//
// Consequence: two Claudes in split panes of the same tab both try to drive
// the single tab title. Most-recent-write wins; not a great experience but
// acceptable for now. A tab-level lock would be the real fix.
//
// Disk state, under $STATE_ROOT (~/.local/state/ghostty-tab-titles). The
// <session_id> in paths below is the agent's own session UUID, passed on
// every hook invocation and stable from SessionStart through SessionEnd:
//   - sessions/<session_id>: JSON { terminalId, label, state?, summary? }
//       - label:   stable base string pinned at SessionStart (e.g. "dotfiles")
//       - state:   latest state indicator from hooks ("🌀" | "")
//       - summary: async-generated label suffix, refreshed on UserPromptSubmit
//   - terminal-sessions/<terminal_id>: session_id currently running in this
//     pane. Acts as a reverse index (terminal_id → session_id) so the shell
//     path can cheaply answer "is an agent alive in this pane?" without
//     scanning every session file. The shell uses this to avoid overwriting
//     the agent's tab title from chpwd. SessionEnd or an explicit release uses
//     it to decide whether to reset the title back to the base label. It does
//     NOT arbitrate between concurrent agents in one pane.
//
// Env vars, read from the shell / agent process:
//   - GHOSTTY_TERMINAL_ID:    terminal id captured by `shell` at zsh startup,
//                             inherited into the agent so SessionStart doesn't
//                             have to re-guess the frontmost pane.
//   - GHOSTTY_TAB_BASE_LABEL: label the shell would like to use for the tab.
//                             Preferred over the abbreviated cwd at SessionStart.
//
// Tab-title rendering: `joinTitle(label, state, summary)` →
//   "{state} {label} | {summary}" with empty pieces omitted.
//
// # Commands
//
//   - shell:     run from .zshrc. Emits `export GHOSTTY_TERMINAL_ID=...` on stdout
//                and (on a fresh, Claude-free, unsplit tab) writes the base label.
//   - pane-count: synchronously snapshot a shell's tab pane count before an async
//                 chpwd title update, so a subsequent split cannot change the decision.
//   - hook:      run from agent hooks (SessionStart, UserPromptSubmit, Stop,
//                SessionEnd). Updates disk state and tab title synchronously.
//   - detach:    run a subcommand detached from a synchronous hook.
//   - summarize: UserPromptSubmit hook worker. Calls `ai` on recent messages to
//                refresh the `summary` field, then re-renders the tab using the
//                session's current `state` (so it doesn't overwrite a Stop that
//                raced ahead of the LLM call).
//   - release:   reset and remove the session associated with this terminal.
//                Used by the Codex shell wrapper because Codex has no SessionEnd.
//
// # Fragilities
//
// Ghostty's AppleScript dictionary exposes each terminal's controlling tty, so
// at shell startup we match our own $TTY against `tty of terminal` to find our
// pane exactly — no dependency on which tab happens to be frontmost. This
// matters most on restart: with window-save-state=always, Ghostty respawns
// every pane's shell roughly at once, and a "focused terminal of front window"
// guess would resolve all of them to the single front tab, pinning many
// sessions to one pane. The tty match is immune to that.
//
// Remaining fragility: the SessionStart fallback (when GHOSTTY_TERMINAL_ID is
// unset and no tty was captured, e.g. claude launched from a non-Ghostty shell)
// still guesses the frontmost pane, since the hook has no tty to match on.

import { Command, ValidationError } from "@cliffy/command"
import $ from "@david/dax"
import { join } from "@std/path"

$.setErrorTail(true)

const TAB_INFO_SEP = "|||"
const STATE_ROOT = join(
  Deno.env.get("XDG_STATE_HOME") ?? join(Deno.env.get("HOME")!, ".local", "state"),
  "ghostty-tab-titles",
)
const TERMINAL_SESSION_DIR = join(STATE_ROOT, "terminal-sessions")
const SESSION_DIR = join(STATE_ROOT, "sessions")
const LOG_PATH = join(STATE_ROOT, "events.jsonl")

const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "SessionEnd",
] as const
type HookEventName = typeof HOOK_EVENTS[number]
const HOOK_EVENT_SET = new Set<HookEventName>(HOOK_EVENTS)

interface HookInput {
  hookEventName: HookEventName
  sessionId?: string
  cwd?: string
  prompt?: string
  transcriptPath?: string
}

interface SessionState {
  terminalId: string
  label: string
  cwd?: string
  state?: string
  summary?: string
}

interface FrontTerminalInfo {
  terminalId: string
  terminalCount: number
}

const STALE_MS = 7 * 24 * 60 * 60 * 1000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function logEvent(event: string, details: Record<string, unknown> = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    pid: Deno.pid,
    event,
    ...details,
  })
  await Deno.mkdir(STATE_ROOT, { recursive: true }).catch(() => {})
  await Deno.writeTextFile(LOG_PATH, `${entry}\n`, { append: true }).catch(() => {})
}

// List regular files in `dir` with their stats. Stats run concurrently;
// missing dir or stat failures are skipped so callers don't need try/catch.
async function listFiles(
  dir: string,
): Promise<{ name: string; path: string; stat: Deno.FileInfo }[]> {
  const entries = await Array.fromAsync(Deno.readDir(dir))
    .catch(() => [] as Deno.DirEntry[])
  return (await Promise.all(
    entries.filter((e) => e.isFile).map(async (e) => {
      const path = join(dir, e.name)
      const stat = await Deno.stat(path).catch(() => undefined)
      return stat ? { name: e.name, path, stat } : undefined
    }),
  )).filter((x) => x !== undefined)
}

async function sweepStale(dir: string) {
  const cutoff = Date.now() - STALE_MS
  for (const { path, stat } of await listFiles(dir)) {
    if (stat.mtime && stat.mtime.getTime() < cutoff) {
      await Deno.remove(path).catch(() => {})
    }
  }
}

async function ensureStateDirs() {
  await Promise.all([
    Deno.mkdir(TERMINAL_SESSION_DIR, { recursive: true }),
    Deno.mkdir(SESSION_DIR, { recursive: true }),
  ])
  await Promise.all([sweepStale(TERMINAL_SESSION_DIR), sweepStale(SESSION_DIR)])
}

function sanitizeTitle(title: string): string {
  // deno-lint-ignore no-control-regex
  return title.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function joinTitle(label: string, state?: string, summary?: string): string {
  const prefix = state ? `${state} ` : ""
  const suffix = summary ? ` | ${summary}` : ""
  return `${prefix}${label}${suffix}`
}

function abbreviatePath(path: string): string {
  const home = Deno.env.get("HOME")
  if (!home) return path

  for (const dir of ["repos", "oxide", "jj-workspaces"]) {
    const prefix = `${home}/${dir}/`
    if (path.startsWith(prefix)) return path.slice(prefix.length)
  }

  if (path === home) return "~"
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`

  return path
}

function parseHookInput(input: string): HookInput | undefined {
  if (!input) return undefined
  try {
    const raw = JSON.parse(input) as Record<string, unknown>
    const name = raw.hook_event_name
    if (typeof name !== "string" || !HOOK_EVENT_SET.has(name as HookEventName)) {
      return undefined
    }
    const str = (v: unknown) => typeof v === "string" ? v : undefined
    return {
      hookEventName: name as HookEventName,
      sessionId: str(raw.session_id),
      cwd: str(raw.cwd),
      prompt: str(raw.prompt),
      transcriptPath: str(raw.transcript_path),
    }
  } catch {
    return undefined
  }
}

async function currentFrontTerminalInfo(): Promise<FrontTerminalInfo | undefined> {
  const script = `
tell application "Ghostty"
  if (count of windows) is 0 then
    return ""
  end if

  set targetTab to selected tab of front window
  set targetTerminal to focused terminal of targetTab
  return (id of targetTerminal as text) & "${TAB_INFO_SEP}" & (count of terminals of targetTab as text)
end tell
`
  const raw = (await $`osascript -e ${script}`.quiet().text().catch(async (error) => {
    await logEvent("front_terminal_lookup_failed", { error: errorMessage(error) })
    return ""
  })).trim()
  if (!raw) return undefined

  const [terminalId, terminalCountText] = raw.split(TAB_INFO_SEP)
  const terminalCount = Number.parseInt(terminalCountText ?? "", 10)
  if (!terminalId || Number.isNaN(terminalCount)) return undefined

  return { terminalId, terminalCount }
}

// Resolve the terminal whose controlling tty matches `tty` (e.g. /dev/ttys035),
// returning its stable id and the pane count of its tab. Matching on tty pins
// the shell to its own pane regardless of which tab is frontmost, which is what
// makes capture correct when many shells start at once (Ghostty restore).
async function setInitialTitleForTty(
  tty: string,
  title: string,
): Promise<FrontTerminalInfo | undefined> {
  const script = `
on run argv
  set targetTty to item 1 of argv
  set newTitle to item 2 of argv
  tell application "Ghostty"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        repeat with targetTerminal in terminals of targetTab
          if (tty of targetTerminal as text) is targetTty then
            set terminalId to id of targetTerminal as text
            set terminalCount to count of terminals of targetTab
            if terminalCount is equal to 1 then
              perform action ("set_tab_title:" & newTitle) on targetTerminal
              return terminalId & "${TAB_INFO_SEP}" & (terminalCount as text) & "${TAB_INFO_SEP}set"
            end if
            return terminalId & "${TAB_INFO_SEP}" & (terminalCount as text) & "${TAB_INFO_SEP}skipped"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return ""
end run
`
  const raw =
    (await $`osascript -e ${script} ${[tty, title]}`.quiet().text().catch(async (error) => {
      await logEvent("initial_title_failed", { tty, title, error: errorMessage(error) })
      return ""
    })).trim()
  if (!raw) return undefined

  const [terminalId, terminalCountText, status] = raw.split(TAB_INFO_SEP)
  const terminalCount = Number.parseInt(terminalCountText ?? "", 10)
  if (
    !terminalId || Number.isNaN(terminalCount) ||
    (status !== "set" && status !== "skipped")
  ) {
    await logEvent("initial_title_invalid_result", { tty, title, raw })
    return undefined
  }

  const titleSet = status === "set"
  await logEvent(titleSet ? "title_set" : "shell_skipped", {
    tty,
    terminalId,
    terminalCount,
    title,
    ...(titleSet ? {} : { reason: "not_single_pane" }),
  })
  return { terminalId, terminalCount }
}

// Find the tab containing `terminalId` and return how many panes are in it.
// Used by the chpwd path to decide whether the cwd change should drive the tab
// title — we only want to retitle on cd when this terminal is the only pane.
async function paneCountForTerminal(terminalId: string): Promise<number | undefined> {
  const script = `
on run argv
  set targetTerminalId to item 1 of argv
  tell application "Ghostty"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        repeat with targetTerminal in terminals of targetTab
          if (id of targetTerminal as text) is targetTerminalId then
            return (count of terminals of targetTab as text)
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return ""
end run
`
  const raw = (await $`osascript -e ${script} ${[terminalId]}`.quiet().text().catch(
    async (error) => {
      await logEvent("pane_count_failed", { terminalId, error: errorMessage(error) })
      return ""
    },
  )).trim()
  if (!raw) return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? undefined : n
}

// Set the title of the tab currently containing `terminalId`. The tab may
// differ from the one captured at SessionStart if the pane has been moved.
//
// We perform the action on the matched terminal itself, not on
// `focused terminal of targetTab`. `set_tab_title` routes the title to the
// target surface's window controller, and the matched terminal is by
// construction a member of targetTab, so this hits the right tab with no
// dependency on Ghostty's focused-surface tracking — which can be transiently
// stale after dragging a pane between tabs and would otherwise land the title
// on whatever tab the stale focused surface now lives in.
async function setTabTitleByTerminal(terminalId: string, title: string) {
  const script = `
on run argv
  set targetTerminalId to item 1 of argv
  set newTitle to item 2 of argv

  tell application "Ghostty"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        repeat with targetTerminal in terminals of targetTab
          if (id of targetTerminal as text) is targetTerminalId then
            perform action ("set_tab_title:" & newTitle) on targetTerminal
            return "set"
          end if
        end repeat
      end repeat
    end repeat
  end tell
end run
`
  const result =
    (await $`osascript -e ${script} ${[terminalId, title]}`.quiet().text().catch(
      async (error) => {
        await logEvent("title_set_failed", {
          terminalId,
          title,
          error: errorMessage(error),
        })
        return "error"
      },
    )).trim()
  if (result !== "error") {
    await logEvent(result === "set" ? "title_set" : "terminal_not_found", {
      terminalId,
      title,
    })
  }
}

// Returns the session_id of the Claude currently running in this pane, or
// undefined if none. Stale index entries (empty file, or pointing at a session
// that no longer exists) are cleaned up on read.
async function sessionForTerminal(terminalId: string): Promise<string | undefined> {
  const indexFile = join(TERMINAL_SESSION_DIR, terminalId)
  const sessionId = await Deno.readTextFile(indexFile).then((s) => s.trim()).catch(() => "")
  if (!sessionId) {
    await Deno.remove(indexFile).catch(() => {})
    return undefined
  }

  const sessionExists = await Deno.stat(join(SESSION_DIR, sessionId)).then(() => true)
    .catch(
      () => false,
    )
  if (!sessionExists) {
    await Deno.remove(indexFile).catch(() => {})
    return undefined
  }

  return sessionId
}

async function loadSessionState(sessionId: string): Promise<SessionState | undefined> {
  const raw = await Deno.readTextFile(join(SESSION_DIR, sessionId)).catch(() => "")
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as SessionState
  } catch {
    return undefined
  }
}

async function writeSessionState(sessionId: string, state: SessionState) {
  await Deno.writeTextFile(join(SESSION_DIR, sessionId), JSON.stringify(state))
}

// Apply an optional patch and render. The session file is loaded fresh on each
// call so concurrent writers (state hooks vs. async summarizer) see each
// other's updates in the rendered title.
async function updateSession(
  sessionId: string,
  patch?: Partial<Pick<SessionState, "state" | "summary">>,
) {
  const session = await loadSessionState(sessionId)
  if (!session) return
  if ((await sessionForTerminal(session.terminalId)) !== sessionId) return

  const next = patch ? { ...session, ...patch } : session
  if (patch) await writeSessionState(sessionId, next)
  await setTabTitleByTerminal(
    session.terminalId,
    joinTitle(next.label, next.state, next.summary),
  )
}

const MESSAGE_WINDOW = 5
const MAX_MESSAGE_CHARS = 2000
// Prompts at or below this length are almost always continuations ("yes", "go
// ahead", "fix this?", "$ jr"), not topic shifts — skip them so we don't burn
// Haiku calls re-emitting the same label.
const MIN_RELEVANT_CHARS = 20

function truncateMessage(s: string): string {
  return s.length <= MAX_MESSAGE_CHARS ? s : s.slice(0, MAX_MESSAGE_CHARS) + "…"
}

// Meta-commands that operate on session state rather than the task. /clear
// is always the first message of a post-clear transcript, so surfacing it
// would make every fresh session's firstMessage be "/clear".
const SKIP_COMMANDS = new Set(["/clear", "/compact", "/resume"])

// Extract user-meaningful text from a transcript/hook content string. Returns
// undefined for tool-result payloads that shouldn't drive the summary.
// Slash-command invocations and bash-mode commands are kept: they start with
// `<` too, but `/coach whatever` and `$ cargo test` both name what the user is
// doing, which is exactly what we want feeding the label.
function extractUserText(content: string): string | undefined {
  const trimmed = content.trim()
  if (!trimmed) return undefined
  if (!trimmed.startsWith("<")) return trimmed
  const bashMatch = trimmed.match(/^<bash-input>([\s\S]*?)<\/bash-input>/)
  if (bashMatch) {
    const cmd = bashMatch[1].trim()
    return cmd ? `$ ${cmd}` : undefined
  }
  const m = trimmed.match(
    /^<command-name>([^<]+)<\/command-name>(?:[\s\S]*?<command-args>([^<]*)<\/command-args>)?/,
  )
  if (!m) return undefined
  const name = m[1].trim()
  if (SKIP_COMMANDS.has(name)) return undefined
  const args = m[2]?.trim()
  return args ? `${name} ${args}` : name
}

type TranscriptEvent = Record<string, unknown>
type TranscriptFormat = "claude" | "codex"

function detectTranscriptFormat(events: TranscriptEvent[]): TranscriptFormat | undefined {
  for (const event of events) {
    if (event.type === "user") return "claude"
    if (event.type !== "response_item") continue
    const payload = event.payload as Record<string, unknown> | undefined
    if (payload?.type === "message" && payload.role === "user") return "codex"
  }
  return undefined
}

function claudeUserText(event: TranscriptEvent): string | undefined {
  if (event.type !== "user") return undefined
  const message = event.message as { content?: unknown } | undefined
  return typeof message?.content === "string" ? extractUserText(message.content) : undefined
}

function codexUserText(event: TranscriptEvent): string | undefined {
  if (event.type !== "response_item") return undefined
  const payload = event.payload as Record<string, unknown> | undefined
  if (payload?.type !== "message" || payload.role !== "user") return undefined
  const content = payload.content
  if (!Array.isArray(content)) return undefined

  const text = content.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const part = item as Record<string, unknown>
    return part.type === "input_text" && typeof part.text === "string" ? [part.text] : []
  }).join("\n")
  return extractUserText(text)
}

export async function readUserMessages(transcriptPath: string): Promise<string[]> {
  const raw = await Deno.readTextFile(transcriptPath).catch(() => "")
  if (!raw) return []

  const events: TranscriptEvent[] = []
  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      events.push(JSON.parse(line) as TranscriptEvent)
    } catch { /* skip malformed lines */ }
  }

  const format = detectTranscriptFormat(events)
  if (!format) return []
  const readText = format === "claude" ? claudeUserText : codexUserText
  return events.flatMap((event) => {
    const text = readText(event)
    return text ? [truncateMessage(text)] : []
  })
}

const SUMMARY_SYSTEM_PROMPT = `
You track what the user is working on and produce a label for their terminal tab.

Inputs: a prior summary, the session's first user message (sets overall
context), and the most recent user messages. The input is a JSON object with
keys "priorSummary", "firstMessage", and "recentMessages".

Prefer keeping the prior summary unchanged if it's still accurate. Only
change the summary if the theme of the work has substantially changed.
Prefer short labels (a few words) but longer ones are fine if they're
genuinely more informative.

The label should be as concrete as the messages allow. When the messages
name a specific thing being worked on — filename, script or tool name,
function or symbol, feature, bug — prefer that noun in the label. Avoid
vague abstractions like "code refactoring", "bug fix", "improving code",
"adding feature" when a more specific noun is available in the input;
those phrases describe every session and tell the user nothing. But do
not invent specifics that aren't in the messages — if the work really is
generic, a generic label is fine.

Output only the label, no punctuation, no quotes.`

async function generateSummary(
  { priorSummary, firstMessage, recentMessages }: {
    priorSummary?: string
    firstMessage: string
    recentMessages: string[]
  },
): Promise<string> {
  const input = JSON.stringify({
    priorSummary: priorSummary ?? "",
    firstMessage,
    recentMessages,
  })

  const out = await $`ai --system ${SUMMARY_SYSTEM_PROMPT} --model haiku --raw --ephemeral`
    .stdinText(input)
    .text()
    .catch(() => "")
  return sanitizeTitle(out).slice(0, 100)
}

interface SummaryPayload {
  priorSummary: string
  firstMessage: string
  recentMessages: string[]
}

export async function buildSummaryPayload(
  transcriptPath: string,
  priorSummary?: string,
  extraPrompt?: string,
): Promise<SummaryPayload | undefined> {
  const transcriptMessages = await readUserMessages(transcriptPath)
  const promptText = extraPrompt ? extractUserText(extraPrompt) : undefined
  const all = promptText && transcriptMessages.at(-1) !== promptText
    ? [...transcriptMessages, truncateMessage(promptText)]
    : transcriptMessages
  // filter out short messages
  const relevant = all.filter((m) => m.length > MIN_RELEVANT_CHARS)
  if (relevant.length === 0) return undefined
  return {
    priorSummary: priorSummary ?? "",
    firstMessage: relevant[0],
    recentMessages: relevant.slice(-MESSAGE_WINDOW),
  }
}

async function handleSummarize() {
  const stdin = (await new Response(Deno.stdin.readable).text()).trim()
  const input = parseHookInput(stdin)
  if (!input || input.hookEventName !== "UserPromptSubmit") return
  if (!input.sessionId || !input.transcriptPath) return

  const promptText = input.prompt ? extractUserText(input.prompt) : undefined
  // Short turns rarely shift the work theme, so don't bother updating summary
  if (!promptText || promptText.length <= MIN_RELEVANT_CHARS) return

  const session = await loadSessionState(input.sessionId)
  if (!session) return

  const payload = await buildSummaryPayload(
    input.transcriptPath,
    session.summary,
    input.prompt,
  )
  if (!payload) return

  const summary = await generateSummary(payload)
  if (!summary) return

  await updateSession(input.sessionId, { summary })
}

async function handleDetach(subcommand: string) {
  if (subcommand !== "summarize") {
    throw new ValidationError(`Cannot detach unsupported subcommand: ${subcommand}`)
  }

  const stdin = await new Response(Deno.stdin.readable).text()
  const child = new Deno.Command("ghostty-tab-title", {
    args: [subcommand],
    stdin: "piped",
    stdout: "null",
    stderr: "null",
  }).spawn()
  const writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(stdin))
  await writer.close()
  child.unref()
}

// Look up the most recent active session whose cwd matches `path`, and print
// its summary (if any). Used by external tools (e.g. jjw) that want to
// surface "what's going on at this path right now".
async function handleDescription(path: string) {
  const matches = (await Promise.all(
    (await listFiles(SESSION_DIR)).map(async ({ name, stat }) => {
      const session = await loadSessionState(name)
      return stat.mtime && session?.cwd === path && session.summary
        ? { summary: session.summary, mtime: stat.mtime.getTime() }
        : undefined
    }),
  )).filter((m) => m !== undefined)

  const best = matches.toSorted((a, b) => b.mtime - a.mtime)[0]
  if (best) console.log(best.summary)
}

async function handlePreview(transcriptPath: string) {
  const payload = await buildSummaryPayload(transcriptPath)
  if (!payload) {
    console.error("No user messages found in transcript")
    Deno.exit(1)
  }
  console.log(JSON.stringify(payload, null, 2))
}

async function handleShell(label: string, tty?: string, paneCountAtRequest?: string) {
  // Two callers: zsh startup (no GHOSTTY_TERMINAL_ID yet — resolve our own pane
  // by $TTY and emit the export) and chpwd (env var already set — use the pane
  // count snapshotted synchronously for that terminal). Neither path may use "frontmost
  // terminal": at startup it would mis-pin when another tab is front (acute on
  // restart, when every shell starts at once); at chpwd a backgrounded osascript
  // could race with focus changes and retitle the wrong tab.
  const envTerminalId = Deno.env.get("GHOSTTY_TERMINAL_ID")
  await logEvent("shell_started", { label, tty, envTerminalId })
  const cleanLabel = sanitizeTitle(label)
  if (!cleanLabel) {
    await logEvent("shell_skipped", { label, reason: "invalid_label" })
    return
  }
  let terminalId: string | undefined
  let terminalCount: number | undefined

  if (envTerminalId) {
    terminalId = envTerminalId
    if (paneCountAtRequest !== undefined) {
      terminalCount = Number(paneCountAtRequest)
      if (!Number.isInteger(terminalCount) || terminalCount < 1) {
        await logEvent("shell_skipped", {
          label: cleanLabel,
          terminalId,
          paneCountAtRequest,
          reason: "invalid_pane_count_snapshot",
        })
        return
      }
    } else {
      terminalCount = await paneCountForTerminal(envTerminalId)
    }
  } else if (tty) {
    const info = await setInitialTitleForTty(tty, cleanLabel)
    if (!info) {
      await logEvent("shell_skipped", { label, tty, reason: "tty_not_found" })
      return
    }
    terminalId = info.terminalId
    terminalCount = info.terminalCount
    console.log(`export GHOSTTY_TERMINAL_ID=${info.terminalId}`)
    return
  } else {
    await logEvent("shell_skipped", { label, reason: "no_terminal_id_or_tty" })
    return
  }

  if (!terminalId) {
    await logEvent("shell_skipped", {
      label,
      terminalId,
      reason: "invalid_terminal",
    })
    return
  }

  await ensureStateDirs()
  const sessionId = await sessionForTerminal(terminalId)
  if (sessionId) {
    await logEvent("shell_skipped", {
      label: cleanLabel,
      terminalId,
      terminalCount,
      sessionId,
      reason: "active_session",
    })
    return
  }
  if (terminalCount !== 1) {
    await logEvent("shell_skipped", {
      label: cleanLabel,
      terminalId,
      terminalCount,
      reason: "not_single_pane",
    })
    return
  }

  await logEvent("shell_setting_title", { label: cleanLabel, terminalId, terminalCount })
  await setTabTitleByTerminal(terminalId, cleanLabel)
}

async function handlePaneCount(terminalId: string) {
  const terminalCount = await paneCountForTerminal(terminalId)
  if (terminalCount === undefined) {
    Deno.exitCode = 1
    return
  }
  console.log(terminalCount)
}

async function handleRelease() {
  const terminalId = Deno.env.get("GHOSTTY_TERMINAL_ID")
  if (!terminalId) return

  const sessionId = await sessionForTerminal(terminalId)
  if (!sessionId) return
  const session = await loadSessionState(sessionId)
  if (session) await setTabTitleByTerminal(terminalId, session.label)
  await Promise.all([
    Deno.remove(join(TERMINAL_SESSION_DIR, terminalId)).catch(() => {}),
    Deno.remove(join(SESSION_DIR, sessionId)).catch(() => {}),
  ])
}

async function handleHook() {
  const stdin = (await new Response(Deno.stdin.readable).text()).trim()
  const input = parseHookInput(stdin)
  if (!input || !input.sessionId) return
  const { sessionId } = input

  switch (input.hookEventName) {
    case "SessionStart": {
      const rawLabel = Deno.env.get("GHOSTTY_TAB_BASE_LABEL") ??
        (input.cwd ? abbreviatePath(input.cwd) : "")
      const label = sanitizeTitle(rawLabel)
      if (!label) return

      await ensureStateDirs()
      // Prefer the terminal id the shell captured at startup. Fall back to the
      // frontmost terminal only if the env var is missing (e.g. claude launched
      // from a non-Ghostty shell, or .zshrc hasn't been reloaded).
      const terminalId = Deno.env.get("GHOSTTY_TERMINAL_ID") ||
        (await currentFrontTerminalInfo())?.terminalId
      if (!terminalId) return

      await writeSessionState(sessionId, { terminalId, label, cwd: input.cwd })
      await Deno.writeTextFile(
        join(TERMINAL_SESSION_DIR, terminalId),
        `${sessionId}\n`,
      )
      await updateSession(sessionId)
      return
    }
    case "UserPromptSubmit":
      await updateSession(sessionId, { state: "🌀" })
      return
    case "Stop":
      await updateSession(sessionId, { state: "" })
      return
    case "SessionEnd": {
      const session = await loadSessionState(sessionId)
      if (!session) return

      if ((await sessionForTerminal(session.terminalId)) === sessionId) {
        await setTabTitleByTerminal(session.terminalId, session.label)
        await Deno.remove(join(TERMINAL_SESSION_DIR, session.terminalId)).catch(() => {})
      }
      await Deno.remove(join(SESSION_DIR, sessionId)).catch(() => {})
    }
  }
}

if (import.meta.main) {
  await new Command()
    .name("ghostty-tab-title")
    .description("Keep Ghostty tab titles stable across split panes and agent sessions")
    .action(() => {
      throw new ValidationError("Subcommand required")
    })
    .command(
      "shell",
      new Command()
        .description("Set the base Ghostty tab title for a shell")
        .option(
          "--tty <tty:string>",
          "Controlling tty of this shell, used to pin the pane on first call",
        )
        .option(
          "--pane-count <count:string>",
          "Pane count captured synchronously when the directory changed",
        )
        .arguments("<label:string>")
        .action((opts: { tty?: string; paneCount?: string }, label: string) =>
          handleShell(label, opts.tty, opts.paneCount)
        ),
    )
    .command(
      "pane-count",
      new Command()
        .description("Print the pane count for the tab containing a terminal")
        .arguments("<terminal-id:string>")
        .action((_opts: void, terminalId: string) => handlePaneCount(terminalId)),
    )
    .command(
      "hook",
      new Command()
        .description("Update Ghostty tab titles from agent hook JSON on stdin")
        .action(() => handleHook()),
    )
    .command(
      "detach",
      new Command()
        .description("Run a hook worker after detaching it from the calling process")
        .arguments("<subcommand:string>")
        .action((_opts: void, subcommand: string) => handleDetach(subcommand)),
    )
    .command(
      "release",
      new Command()
        .description("Release the session associated with GHOSTTY_TERMINAL_ID")
        .action(() => handleRelease()),
    )
    .command(
      "summarize",
      new Command()
        .description(
          "Async UserPromptSubmit hook: regenerate the tab label from the prompt",
        )
        .action(() => handleSummarize()),
    )
    .command(
      "description",
      new Command()
        .description(
          "Print the active session summary for a path, if one exists. Used by external tools to surface what's going on at a given workspace.",
        )
        .arguments("<path:string>")
        .action((_opts: void, path: string) => handleDescription(path)),
    )
    .command(
      "preview",
      new Command()
        .description(
          "Print the JSON payload the summarizer would feed the LLM for a transcript",
        )
        .arguments("<transcript-path:string>")
        .action((_opts: void, transcriptPath: string) => handlePreview(transcriptPath)),
    )
    .parse(Deno.args)
}
