#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai

import $ from "jsr:@david/dax@0.42.0"
import { Command, ValidationError } from "jsr:@cliffy/command@1.0.0-rc.7"

const prompt =
  "you will receive a diff and commit log for a PR. generate a branch name for it, ideally under 20 chars. use hyphens. no feat/ or similar prefix. just the branch name, no markdown"

/** If there are bookmarks between main and r, let user pick. Otherwise use main. */
async function pickBase(r: string) {
  // Note the - on ${r}-, which means we go up to one change before r
  const lines = await $`jj bookmark list -r main..${r}- -T 'name++"\n"'`.lines()
  const existingBookmarks = lines.filter((x) => !!x)

  if (existingBookmarks.length === 0) return "main"

  // show existing bookmarks (don't log range because there could be too many commits)
  const options = [...existingBookmarks, "main"]
  await $`jj log ${options.map((o) => "-r " + o)}`.printCommand()

  const i = await $.select({ message: "\nChoose base", options, noClear: true })
  return options[i]
}

await new Command()
  .name("jprc")
  .description($.dedent`
    Create a PR from a jj revision range. Creates branch at
    <revision> with name generated from diff using an LLM.`)
  .option("-r, --revision <revision>", "Tip for the PR", { default: "@-" })
  .option("-b, --base <branch>", "Base branch")
  .helpOption("-h, --help", "Show help")
  .action(async ({ revision: r, ...args }) => {
    const base = args.base || await pickBase(r)

    // make sure base is a remote branch
    const result = await $`jj bookmark list --remote origin ${base}`.text()
    if (!result) throw new ValidationError(`Base '${base}' not found on origin.`)

    console.log(`\nCreating PR with base %c${base}\n`, "color: #ff6565")

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
