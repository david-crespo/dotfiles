#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run=pbpaste

/*
 * Deno script that takes a set of file paths as positional args and prints
 * their contents, wrapped in markdown code blocks with the right language key
 * based on the extension. Used for piping files to my LLM CLI.
 */

import { extname } from "@std/path"
import { Command } from "@cliffy/command"
import $ from "@david/dax"

// adoc doesn't display right in glow but it does on github
const LANGS = ["rs", "ts", "tsx", "js", "json", "adoc", "sh", "html", "md"]

type FileSource = {
  heading: string | undefined
  content: string
  source: "file" | "clipboard" | "stdin"
}

// If any source's estimated rendered height (lines, after soft-wrapping long
// lines at WRAP_WIDTH) exceeds this, wrap every source in a <details> tag so
// long pastes don't blow out the page when posted to a GitHub gist.
const COLLAPSE_LINES = 40
const WRAP_WIDTH = 100

function renderedLines(s: string): number {
  return s.split("\n").reduce(
    (acc, line) => acc + Math.max(1, Math.ceil(line.length / WRAP_WIDTH)),
    0,
  )
}

async function getStdin() {
  if (Deno.stdin.isTerminal()) return undefined
  return (await new Response(Deno.stdin.readable).text()).trim() || undefined
}

await new Command()
  .name("cb")
  .description(
    `Wrap file or clipboard contents in markdown for sharing.

Input with a detectable language (file extension or --lang) renders as a
fenced code block. Input with no language renders as a blockquote.

If any input exceeds ${COLLAPSE_LINES} lines, every input is wrapped in
a <details> tag so big files don't fill up the page in a GitHub gist.`,
  )
  .helpOption("-h, --help", "Show help")
  .example("Filename", "cb script.ts")
  .example("Stdin", "cat script.ts | cb")
  .example("Auto paste", "cb")
  .example("Multiple files", "cb script.ts data.json")
  .example("File + clipboard", "cb script.ts -p")
  .example("Specify lang", "echo \"console.log('hi')\" | cb -l js")
  .arguments("[files...]")
  .option("-l, --lang <lang>", "Code block lang for stdin or clipboard")
  .option("-c, --code", "Force bare code fence for prose input (no language)")
  .option("-p, --paste", "Pull from pbpaste (automatic when no stdin or files)")
  .action(async (opts, ...files) => {
    const sources: FileSource[] = []

    // Collect stdin
    const stdin = await getStdin()
    const willUsePaste = opts.paste || (!stdin && files.length === 0)
    if (stdin) {
      // only show heading when it needs to be distinguished from other inputs
      const heading = !willUsePaste && files.length === 0 ? undefined : "[stdin]"
      sources.push({ heading, content: stdin, source: "stdin" })
    }

    // Collect clipboard if paste flag is passed OR automatically if
    // there is no stdin or files
    if (willUsePaste) {
      const content = await $`pbpaste`.text()
      if (content) {
        // only show heading when it needs to be distinguished from other inputs
        const heading = stdin || files.length > 0 ? "[clipboard contents]" : undefined
        sources.push({ heading, content, source: "clipboard" })
      }
    }

    // Collect files. On a missing/unreadable file, fail with a clean message on
    // stderr and a non-zero exit, leaving stdout empty so a downstream consumer
    // (e.g. `cb x | ai ...`) can tell the input never materialized.
    for (const filename of files) {
      let info: Deno.FileInfo
      try {
        info = await Deno.lstat(filename)
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          console.error(`cb: file not found: ${filename}`)
          Deno.exit(1)
        }
        throw e
      }
      if (!info.isFile) continue
      const content = await Deno.readTextFile(filename)
      sources.push({ heading: filename, content, source: "file" })
    }

    // If any source exceeds the threshold, wrap every source in <details>
    // for uniform presentation.
    const collapse = sources.some((s) => renderedLines(s.content) > COLLAPSE_LINES)

    for (const { heading, content, source } of sources) {
      const ext = heading ? extname(heading).slice(1) : ""
      // only fall back to opts.lang if file ext isn't good
      const lang = ext && LANGS.includes(ext) ? ext : opts.lang || ""

      let body: string
      if (lang === "md") {
        // markdown renders directly, no fence
        body = content
      } else if (lang || opts.code) {
        // known language, or --code forcing a bare fence
        body = `\`\`\`${lang}\n${content}\n\`\`\``
      } else if (collapse) {
        // <details> already delimits, so skip the blockquote
        body = content
      } else {
        // prose: blockquote as a clean markdown delimiter
        body = content.split("\n").map((line) => `> ${line}`).join("\n")
      }

      const lines: string[] = []
      if (collapse) {
        const summary = source === "clipboard"
          ? "Clipboard contents"
          : source === "stdin"
          ? "stdin"
          : heading
        lines.push(
          "<details>",
          `  <summary>${summary}</summary>\n`,
          body + "\n",
          "</details>",
        )
      } else {
        if (heading) lines.push(`\n### \`${heading}\`\n`)
        lines.push("", body + "\n")
      }

      console.log(lines.join("\n"))
    }
  })
  .parse(Deno.args)
