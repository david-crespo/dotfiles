#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai

import $ from "jsr:@david/dax@0.42.0"
import { parseArgs } from "jsr:@std/cli@1.0/parse-args"

const prompt =
  "generate a branch name for this change, ideally under 20 chars. dont make up a PR number. use hyphens, not underscores. just give the branch name, no markdown stuff"

const { r } = parseArgs(Deno.args, { string: ["r"], default: { r: "@-" } })

const bookmarks = (await $`jj bookmark list -r ${r} -T 'name++"\n"'`.lines())
  .filter((x) => !!x)

let bookmark: string
if (bookmarks.length === 0) {
  const generated =
    await $`jj diff -r 'main..${r}' | ai "${prompt}" -m groq-llama --raw --ephemeral`
      .text()
  bookmark = (await $.prompt(
    "No bookmarks found. Enter name:",
    { noClear: true, default: generated },
  )).trim()
  await $`jj bookmark create ${bookmark} -r ${r}`
} else if (bookmarks.length === 1) {
  bookmark = bookmarks[0]
} else {
  const i = await $.select({ message: "Pick a bookmark:", options: bookmarks })
  bookmark = bookmarks[i]
}

await $`jj git push -b ${bookmark} --allow-new`
await $`gh pr create --head ${bookmark} --web`
