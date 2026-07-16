#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj

import { Command } from "@cliffy/command"
import $ from "@david/dax"
import { closestBookmark, revsetNonEmpty } from "./lib/jj.ts"

$.setErrorTail(true)

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
    const bm = bookmark ?? await closestBookmark()
    console.log(`bookmark: ${bm}`)

    await $`jj git fetch`

    // jj git fetch only advances the remote-tracking bookmark (fetched
    // bookmarks are untracked by default); the local bookmark stays put. So
    // target bm@origin, falling back to the local bookmark if it was never
    // pushed.
    const hasRemote = await revsetNonEmpty(`${bm}@origin`)

    if (!source) {
      const target = hasRemote ? `${bm}@origin` : bm
      if (await revsetNonEmpty(`${target} & ::@`)) {
        console.log(`already on top of ${bm}, nothing to do`)
        return
      }
      console.log(`checking out on top of ${bm}`)
      await $`jj new ${target}`
      return
    }

    const dest = hasRemote ? `${bm}@origin` : "trunk()"
    console.log(`rebasing ${source} onto ${dest}`)
    await $`jj rebase -s ${source} -d ${dest}`
  })
  .parse(Deno.args)
