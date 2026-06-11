#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai

import $ from "@david/dax"
import { Command, ValidationError } from "@cliffy/command"

/** Extract GitHub owner/repo from jj's origin remote URL. */
async function getRepoSlug(): Promise<string> {
  const remotes = await $`jj git remote list`.lines()
  const originLine = remotes.find((r) => r.startsWith("origin"))
  if (!originLine) throw new Error("No origin remote found")
  const url = originLine.split(/\s+/)[1]
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/)
  if (!match) throw new Error(`Cannot parse GitHub repo from: ${url}`)
  return match[1]
}

const prompt =
  "you will receive the commit log for a PR. generate a branch name for it, ideally under 20 chars. use hyphens. no feat/ or similar prefix. just the branch name, no markdown"

/** Bookmark names on commits in revset, in jj log order (tip first). */
async function bookmarksInOrder(revset: string) {
  // Use jj log (not bookmark list, which sorts alphabetically) to preserve
  // topological order.
  const tmpl = `local_bookmarks.map(|b| b.name()).join("\n")++"\n"`
  const lines = await $`jj log -r ${revset} --no-graph -T ${tmpl}`.lines()
  return lines.filter((x) => !!x)
}

/** If there are bookmarks between trunk() and r, let user pick. Otherwise use trunk(). */
async function pickBase(r: string) {
  // Query the in-between bookmarks and trunk() separately so trunk() lands at the
  // bottom of the list. Folding them into one revset lets jj's topological sort
  // float a diverged trunk to the top. Note the - on ${r}-: up to one change before r.
  const between = await bookmarksInOrder(`trunk()..${r}-`)
  const trunk = await bookmarksInOrder(`trunk()`)
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
    const generated = await $`jj log -r ${range} --no-graph -T ${logTmpl}`
      .pipe($`ai --system "${prompt}" --model flash --quick --raw --ephemeral`)
      .text()

    const opts = { noClear: true, default: generated.trim() }
    const bookmark = await $.prompt("\nCreate branch?", opts)

    await $`jj git push --named ${bookmark}=${r}`.printCommand()
    // gh needs --repo because there's no .git dir in jj worktrees
    const repo = await getRepoSlug()
    await $`gh pr create --head ${bookmark} --base ${base} --repo ${repo} --web`
      .printCommand()
  })
  .parse(Deno.args)
