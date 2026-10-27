#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=rex

import { Command, ValidationError } from "@cliffy/command"
import $ from "@david/dax"

// Quote a word for zsh, leaving plain words bare so an alias like jdp still
// expands when it's the first one
function shellQuote(arg: string) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`
}

await new Command()
  .name("rfloat")
  .description(
    `Run a command in a floating Rex pane over this terminal's tab. The float
closes when the command exits.

The command runs in a login zsh, so aliases from .zprofile work. Options
after the command go to the command.

Use --hold for output that doesn't stay up on its own: delta's less quits
when a diff fits on one screen, so a short jj diff closes right away.`,
  )
  .helpOption("-h, --help", "Show help")
  .example("Diff in a float", "rfloat --hold jj diff")
  .example("Small float", "rfloat --size 0.5 btop")
  .example("For agents", "rfloat --no-focus --label preview glow notes.md")
  // Required arguments fail with stopEarly in cliffy 1.2.1, so check by hand
  .arguments("[command...:string]")
  .usage("[options] <command...>")
  .stopEarly()
  .option("-s, --size <fraction:number>", "Width and height as a fraction of the tab", {
    default: 0.9,
  })
  .option("-l, --label <text:string>", "Pane title (default: the command)")
  .option("--hold", "Wait for a key after the command exits")
  .option("--no-focus", "Leave focus where it is")
  .action(async ({ size, label, hold, focus }, ...command) => {
    if (command.length === 0) throw new ValidationError("Missing command")
    const session = Deno.env.get("REX_SESSION")
    const block = Deno.env.get("REX_BLOCK")
    if (!session || !block) {
      console.error("rfloat: not running in Rex")
      Deno.exit(1)
    }

    let line = command.map(shellQuote).join(" ")
    if (hold) line += '; print -n "\\n[exited $?, press a key to close]"; read -sk1'

    // Without a window, Rex uses the active tab, which may not be this one
    const { block: { window_id } } = await $`rex block inspect ${block} --json`.json()

    // shell: none because zsh -l is the shell. .zprofile only adds Homebrew in
    // interactive shells, so the float gets this shell's PATH in front.
    const args = {
      session_id: session,
      window_id,
      bounds: [(1 - size) / 2, (1 - size) / 2, size, size],
      focus,
      layout: {
        block: {
          flavor: "com.superlogical.terminal.shell",
          label: label ?? command.join(" "),
          options: {
            cwd: Deno.cwd(),
            shell: "none",
            path_prepend: Deno.env.get("PATH")!.split(":"),
            command: ["zsh", "-l", "-c", line],
          },
        },
      },
    }
    await $`rex api call --session ${session} session.new_layer ${JSON.stringify(args)}`
      .quiet("stdout")
  })
  .parse()
