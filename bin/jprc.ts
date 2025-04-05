#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai,cb

import $ from "jsr:@david/dax@0.42.0"
import { parseArgs } from "jsr:@std/cli@1.0/parse-args"

const prompt =
  "generate a branch name for this change, ideally under 20 chars. use hyphens. no feat/ or similar prefix. just give the branch name, no markdown"

const { r, base } = parseArgs(Deno.args, {
  string: ["r", "base"],
  alias: { b: "base" },
  default: { r: "@-", base: "main" },
})

// make sure base is a branch
const result = await $`jj bookmark list --remote origin ${base}`.text()
if (!result) throw `Base '${base}' not found on origin. Base must be a branch.`

console.log(`\nCreating PR on top of %c${base}\n`, "color: blue")

const range = `${base}..${r}`
await $`jj log -r ${range}`.printCommand()

const generated = await $`jj diff -r ${range} | cb; jj log -r ${range} | cb`
  .pipe($`ai "${prompt}" -m flash --raw --ephemeral`)
  .text()

const bookmark = await $.prompt("\nCreate branch?", { noClear: true, default: generated })

await $`jj bookmark create ${bookmark} -r ${r}`.printCommand()
await $`jj git push -b ${bookmark} --allow-new`.printCommand()
await $`gh pr create --head ${bookmark} --base ${base} --web`.printCommand()
