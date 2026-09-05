#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai

import $ from "@david/dax"
import { Command, ValidationError } from "@cliffy/command"
import { getGitHubRepoSlug } from "./lib/github.ts"
import { bookmarksInLogOrder } from "./lib/jj.ts"

const prompt = `Generate a short branch name from these PR commit descriptions.
Pick the main topic and omit secondary details and follow-up work.
Use 1-3 short words. Aim for 8-15 characters; maximum 19, including hyphens.
Drop filler like add, improve, support, and implementation. Use familiar words.
For upgrades, use package-version, e.g. vitest-5.
Return only the name in lowercase with hyphens. No prefixes, quotes, or markdown.`

/** If there are bookmarks between trunk() and r, let user pick. Otherwise use trunk(). */
async function pickBase(r: string) {
  // Query the in-between bookmarks and trunk() separately so trunk() lands at the
  // bottom of the list. Folding them into one revset lets jj's topological sort
  // float a diverged trunk to the top. Note the - on ${r}-: up to one change before r.
  const between = await bookmarksInLogOrder(`stack_bookmarks(${r}-)`)
  const trunk = await bookmarksInLogOrder(`trunk()`)
  const bookmarks = [...between, ...trunk]

  if (bookmarks.length === 1) return bookmarks[0]

  // Show a skeleton log of just @, trunk, the fork point, the candidate
  // bookmarks, and the tip r. jj elides the commits in between ("~ (elided
  // revisions)"), so this stays short even when the range has many commits. The
  // fork point anchors the bottom and connects the graph when trunk has diverged
  // from the stack.
  const skeleton =
    `@ | trunk() | ${r} | fork_point(trunk() | ${r}) | (bookmarks() & trunk()..${r})`
  await $`jj log -r ${skeleton}`.printCommand()

  const { value } = await $.select({
    message: "\nChoose base",
    options: bookmarks,
    noClear: true,
  })
  return value
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

    // Feed just the commit descriptions (no graph, no diff). The full diff can
    // be huge on branches that touch many files, and it's overkill for naming.
    const logTmpl = `description ++ "\n"`
    // Capture both streams instead of using .text(): ai prints its error output
    // to stdout, which .text() throws away, leaving only "Exited with code: 1".
    const aiResult = await $`jj log -r ${range} --no-graph -T ${logTmpl}`
      .pipe($`ai --system "${prompt}" --model luna --raw --ephemeral`)
      .stdout("piped")
      .stderr("piped")
      .noThrow()

    if (aiResult.code !== 0) {
      console.error(`\nai exited with code ${aiResult.code}`)
      const output = [aiResult.stdout, aiResult.stderr].join("").trim()
      if (output) console.error(output)
      Deno.exit(1)
    }

    const opts = { noClear: true, default: aiResult.stdout.trim() }
    const bookmark = await $.prompt("\nCreate branch?", opts)

    await $`jj git push --named ${bookmark}=${r}`.printCommand()
    // gh needs --repo because there's no .git dir in jj worktrees
    const repo = await getGitHubRepoSlug()
    await $`gh pr create --head ${bookmark} --base ${base} --repo ${repo} --web`
      .printCommand()
  })
  .parse(Deno.args)
