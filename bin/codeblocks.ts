#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run=pbpaste

/*
 * Deno script that takes a set of file paths as positional args and prints
 * their contents, wrapped in markdown code blocks with the right language key
 * based on the extension. Used for piping files to my LLM CLI.
 */

import { extname } from "@std/path"
import { readAll } from "@std/io"
import { Command } from "@cliffy/command"
import $ from "@david/dax"

// adoc doesn't display right in glow but it does on github
const LANGS = ["rs", "ts", "tsx", "js", "json", "adoc", "sh", "html", "md"]

// deno-lint-ignore no-explicit-any
type ExtractOptions<T extends Command<any>> = T extends // deno-lint-ignore no-explicit-any
Command<any, any, infer TOptions> ? TOptions
  : never

type Opts = ExtractOptions<typeof command>

type FileSource = {
  heading: string | undefined
  content: string
}

function formatFile(
  /** Filename for files or label for clipboard or stdin */
  heading: string | undefined,
  content: string,
  opts: Opts = {},
): string {
  const lines: string[] = []

  if (opts.xml) {
    lines.push("<file>")
    if (heading) lines.push(`  <name>${heading}</name>`)
    lines.push(`  <contents>\n${content}</contents>`)
    lines.push("</file>")
    return lines.join("\n")
  }

  if (opts.quote) {
    return content.split("\n").map((line) => `> ${line}`).join("\n") + "\n"
  }

  if (opts.details) {
    lines.push("<details>")
    if (heading) lines.push(`  <summary>${heading}</summary>\n`)
  } else if (heading) {
    lines.push(`\n### \`${heading}\`\n\n`)
  }

  const ext = heading ? extname(heading).slice(1) : ""
  // only fall back to opts.lang if file ext isn't good
  const lang = ext && LANGS.includes(ext) ? ext : opts.lang || ""

  // for markdown, just render the contents directly, no block
  if (lang === "md") {
    lines.push(content + "\n")
  } else {
    lines.push(`\`\`\`${lang}\n${content}\n\`\`\`\n`)
  }

  if (opts.details) lines.push("</details>")

  return lines.join("\n")
}

async function getStdin() {
  if (Deno.stdin.isTerminal()) return undefined
  return new TextDecoder().decode(await readAll(Deno.stdin)).trim() || undefined
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
  .option("-p, --paste", "Pull from pbpaste (automatic when no stdin or files)")
  .option("-x, --xml", "Wrap files in XML for Claude")
  .option("-q, --quote", "Use > to quote instead of code blocks")
  .action(async (opts, ...files) => {
    const sources: FileSource[] = []

    // Collect stdin
    const stdin = await getStdin()
    const willUsePaste = opts.paste || (!stdin && files.length === 0)
    if (stdin) {
      // only show heading when it needs to be distinguished from other inputs
      const heading = !willUsePaste && files.length === 0 ? undefined : "[stdin]"
      sources.push({ heading, content: stdin })
    }

    // Collect clipboard if paste flag is passed OR automatically if
    // there is no stdin or files
    if (willUsePaste) {
      const content = await $`pbpaste`.text()
      if (content) {
        // only show heading when it needs to be distinguished from other inputs
        const heading = stdin || files.length > 0 ? "[clipboard contents]" : undefined
        sources.push({ heading, content })
      }
    }

    // Collect files
    for (const filename of files) {
      if (!(await Deno.lstat(filename)).isFile) continue
      const content = await Deno.readTextFile(filename)
      sources.push({ heading: filename, content })
    }

    // Print all sources with dividers between them
    for (let i = 0; i < sources.length; i++) {
      const { heading, content } = sources[i]
      const isFirst = i === 0

      // Print divider before this file (but not before the first one)
      if (!isFirst && !opts.xml && !opts.details && heading) {
        console.log("\n---\n")
      }

      console.log(formatFile(heading, content, opts))
    }
  })

await command.parse(Deno.args)
