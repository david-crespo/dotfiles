#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh

import $ from "jsr:@david/dax@0.42.0"
import { parseArgs } from "jsr:@std/cli@1.0/parse-args"

const { r } = parseArgs(Deno.args, { string: ["r"], default: { r: "@" } })

await $`jj diff --stat -r ${r}`
console.log()

const bookmarks = await $`jj bookmark list -r ${r} -T 'name++"\n"'`.lines().then((bs) =>
  bs.filter((x) => !!x)
)

let bookmark: string

if (bookmarks.length === 0) {
  bookmark = (await $.prompt("No bookmarks found. Create one:", { noClear: true })).trim()
  if (!bookmark) Deno.exit()
  await $`jj bookmark create ${bookmark} -r ${r}`
} else if (bookmarks.length === 1) {
  bookmark = bookmarks[0]
} else {
  const i = await $.select({ message: "Pick a bookmark:", options: bookmarks })
  bookmark = bookmarks[i]
}

await $`jj git push -b ${bookmark} --allow-new`
await $`gh pr create --head ${bookmark} --web`
