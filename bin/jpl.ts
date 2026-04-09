#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj

import { Command } from "@cliffy/command"
import $ from "@david/dax"

async function currBookmark(): Promise<string> {
  const tmpl = 'bookmarks.map(|b| b.name()).join("\\n")'
  const lines = await $`jj log --no-graph -r 'heads(::@ & bookmarks())' -T ${tmpl}`
    .lines()
  const name = lines.find((l) => l.trim())
  if (!name) {
    console.error("No bookmark found in ancestors of @")
    Deno.exit(1)
  }
  return name.trim()
}

async function revExists(rev: string): Promise<boolean> {
  const r = await $`jj log --no-graph -r ${rev} -T '""'`.noThrow().quiet()
  return r.code === 0
}

await new Command()
  .name("jpl")
  .description(
    "Fetch and pull upstream changes under your work.\n\n" +
      "With no args, fetches and checks out on top of the nearest bookmark.\n" +
      "With -s, rebases that subtree onto the updated bookmark\n" +
      "(or trunk if the bookmark was merged/deleted).",
  )
  .option("-s, --source <rev:string>", "Rev to rebase (like jj rebase -s)")
  .option(
    "-b, --bookmark <name:string>",
    "Bookmark to pull (default: nearest ancestor bookmark)",
  )
  .action(async ({ source, bookmark }: { source?: string; bookmark?: string }) => {
    const bm = bookmark ?? await currBookmark()
    console.log(`bookmark: ${bm}`)

    await $`jj git fetch`

    if (!source) {
      if (await revExists(`${bm} & ::@`)) {
        console.log(`already on top of ${bm}, nothing to do`)
        return
      }
      console.log(`checking out on top of ${bm}`)
      await $`jj new ${bm}`
      return
    }

    const dest = (await revExists(`${bm}@origin`)) ? bm : "trunk()"
    console.log(`rebasing ${source} onto ${dest}`)
    await $`jj rebase -s ${source} -d ${dest}`
  })
  .parse(Deno.args)
