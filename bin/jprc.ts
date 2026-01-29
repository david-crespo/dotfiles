#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai

import $ from "@david/dax"
import { Command, ValidationError } from "@cliffy/command"

const prompt =
  "you will receive a diff and commit log for a PR. generate a branch name for it, ideally under 20 chars. use hyphens. no feat/ or similar prefix. just the branch name, no markdown"

/** If there are bookmarks between trunk() and r, let user pick. Otherwise use trunk(). */
async function pickBase(r: string) {
  // Note the - on ${r}-, which means we go up to one change before r
  const lines = await $`jj bookmark list -r 'trunk()..${r}-|trunk()' -T 'name++"\n"'`
    .lines()
  const bookmarks = lines.filter((x) => !!x)

  if (bookmarks.length === 1) return bookmarks[0]

  // show existing bookmarks (don't log range because there could be too many commits)
  await $`jj log ${bookmarks.flatMap((o) => ["-r", o])}`.printCommand()

  const i = await $.select({ message: "\nChoose base", options: bookmarks, noClear: true })
  return bookmarks[i]
}

await new Command()
  .name("jprc")
  .description($.dedent`
    Create a PR from a jj revision range. Creates branch at
    <revision> with name generated from diff using an LLM.`)
  .option("-r, --revision <revision>", "Tip for the PR", { default: "@-" })
  .helpOption("-h, --help", "Show help")
  .action(async ({ revision: r }) => {
    const base = await pickBase(r)

    // make sure base is a remote branch
    const result = await $`jj bookmark list --remote origin ${base}`.text()
    if (!result) throw new ValidationError(`Base '${base}' not found on origin.`)

    console.log(`\nCreating PR with base %c${base}\n`, "color: #ff6565")

    const range = `${base}..${r}`
    await $`jj log -r ${range}`.printCommand()

    const generated = await $`jj diff -r ${range}; jj log -r ${range}`
      .pipe($`ai --system "${prompt}" --model flash --quick --raw --ephemeral`)
      .text()

    const opts = { noClear: true, default: generated.trim() }
    const bookmark = await $.prompt("\nCreate branch?", opts)

    await $`jj git push --named ${bookmark}=${r}`.printCommand()
    await $`gh pr create --head ${bookmark} --base ${base} --web`.printCommand()
  })
  .parse(Deno.args)
