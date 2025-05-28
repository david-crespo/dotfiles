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
const LANGS = ["rs", "ts", "tsx", "js", "json", "adoc", "sh", "html"]

// deno-lint-ignore no-explicit-any
type ExtractOptions<T extends Command<any>> = T extends // deno-lint-ignore no-explicit-any
Command<any, any, infer TOptions> ? TOptions
  : never

type Opts = ExtractOptions<typeof command>

function printFile(
  /** Filename for files or label for clipboard or stdin */
  heading: string,
  content: string,
  { details, lang, xml, quote }: Opts = {},
) {
  if (xml) {
    console.log(`<file>`)
    console.log(`  <name>${heading}</name>`)
    console.log(`  <contents>\n${content}</contents>`)
    console.log(`</file>`)
    return
  }

  if (quote) {
    console.log(content.split("\n").map((line) => `> ${line}`).join("\n") + "\n")
    return
  }

  if (details) {
    console.log("<details>")
    console.log(`  <summary>${heading}</summary>\n`)
  } else {
    console.log(`\n---\n\n### \`${heading}\`\n\n`)
  }

  const ext = heading ? extname(heading).slice(1) : ""

  if (ext === "md" || lang === "md") {
    // for markdown, just render the contents directly
    console.log(content)
    console.log()
    return
  }

  const calcLang = lang || (LANGS.includes(ext) ? ext : "")
  console.log(`\`\`\`${calcLang}\n${content}\n\`\`\`\n`)

  if (details) console.log("</details>")
}

async function getStdin() {
  if (Deno.stdin.isTerminal()) return undefined
  const stdin = new TextDecoder().decode(await readAll(Deno.stdin)).trim()
  return stdin || undefined
}

const command = new Command()
  .name("cb")
  .description(`Wrap file or clipboard contents in markdown codeblocks or XML tags.`)
  .helpOption("-h, --help", "Show help")
  .example("Filename", "cb script.ts")
  .example("Stdin", "cat script.ts | cb")
  .example("Auto pbpaste", "cb")
  .example("Multiple files", "cb script.ts data.json")
  .example("Specify lang", "echo \"console.log('hi')\" | cb -l js")
  .example("XML for Claude", "cb --xml script.ts")
  .example("Details tag", "cb --details script.ts")
  .arguments("[files...]")
  .option("-l, --lang <lang>", "Code block lang for stdin")
  .option("-d, --details", "Wrap files in <details>")
  .option("-p, --paste", "Pull from pbpaste (automatic when no other args)")
  .option("-x, --xml", "Wrap files in XML for Claude")
  .option("-q, --quote", "Use > to quote instead of code blocks")
  .action(async (opts, ...files) => {
    const stdin = await getStdin()
    if (stdin) printFile("[stdin]", stdin, opts)

    // pull from clipboard if paste flag is passed OR automatically if
    // there is no stdin or files
    if (opts.paste || (!stdin && files.length === 0)) {
      const content = await $`pbpaste`.text()
      if (content) printFile("[clipboard contents]", content, opts)
    }

    for (const filename of files) {
      if (!(await Deno.lstat(filename)).isFile) continue
      const content = await Deno.readTextFile(filename)
      printFile(filename, content, opts)
    }
  })

await command.parse(Deno.args)
