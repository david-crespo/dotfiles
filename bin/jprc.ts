#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh

import $ from "jsr:@david/dax@0.42.0"

await $`jj st`
console.log()

const bookmarks = (await $`jj bookmark list -r @ -T 'name++"\n"'`.lines()).filter(Boolean)

let bookmark: string

if (bookmarks.length === 0) {
  bookmark = (await $.prompt("No bookmarks found. Create one:", { noClear: true })).trim()
  if (!bookmark) Deno.exit()
  await $`jj bookmark create ${bookmark}`
} else if (bookmarks.length === 1) {
  bookmark = bookmarks[0]
} else {
  const i = await $.select({ message: "Pick a bookmark:", options: bookmarks })
  bookmark = bookmarks[i]
}

await $`jj git push -b ${bookmark} --allow-new`
await $`gh pr create --head ${bookmark} --web`
