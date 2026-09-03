#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=osascript

// Open a new Ghostty tab for a prose review session: real helix editing the
// draft in the left pane, terminal-browser showing the prose server's
// rendered preview in the right pane. Panes are native ghostty splits, so
// normal split navigation/resize keybindings work.
//
// Expects a `prose <file> --no-open` server already running on the port
// (see the prose skill). This script only builds the tab layout.
//
// Helix gets a temp config: the user's config.toml plus auto-save, so the
// preview updates ~650ms after typing stops. `hx --config` replaces
// config.toml entirely, which is why we concatenate rather than override.

import { Command } from "@cliffy/command"
import { join, resolve } from "@std/path"

const AUTO_SAVE = `
[editor.auto-save]
focus-lost = true

[editor.auto-save.after-delay]
enable = true
timeout = 650
`

// AppleScript string literal (escapes backslash and double quote; AppleScript
// interprets \n as a newline, which is what submits the typed command)
const asStr = (s: string) => '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"'

// single-quote for zsh
const shq = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'"

const { args, options } = await new Command()
  .name("prose-tab")
  .description("Open a ghostty tab with helix (left) and terminal-browser preview (right)")
  .arguments("<file:string>")
  .option("--port <port:number>", "Port the prose server is running on", { default: 4917 })
  .parse(Deno.args)

const file = resolve(args[0])
const cwd = Deno.cwd()

let userConfig = ""
try {
  userConfig = await Deno.readTextFile(
    join(Deno.env.get("HOME")!, ".config/helix/config.toml"),
  )
} catch {
  // no user config; auto-save section alone is fine
}
const hxConfig = await Deno.makeTempFile({ prefix: "prose-hx-", suffix: ".toml" })
await Deno.writeTextFile(
  hxConfig,
  userConfig.includes("[editor.auto-save") ? userConfig : userConfig + AUTO_SAVE,
)

const editorCmd = `hx --config ${shq(hxConfig)} ${shq(file)}\n`
const previewCmd =
  `terminal-browser open "localhost:${options.port}/?preview" --no-toolbar\n`

const script = `
tell application "Ghostty"
  set editorCfg to new surface configuration
  set initial working directory of editorCfg to ${asStr(cwd)}
  set initial input of editorCfg to ${asStr(editorCmd)}
  set t to new tab in front window with configuration editorCfg
  set editorTerm to focused terminal of t

  set previewCfg to new surface configuration
  set initial working directory of previewCfg to ${asStr(cwd)}
  set initial input of previewCfg to ${asStr(previewCmd)}
  split editorTerm direction right with configuration previewCfg

  focus editorTerm
end tell
`

const out = await new Deno.Command("osascript", { args: ["-e", script] }).output()
if (!out.success) {
  console.error(new TextDecoder().decode(out.stderr))
  Deno.exit(1)
}
