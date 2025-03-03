#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run=pbpaste

/*
 * Deno script that takes a set of file paths as positional args and prints
 * their contents, wrapped in markdown code blocks with the right language key
 * based on the extension. Used for piping files to my LLM CLI.
 */

import { extname } from "jsr:@std/path@^1.0.8"
import { readAll } from "jsr:@std/io@0.225.1"
import { Command } from "jsr:@cliffy/command@1.0.0-rc.7"
import $ from "jsr:@david/dax@0.42.0"

// adoc doesn't display right in glow but it does on github
const LANGS = ["rs", "ts", "tsx", "js", "json", "adoc", "sh"]

function printFile(
  filename: string,
  content: string,
  details: true | undefined,
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

async function getStdin() {
  if (Deno.stdin.isTerminal()) return undefined
  const stdin = new TextDecoder().decode(await readAll(Deno.stdin)).trim()
  return stdin || undefined
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
  .option("-d, --details", "Wrap files in <details>")
  .option("-p, --paste", "Pull from pbpaste")
  // TODO: add -c to wrap in XML for claude
  .action(async (opts, ...files) => {
    const stdin = await getStdin()
    if (stdin) printFile("[stdin]", stdin, opts.details, opts.lang)

    // pull from clipboard if paste flag is passed OR automatically if
    // there is no stdin or files
    if (opts.paste || (!stdin && files.length === 0)) {
      const content = await $`pbpaste`.text()
      if (content) printFile("[clipboard contents]", content, opts.details, opts.lang)
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
