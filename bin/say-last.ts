#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=say,kill,ps

// Reads the most recent Claude Code answer out loud.
//
// Bound to a global hotkey (Alfred), this is a "read me the last answer"
// button: it finds the session transcript under ~/.claude/projects with the
// most recent answer, pulls the final prose block out of it, strips the
// markdown down to something worth hearing, and speaks it with `say`.
//
// # Which transcript
//
// Not the one with the newest mtime: Claude Code appends housekeeping entries
// (mode changes, system notices) to idle sessions, so an untouched session can
// out-mtime the one just answered in. Sessions are ranked by the timestamp of
// the last assistant answer inside the file instead. mtime still serves as a
// cheap upper bound — a file can't contain an answer newer than its mtime — so
// the scan walks files newest-first and stops as soon as no remaining file
// could beat the best answer found.
//
// # Which answer
//
// The final answer is the assistant text after the last user turn or tool
// activity in the transcript — both bound it, or an answer from an earlier
// turn (separated from the newest only by a background-task notification)
// would be read too. If the session is mid-turn that region is empty, so the
// search walks back to the previous boundary and takes the answer before it.
// Thinking blocks are never spoken.
//
// Pass a transcript path to read a specific session instead of the newest.
//
// # Playback
//
// `say` speaks live — no audio file, no separate player — so speech starts
// immediately and there is a single killable pid. The hotkey toggles: press
// once to speak, again to shut it up.

const HOME = Deno.env.get("HOME")!
const PROJECTS = `${HOME}/.claude/projects`
const STATE = `${Deno.env.get("XDG_CACHE_HOME") ?? `${HOME}/.cache`}/say-last`
const PID_FILE = `${STATE}/playing.pid`

type Block = { type: string; text?: string }
type Entry = {
  type?: string
  isMeta?: boolean
  timestamp?: string
  message?: { content?: Block[] | string }
}

function blocks(entry: Entry): Block[] {
  const content = entry.message?.content
  return Array.isArray(content) ? content : []
}

function isToolActivity(entry: Entry): boolean {
  return blocks(entry).some((b) => b.type === "tool_use" || b.type === "tool_result")
}

// An entry that ends an assistant answer: anything from the user's side (real
// prompts, tool results, task notifications all record as type "user") or a
// tool call.
function isBoundary(entry: Entry): boolean {
  return entry.type === "user" || isToolActivity(entry)
}

function hasAnswerText(entry: Entry): boolean {
  return entry.type === "assistant" && !entry.isMeta &&
    blocks(entry).some((b) => b.type === "text" && b.text?.trim())
}

// The transcript is one JSON object per line, oldest first.
function parseTranscript(path: string): Entry[] {
  const entries: Entry[] = []
  for (const line of Deno.readTextFileSync(path).split("\n")) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // A session still being written can leave a torn final line.
    }
  }
  return entries
}

function finalAnswer(entries: Entry[]): string {
  let end = entries.length
  while (end > 0) {
    let cut = -1
    for (let i = end - 1; i >= 0; i--) {
      if (isBoundary(entries[i])) {
        cut = i
        break
      }
    }
    const texts: string[] = []
    for (const entry of entries.slice(cut + 1, end)) {
      if (entry.type !== "assistant" || entry.isMeta) continue
      for (const b of blocks(entry)) {
        if (b.type === "text" && b.text?.trim()) texts.push(b.text)
      }
    }
    if (texts.length) return texts.join("\n\n")
    if (cut < 0) return ""
    end = cut
  }
  return ""
}

// Markdown is written to be looked at. Strip what only makes sense on screen.
function speechText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[ \t]*\|.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>\s]+>/g, "")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/^(\s*)[-*+]\s+/gm, "$1")
    .replace(/^(\s*)\d+\.\s+/gm, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_]/g, "$1$2")
    .replace(/[\p{Extended_Pictographic}←-⇿─-➿]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function lastAnswerAt(entries: Entry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (hasAnswerText(entries[i])) {
      return Date.parse(entries[i].timestamp ?? "") || 0
    }
  }
  return 0
}

function newestTranscript(here: boolean): string | null {
  let dirs: string[] = []
  if (here) {
    // Claude Code names each project dir after its cwd with every
    // non-alphanumeric character replaced by a dash.
    const slug = Deno.cwd().replace(/[^A-Za-z0-9]/g, "-")
    dirs = [`${PROJECTS}/${slug}`]
  } else {
    for (const e of Deno.readDirSync(PROJECTS)) {
      if (e.isDirectory) dirs.push(`${PROJECTS}/${e.name}`)
    }
  }

  const files: { path: string; mtime: number }[] = []
  for (const dir of dirs) {
    let listing: Deno.DirEntry[]
    try {
      listing = [...Deno.readDirSync(dir)]
    } catch {
      continue // --here in a directory Claude has never run in
    }
    for (const e of listing) {
      if (!e.name.endsWith(".jsonl")) continue
      const path = `${dir}/${e.name}`
      files.push({ path, mtime: Deno.statSync(path).mtime?.getTime() ?? 0 })
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)

  let best: string | null = null
  let bestAt = 0
  for (const { path, mtime } of files) {
    // No file can hold an answer newer than its own mtime, and files come
    // newest-first, so once mtimes drop below the best answer we're done.
    if (mtime <= bestAt) break
    const at = lastAnswerAt(parseTranscript(path))
    if (at > bestAt) {
      bestAt = at
      best = path
    }
  }
  // With no answers anywhere, fall back to the newest file so the error
  // message downstream can at least name it.
  return best ?? files[0]?.path ?? null
}

async function signal(pid: number, sig: string): Promise<boolean> {
  // Deno.kill() demands unscoped --allow-run, so shell out instead: `kill -0`
  // tests liveness and `kill -TERM` stops playback.
  const { success } = await new Deno.Command("kill", {
    args: [sig, String(pid)],
    stdout: "null",
    stderr: "null",
  }).output()
  return success
}

// A live pid alone proves nothing: the recorded pid may have been recycled by
// an unrelated process, and signalling that would be worse than doing nothing.
// Confirm the process is really one of ours before treating it as playback.
async function isOurs(pid: number): Promise<boolean> {
  const { success, stdout } = await new Deno.Command("ps", {
    args: ["-p", String(pid), "-o", "command="],
    stderr: "null",
  }).output()
  // Every instance runs as `deno run ... /path/to/say-last <args>`, so both
  // tokens have to be present; matching the name alone would fire on any
  // process that merely mentions it.
  const cmd = new TextDecoder().decode(stdout)
  return success && cmd.includes("deno") && cmd.includes("say-last")
}

async function running(): Promise<number | null> {
  let pid: number
  try {
    pid = Number(Deno.readTextFileSync(PID_FILE).trim())
  } catch {
    return null // nothing has played yet
  }
  if (!pid || !await signal(pid, "-0") || !await isOurs(pid)) return null
  return pid
}

const args = new Set(Deno.args)
Deno.mkdirSync(STATE, { recursive: true })

// One button, two meanings: speaking means stop, silence means speak.
const active = await running()
if (active !== null) {
  await signal(active, "-TERM") // that run's handler stops its own playback
  try {
    Deno.removeSync(PID_FILE)
  } catch { /* it cleaned up first */ }
  Deno.exit(0)
}
if (args.has("--stop")) Deno.exit(0)

const explicit = Deno.args.find((a) => !a.startsWith("--"))
const transcript = explicit ?? newestTranscript(args.has("--here"))
if (!transcript) {
  console.error("no Claude session transcript found")
  Deno.exit(1)
}

const text = speechText(finalAnswer(parseTranscript(transcript)))
if (!text) {
  console.error(`no answer to read in ${transcript}`)
  Deno.exit(1)
}

if (args.has("--print")) {
  console.log(text)
  Deno.exit(0)
}

let player: Deno.ChildProcess | null = null
function release() {
  try {
    if (Number(Deno.readTextFileSync(PID_FILE).trim()) === Deno.pid) {
      Deno.removeSync(PID_FILE)
    }
  } catch { /* a newer run owns the pidfile now */ }
}
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  Deno.addSignalListener(sig, () => {
    try {
      player?.kill("SIGKILL")
    } catch { /* not spawned, or already dead */ }
    release()
    Deno.exit(0)
  })
}
Deno.writeTextFileSync(PID_FILE, String(Deno.pid))

player = new Deno.Command("say", {
  args: ["-r", "280", text],
  stdout: "null",
  stderr: "inherit",
}).spawn()
const { success } = await player.status
player = null

release()
if (!success) {
  console.error("speech synthesis failed")
  Deno.exit(1)
}
