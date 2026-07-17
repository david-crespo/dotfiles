#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=osascript,ai,ghostty-tab-title

// Maintains sticky, aggregate Ghostty tab titles for coding agents.
//
// # Product model
//
// A Ghostty "terminal" is one pane. Each terminal maps to the latest agent
// session that produced a hook in that pane. The mapping describes what should
// remain visible, not whether the agent process is alive: Stop and SessionEnd
// clear the busy indicator but deliberately leave the session mapped. A later
// agent hook reclaims the terminal, and a shell directory change removes its
// terminal's mapping.
//
// A tab title is rebuilt from all mapped terminals in that tab, in Ghostty's
// terminal order. Consecutive terminals with the same label emit that label
// once; each terminal then contributes its state and summary when present:
//
//     {label} | {summary} | {state} {summary}
//
// All components use ` | ` as the separator. State and summary stay together
// with a space, and empty components are omitted. If shell activity removes
// the final mapping, that shell's directory label becomes the tab title.
//
// # Persistent state
//
// State lives under $XDG_STATE_HOME/ghostty-tab-titles (normally
// ~/.local/state/ghostty-tab-titles):
//
//   sessions/<session-id>
//       Versioned JSON containing terminalId, stable base label, cwd, busy
//       state, and the current prompt sequence. Session files remain useful to
//       `description` after their terminal mapping has been superseded.
//
//   terminal-sessions/<terminal-id>
//       The session currently visible for this terminal. The historical path
//       name is retained for migration compatibility; this is a
//       latest-visible-session index, not an active-process index.
//
//   summaries/<session-id>/<prompt-sequence>
//       Immutable generated summaries. Rendering reads only the current
//       sequence, so a slow summary job from an earlier prompt cannot overwrite
//       or reintroduce stale text for a newer prompt.
//
//   terminal-metadata/<terminal-id>
//       The shell label and last rendered tab id. The latter lets a later hook
//       repair both sides of a pane move: the tab the terminal left and the tab
//       it currently occupies.
//
// Session, index, and metadata writes use a same-directory temporary file plus
// rename. Summary creation uses createNew because each sequence is immutable.
// Old state is swept after seven days; malformed and dangling index entries are
// also discarded when read. Legacy session JSON without sequence/version
// fields is normalized in memory, and its old inline summary remains readable.
// Operational events and AppleScript failures are appended as JSON lines to
// events.jsonl in the same state root for debugging cross-process races.
//
// # Rendering and races
//
// Ghostty exposes stable tab and terminal ids through AppleScript. Rendering
// first snapshots the containing tab id and its ordered terminal ids. The title
// write targets the first terminal in that snapshot and verifies that terminal
// still belongs to the snapshotted tab; this avoids relying on focus, which can
// be transiently stale after dragging panes.
//
// After every write, the renderer snapshots membership again and compares a
// version token covering terminal mappings, session versions, current summary
// records, and shell metadata. If either membership or state changed, it
// rebuilds and retries with a small bound. There is intentionally no global or
// tab-wide lock: independent hook processes converge through atomic state and
// snapshot validation.
//
// A pane move with no subsequent activity may leave the old title temporarily
// stale. On the next title-producing event, terminal metadata identifies the
// previous tab; the renderer repairs that tab first and then the current tab.
//
// # Event flows
//
//   shell --tty <tty> <label>
//       zsh startup finds its own terminal by controlling tty rather than by
//       focus. This matters during Ghostty state restoration, when many shells
//       start concurrently. It exports GHOSTTY_TERMINAL_ID for child agents.
//
//   shell <label>
//       zsh chpwd stores the new shell label, removes only this terminal's
//       visible-agent mapping, and rerenders the containing tab.
//
//   hook
//       SessionStart creates or resumes state and claims the terminal. Stop and
//       SessionEnd reclaim the mapping, mark the session idle, and leave its
//       segment sticky.
//
//   prompt
//       Reclaims the mapping, marks the session busy, increments its prompt
//       sequence, renders synchronously, then launches a detached summarizer
//       carrying that exact sequence. The worker writes its immutable record
//       and rerenders only if the sequence is still current.
//
// # Modules
//
// The executable below owns CLI and host-hook orchestration. Supporting code is
// under bin/lib/ghostty-title: routing.ts wraps Ghostty AppleScript, state.ts
// owns persistent state, summary.ts adapts transcripts and calls the model, and
// policy.ts formats and converges aggregate titles. install.sh exposes the
// entire bin/lib directory beside command symlinks because Deno resolves
// relative imports from the symlink location.

import { Command, ValidationError } from "@cliffy/command"
import { join } from "@std/path"
import { logEvent } from "./lib/ghostty-title/events.ts"
import { TabRenderer } from "./lib/ghostty-title/policy.ts"
import {
  AppleScriptGhosttyRouting,
  frontTerminalId,
  initializeTerminalForTty,
  paneCountForTerminal,
} from "./lib/ghostty-title/routing.ts"
import { type SessionState, statePaths, StateStore } from "./lib/ghostty-title/state.ts"
import {
  buildSummaryPayload,
  generateSummary,
  readUserMessages,
  sanitizeTitle,
} from "./lib/ghostty-title/summary.ts"

export { buildSummaryPayload, readUserMessages }

const STATE_ROOT = join(
  Deno.env.get("XDG_STATE_HOME") ?? join(Deno.env.get("HOME")!, ".local", "state"),
  "ghostty-tab-titles",
)
const store = new StateStore(statePaths(STATE_ROOT))
const routing = new AppleScriptGhosttyRouting()
const renderer = new TabRenderer(store, routing)

const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"] as const
type HookEventName = typeof HOOK_EVENTS[number]

interface HookInput {
  hookEventName: HookEventName
  sessionId?: string
  cwd?: string
  prompt?: string
  transcriptPath?: string
}

function parseHookInput(input: string): HookInput | undefined {
  try {
    const raw = JSON.parse(input) as Record<string, unknown>
    if (!HOOK_EVENTS.includes(raw.hook_event_name as HookEventName)) return undefined
    const stringValue = (value: unknown) => typeof value === "string" ? value : undefined
    return {
      hookEventName: raw.hook_event_name as HookEventName,
      sessionId: stringValue(raw.session_id),
      cwd: stringValue(raw.cwd),
      prompt: stringValue(raw.prompt),
      transcriptPath: stringValue(raw.transcript_path),
    }
  } catch {
    return undefined
  }
}

function abbreviatePath(path: string): string {
  const home = Deno.env.get("HOME")
  if (!home) return path
  for (const directory of ["repos", "oxide", "jj-workspaces"]) {
    const prefix = `${home}/${directory}/`
    if (path.startsWith(prefix)) return path.slice(prefix.length)
  }
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

async function terminalForSessionStart(): Promise<string | undefined> {
  return Deno.env.get("GHOSTTY_TERMINAL_ID") || await frontTerminalId()
}

async function reclaimAndUpdate(
  sessionId: string,
  patch: (state: SessionState) => SessionState,
): Promise<SessionState | undefined> {
  const current = await store.readSession(sessionId)
  if (!current) return undefined
  await store.claim(current.terminalId, sessionId)
  const next = await store.updateSession(sessionId, patch)
  if (next) await renderer.renderForTerminal(next.terminalId)
  return next
}

async function handleHook(): Promise<void> {
  const input = parseHookInput((await new Response(Deno.stdin.readable).text()).trim())
  if (!input?.sessionId || input.hookEventName === "UserPromptSubmit") return
  await store.ensure()

  if (input.hookEventName === "SessionStart") {
    const terminalId = await terminalForSessionStart()
    const label = sanitizeTitle(
      Deno.env.get("GHOSTTY_TAB_BASE_LABEL") ??
        (input.cwd ? abbreviatePath(input.cwd) : ""),
    )
    if (!terminalId || !label) return

    const previous = await store.readSession(input.sessionId)
    if (previous?.terminalId && previous.terminalId !== terminalId) {
      await store.release(previous.terminalId, input.sessionId)
      await renderer.renderForTerminal(previous.terminalId)
    }
    await store.writeSession(input.sessionId, {
      terminalId,
      label,
      cwd: input.cwd,
      state: previous?.state ?? "",
      promptSequence: previous?.promptSequence ?? 0,
      version: (previous?.version ?? 0) + 1,
    })
    await store.claim(terminalId, input.sessionId)
    await logEvent("session_claimed", {
      hookEventName: input.hookEventName,
      sessionId: input.sessionId,
      terminalId,
      label,
    })
    await renderer.renderForTerminal(terminalId)
    return
  }

  if (input.hookEventName === "Stop" || input.hookEventName === "SessionEnd") {
    // SessionEnd deliberately retains both the idle state and terminal mapping.
    const session = await reclaimAndUpdate(input.sessionId, (state) => ({
      ...state,
      state: "",
    }))
    if (session) {
      await logEvent("session_idle", {
        hookEventName: input.hookEventName,
        sessionId: input.sessionId,
        terminalId: session.terminalId,
      })
    }
  }
}

async function handlePrompt(): Promise<void> {
  const stdin = (await new Response(Deno.stdin.readable).text()).trim()
  const input = parseHookInput(stdin)
  if (!input?.sessionId || input.hookEventName !== "UserPromptSubmit") return
  await store.ensure()
  const session = await reclaimAndUpdate(input.sessionId, (state) => ({
    ...state,
    state: "🌀",
    promptSequence: state.promptSequence + 1,
  }))
  if (!session) return
  await logEvent("prompt_started", {
    sessionId: input.sessionId,
    terminalId: session.terminalId,
    promptSequence: session.promptSequence,
  })
  if (!input.transcriptPath) {
    await logEvent("summary_skipped", {
      sessionId: input.sessionId,
      promptSequence: session.promptSequence,
      reason: "missing_transcript_path",
    })
    return
  }

  const child = new Deno.Command("ghostty-tab-title", {
    args: ["summarize", input.sessionId, String(session.promptSequence)],
    stdin: "piped",
    stdout: "null",
    stderr: "null",
  }).spawn()
  const writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(stdin))
  await writer.close()
  child.unref()
  await logEvent("summary_detached", {
    sessionId: input.sessionId,
    promptSequence: session.promptSequence,
  })
}

async function handleSummarize(sessionId: string, sequence: number): Promise<void> {
  const input = parseHookInput((await new Response(Deno.stdin.readable).text()).trim())
  if (!input?.transcriptPath || !Number.isInteger(sequence) || sequence < 1) return
  await store.ensure()
  const session = await store.readSession(sessionId)
  if (!session) return
  const priorSummary = await store.latestSummary(sessionId, sequence)
  const payload = await buildSummaryPayload(
    input.transcriptPath,
    priorSummary,
    input.prompt,
  )
  if (!payload) {
    await logEvent("summary_skipped", {
      sessionId,
      promptSequence: sequence,
      reason: "no_relevant_messages",
    })
    return
  }
  const summary = await generateSummary(payload)
  if (!summary) {
    await logEvent("summary_skipped", {
      sessionId,
      promptSequence: sequence,
      reason: "empty_model_response",
    })
    return
  }
  await store.writeSummary(sessionId, sequence, summary)
  await logEvent("summary_written", { sessionId, promptSequence: sequence, summary })

  const latest = await store.readSession(sessionId)
  if (latest?.promptSequence === sequence) {
    await store.claim(latest.terminalId, sessionId)
    await renderer.renderForTerminal(latest.terminalId)
  }
}

async function handleShell(label: string, tty?: string): Promise<void> {
  const cleanLabel = sanitizeTitle(label)
  if (!cleanLabel) return
  await store.ensure()
  const terminalId = Deno.env.get("GHOSTTY_TERMINAL_ID")
  await logEvent("shell_started", { label: cleanLabel, tty, terminalId })
  if (!terminalId) {
    if (!tty) return
    const initial = await initializeTerminalForTty(tty, cleanLabel)
    if (!initial) return
    await store.writeMetadata(initial.terminalId, { shellLabel: cleanLabel })
    const snapshot = await routing.snapshotForTerminal(initial.terminalId)
    if (snapshot) {
      await store.writeMetadata(initial.terminalId, { lastTabId: snapshot.tabId })
    }
    await logEvent("shell_terminal_captured", {
      label: cleanLabel,
      tty,
      terminalId: initial.terminalId,
      terminalCount: initial.terminalCount,
    })
    console.log(`export GHOSTTY_TERMINAL_ID=${initial.terminalId}`)
    return
  }

  await store.writeMetadata(terminalId, { shellLabel: cleanLabel })
  const released = await store.release(terminalId)
  await logEvent("shell_mapping_updated", {
    label: cleanLabel,
    terminalId,
    releasedAgentMapping: released,
  })
  await renderer.renderForTerminal(terminalId)
}

async function handleDescription(path: string): Promise<void> {
  await store.ensure()
  const matches = await Promise.all(
    (await store.listSessions())
      .filter(({ state }) => state.cwd === path)
      .map(async ({ id, state, mtime }) => ({
        summary: await store.latestSummary(id, state.promptSequence + 1),
        mtime: mtime.getTime(),
      })),
  )
  const best =
    matches.filter((match) => match.summary).toSorted((a, b) => b.mtime - a.mtime)[0]
  if (best?.summary) console.log(best.summary)
}

async function handlePreview(transcriptPath: string): Promise<void> {
  const payload = await buildSummaryPayload(transcriptPath)
  if (!payload) throw new ValidationError("No user messages found in transcript")
  console.log(JSON.stringify(payload, null, 2))
}

if (import.meta.main) {
  await new Command()
    .name("ghostty-tab-title")
    .description("Keep aggregate Ghostty tab titles stable across agent sessions")
    .action(() => {
      throw new ValidationError("Subcommand required")
    })
    .command(
      "shell",
      new Command()
        .description("Set the shell label and supersede this terminal's agent mapping")
        .option("--tty <tty:string>", "Controlling tty used to identify a new shell")
        .option("--pane-count <count:string>", "Deprecated pane-count snapshot")
        .arguments("<label:string>")
        .action((options: { tty?: string }, label: string) =>
          handleShell(label, options.tty)
        ),
    )
    .command(
      "pane-count",
      new Command()
        .description("Print the pane count for a terminal's tab")
        .arguments("<terminal-id:string>")
        .action(async (_options: void, terminalId: string) => {
          const count = await paneCountForTerminal(terminalId)
          if (count === undefined) Deno.exitCode = 1
          else console.log(count)
        }),
    )
    .command(
      "hook",
      new Command().description("Handle a non-prompt agent hook").action(handleHook),
    )
    .command(
      "prompt",
      new Command().description("Mark a prompt busy and launch its summary job").action(
        handlePrompt,
      ),
    )
    .command(
      "summarize",
      new Command()
        .description("Generate an immutable summary for one prompt sequence")
        .arguments("<session-id:string> <sequence:number>")
        .action((_options: void, sessionId: string, sequence: number) =>
          handleSummarize(sessionId, sequence)
        ),
    )
    .command(
      "description",
      new Command()
        .description("Print the latest session summary for a workspace")
        .arguments("<path:string>")
        .action((_options: void, path: string) => handleDescription(path)),
    )
    .command(
      "preview",
      new Command()
        .description("Print the summarizer payload for a transcript")
        .arguments("<transcript-path:string>")
        .action((_options: void, path: string) => handlePreview(path)),
    )
    .parse(Deno.args)
}
