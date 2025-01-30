#!/usr/bin/env -S deno run --allow-read

/*
 * Deno script that takes a set of file paths as positional args and prints
 * their contents, wrapped in markdown code blocks with the right language key
 * based on the extension. Used for piping files to my LLM CLI.
 */

import { extname } from "jsr:@std/path@^1.0.8"
import { readAll } from "jsr:@std/io@0.225.1"
import { Command } from "jsr:@cliffy/command@1.0.0-rc.7"

// adoc doesn't display right in glow but it does on github
const LANGS = ["rs", "ts", "tsx", "js", "json", "adoc", "sh"]

function printFile(
  filename: string,
  content: string,
  details: boolean,
  langArg: string | undefined,
) {
  if (details) {
    console.log("<details>")
    console.log(`  <summary>${filename}</summary>\n`)
  } else {
    console.log(`\n---\n\n### \`${filename}\`\n\n`)
  }

  const ext = filename ? extname(filename).slice(1) : ""

  if (ext === "md" || langArg === "md") {
    // for markdown, just render the contents directly
    console.log(content)
    console.log()
    return
  }

  const lang = langArg || (LANGS.includes(ext) ? ext : "")
  console.log(`\`\`\`${lang}\n${content}\n\`\`\`\n`)

  if (details) console.log("</details>")
}

await new Command()
  .name("cb")
  .description(`
This script takes a set of file paths as positional args and prints their
contents, wrapped in markdown code blocks with the right language key based
on the extension. Used for piping files to my LLM CLI.`.trim())
  .helpOption("-h, --help", "Show help")
  .help({ hints: false }) // hides ugly (Conflicts: persona) hint
  .example("1)", "cb script.ts")
  .example("2)", "pbpaste | cb")
  .example("3)", "pbpaste | cb script.ts")
  .example("4)", "echo \"console.log('hi')\" | cb -l js data.json")
  .arguments("[files...]")
  .option("-l, --lang <lang:string>", "Code block lang for stdin")
  .option("-d, --details", "Wrap files in <details>", { default: false })
  // TODO: add -c to wrap in XML for claude
  .action(async (opts, ...files) => {
    if (!Deno.stdin.isTerminal()) {
      const stdin = new TextDecoder().decode(await readAll(Deno.stdin)).trim()
      if (stdin) printFile("[stdin]", stdin, opts.details, opts.lang)
    }

    for (const file of files) {
      if (!(await Deno.lstat(file)).isFile) continue
      const content = await Deno.readTextFile(file)
      const ext = extname(file).slice(1)
      const lang = LANGS.includes(ext) ? ext : "" // files ignore lang arg
      printFile(file, content, opts.details, lang)
    }
  })
  .parse(Deno.args)
