#!/usr/bin/env -S deno run --allow-read

/*
 * Deno script that takes a set of file paths as positional args and prints
 * their contents, wrapped in markdown code blocks with the right language key
 * based on the extension. Used for piping files to my LLM CLI.
 */

import { extname } from "@std/path"
import { parseArgs } from "@std/cli"

// adoc doesn't display right in glow but it does on github
const LANGS = ["rs", "ts", "tsx", "js", "json", "adoc", "sh"]

const args = parseArgs(Deno.args, {
  boolean: ["collapse"],
  alias: { c: "collapse" },
})

for (const filename of args._) {
  const file = filename.toString()
  // only look at files
  if (!(await Deno.lstat(file)).isFile) continue

  if (args.collapse) {
    console.log("<details>")
    console.log(`  <summary>${file}</summary>\n`)
  } else {
    console.log(`\n---\n\n### \`${file}\`\n\n`)
  }

  const ext = extname(file).slice(1)
  const content = await Deno.readTextFile(file)

  if (ext === "md") {
    // for markdown, just render the contents directly
    console.log(content)
    console.log()
    continue
  }

  const lang = LANGS.includes(ext) ? ext : ""
  console.log(`\`\`\`${lang}\n${content}\n\`\`\`\n`)

  if (args.collapse) console.log("</details>")
}
