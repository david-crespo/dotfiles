// Pi port of the Ghostty tab-title hooks (see bin/ghostty-tab-title.ts).
//
// The deno `ghostty-tab-title` tool is harness-agnostic: it reads Claude-style
// hook JSON on stdin and drives the tab title. This extension makes pi a second
// producer of that same hook input, so the tool itself stays unchanged.
//
// Event mapping (pi -> hook_event_name):
//   session_start         -> SessionStart      (pins terminal, sets base label)
//   before_agent_start    -> prompt             (state "🌀") + async summarize
//   agent_end             -> Stop              (state "")
//   session_shutdown/quit -> SessionEnd        (retain an idle sticky segment)
//
// GHOSTTY_TERMINAL_ID and GHOSTTY_TAB_BASE_LABEL are inherited from the shell
// env (set by `ghostty-tab-title shell` in .zshrc), same as under Claude.
//
// The prompt command forwards a transcript path to its detached summarizer.
// Pi's session format differs from Claude's, so we synthesize a minimal transcript (one
// {"type":"user","message":{"content":...}} line per user message) in a temp
// file. That is all readUserMessages() needs.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

const BIN = join(homedir(), ".local", "bin", "ghostty-tab-title")

function transcriptPathFor(sessionId: string): string {
  return join(tmpdir(), "ghostty-pi-transcripts", `${sessionId}.jsonl`)
}

// Run the tool with hook JSON on stdin. A spawn error (missing binary) or
// non-zero exit just resolves, so it never breaks the session.
function runTool(args: string[], stdin: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(BIN, args, { stdio: ["pipe", "ignore", "ignore"] })
    child.on("error", () => resolve())
    child.on("close", () => resolve())
    child.stdin.end(stdin)
  })
}

function sessionId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager.getSessionId()
  } catch {
    return undefined
  }
}

function hookJson(
  event: string,
  ctx: ExtensionContext,
  extra: Record<string, string> = {},
): string {
  return JSON.stringify({
    hook_event_name: event,
    session_id: sessionId(ctx),
    cwd: ctx.cwd,
    ...extra,
  })
}

// All user message texts in the current branch, oldest first. Pi stores user
// content as a string or an array of typed blocks; flatten to plain text.
function userTexts(ctx: ExtensionContext): string[] {
  const texts: string[] = []
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "user") continue
    const content = entry.message.content
    const text = typeof content === "string" ? content : content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n")
    if (text.trim()) texts.push(text)
  }
  return texts
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    // Reload keeps the same session; re-running SessionStart would wipe the
    // summary from the tool's state file. Skip it.
    if (event.reason === "reload") return
    await runTool(["hook"], hookJson("SessionStart", ctx))
  })

  pi.on("before_agent_start", async (event, ctx) => {
    const id = sessionId(ctx)
    if (!id) return
    const transcriptPath = transcriptPathFor(id)
    const lines = userTexts(ctx)
      .map((text) => JSON.stringify({ type: "user", message: { content: text } }))
      .join("\n")
    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      await writeFile(transcriptPath, lines + "\n")
    } catch {
      return
    }
    await runTool(
      ["prompt"],
      hookJson("UserPromptSubmit", ctx, {
        prompt: event.prompt,
        transcript_path: transcriptPath,
      }),
    )
  })

  pi.on("agent_end", async (_event, ctx) => {
    await runTool(["hook"], hookJson("Stop", ctx))
  })

  pi.on("session_shutdown", async (event, ctx) => {
    // Only a real exit ends the session. new/resume/fork hand off to a fresh
    // session_start that retitles; reload keeps state.
    if (event.reason !== "quit") return
    await runTool(["hook"], hookJson("SessionEnd", ctx))
  })
}
