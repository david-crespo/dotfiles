#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=ai,cb

// hxai: simple wrapper around the `ai` CLI.
//   -f <file>   Read file content and pass as first argument to `ai`.
//   All other arguments are passed through to `ai` unchanged.

import $ from "jsr:@david/dax@0.42.0"
import { readAll } from "jsr:@std/io@0.225.2"
import { Command } from "jsr:@cliffy/command@1.0.0-rc.7"

const SYSTEM_PROMPT =
  `You are part of a code completion system in a text editor. You will receive
a SELECTION of code to transform, followed by a PROMPT. You may also receive
FILEs for context. Operation only on the selection. The prompt and files are
only background context. The text editor will replace the original selection
with your output. CRITICAL: Output ONLY the code itself. Do NOT use markdown
formatting, code fences, backticks, or any other markup. Do NOT include
explanatory text, comments, or prose. If you are asked to modify only part
of the selection, make sure to include the unchanged parts in the output so
they can be reinserted as-is in the target file. Your response should start
immediately with the first character of code and end with the last character
of code.`

await new Command()
  .name("hxai")
  .description(
    "`ai` wrapper for Helix. A selection is passed through stdin using `pipe:`",
  )
  .option("-f, --file <file:string>", "Read file content and pass as context to `ai`")
  .option("-m, --model <model:string>", "Specify model to use with `ai`")
  .arguments("[prompt...]")
  .action(async (opts, ...promptArgs) => {
    const aiArgs = ["--ephemeral", "--raw", "--system", SYSTEM_PROMPT]

    // needs to be before the cb call because that apparently eats stdin
    const stdin = new TextDecoder().decode(await readAll(Deno.stdin)).trim()
    if (!stdin) Deno.exit()

    if (opts.model) aiArgs.push("--model", opts.model)
    if (opts.file) aiArgs.push(await $`cb --xml ${opts.file}`.text())

    aiArgs.push(`<selection>\n${stdin}\n</selection>`)

    const prompt = promptArgs.join(" ")
    if (prompt) aiArgs.push(`<prompt>\n${prompt}\n</prompt>`)

    await $`ai ${aiArgs}`
  })
  .parse(Deno.args)
