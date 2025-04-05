#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai

import $ from "jsr:@david/dax@0.42.0"
import { Command } from "jsr:@cliffy/command@1.0.0-rc.7"

const prompt =
  "you will receive a diff and commit log for a PR. generate a branch name for it, ideally under 20 chars. use hyphens. no feat/ or similar prefix. just the branch name, no markdown"

await new Command()
  .name("jprc")
  .description($.dedent`
    Create a PR from a jj revision range. Creates branch at
    <revision> with name generated from diff using an LLM.`)
  .option("-r, --revision <revision>", "Tip for the PR", { default: "@-" })
  .option("-b, --base <branch>", "Base branch", { default: "main" })
  .helpOption("-h, --help", "Show help")
  .action(async ({ revision: r, base }) => {
    // make sure base is a branch
    const result = await $`jj bookmark list --remote origin ${base}`.text()
    if (!result) throw `Base '${base}' not found on origin. Base must be a branch.`

    console.log(`\nCreating PR on top of %c${base}\n`, "color: blue")

    const range = `${base}..${r}`
    await $`jj log -r ${range}`.printCommand()

    const generated = await $`jj diff -r ${range}; jj log -r ${range}`
      .pipe($`ai --system "${prompt}" -m flash --raw --ephemeral`)
      .text()

    const opts = { noClear: true, default: generated.trim() }
    const bookmark = await $.prompt("\nCreate branch?", opts)

    await $`jj bookmark create ${bookmark} -r ${r}`.printCommand()
    await $`jj git push -b ${bookmark} --allow-new`.printCommand()
    await $`gh pr create --head ${bookmark} --base ${base} --web`.printCommand()
  })
  .parse(Deno.args)
