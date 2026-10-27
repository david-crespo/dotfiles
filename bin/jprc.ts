#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai,glow

import $ from "@david/dax"
import { Command, ValidationError } from "@cliffy/command"
import { getGitHubRepoSlug } from "./lib/github.ts"
import { bookmarksInLogOrder } from "./lib/jj.ts"

// Tuned against real console and omicron branch names. Size labels on commits
// matter as much as the wording: without them, small newest commits like "fix
// test" or "bump api" pull the name away from the bulk of the change.
const prompt = $.dedent`
  Name the git branch for a pull request. The input is the PR's commit descriptions, newest first, or the PR's title and body. When there are several commits, each is labeled with how much of the PR it accounts for.

  Name what the PR is mostly about. Weight each commit by its size: a large commit is the bulk of the change, while small commits are usually tests, review fixes, cleanup, or incidental tweaks, even when they are newest. The oldest commit often states the intent.

  Style:
  - 2-4 lowercase words joined by hyphens, usually 10-22 characters.
  - Plain words a teammate would recognize. Name the feature or area, plus a verb when it matters: fix-, remove-, bump-, rename-, move-, no-. Skip filler verbs like add, improve, support, implement, update.
  - Don't abbreviate words unless the abbreviation is common (api, ui, e2e, ip).
  - Dependency upgrades: package and major version, with hyphens for dots, e.g. vite-7, react-19-2.
  - No prefixes like feat/ or fix/.

  Output only the branch name, even if the commits are vague. No quotes, explanation, or markdown.`

/** Lockfiles and generated code, left out of commit sizes so a lockfile
 * churn or API client regen doesn't look like the bulk of a PR. */
const generatedFiles = [
  "**/package-lock.json",
  "**/*.lock",
  "openapi/**",
  "**/__generated__/**",
  "**/tests/output/**",
].map((g) => `root-glob:"${g}"`).join(" | ")

/** If there are bookmarks between trunk() and r, let user pick. Otherwise use trunk(). */
async function pickBase(r: string) {
  // Query the in-between bookmarks and trunk() separately so trunk() lands at the
  // bottom of the list. Folding them into one revset lets jj's topological sort
  // float a diverged trunk to the top. Note the - on (${r})-: up to one change before r.
  const between = await bookmarksInLogOrder(`bookmarks() & trunk()..(${r})-`)
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
    <revision> with name generated from diff using an LLM.

    With --body, the title comes from the file's first line, which
    must be a markdown h1, and the body is the rest of the file. The
    PR is created directly and opened in the browser.`)
  .option("-r, --revision <revision>", "Tip for the PR", { default: "@-" })
  .option("-n, --name <name>", "Branch name (skips LLM naming)")
  .option("-d, --draft", "Create the PR as a draft")
  .option(
    "-b, --body [file]",
    "Markdown file with '# title' first line and PR body. Without a file, uses the newest *-pr*.md in .claude/notes",
  )
  .helpOption("-h, --help", "Show help")
  .action(async ({ revision: r, name, body, draft }) => {
    const bodyFile = body === true ? await newestPrDraft() : body
    const pr = bodyFile ? await readPrFile(bodyFile) : undefined

    const base = await pickBase(r)

    // make sure base is a remote branch
    const result = await $`jj bookmark list --remote origin ${base}`.text()
    if (!result) throw new ValidationError(`Base '${base}' not found on origin.`)

    console.log(`\nCreating PR with base %c${base}\n`, "color: #ff6565")

    const range = `${base}..${r}`
    await $`jj log -r ${range}`.printCommand()

    // The PR body, when present, describes the change better than the commit
    // descriptions do, so name from it instead.
    const suggested = name ??
      await suggestBranchName(
        pr ? `# ${pr.title}\n\n${pr.body}` : await commitDescriptions(range),
      )

    if (pr) {
      console.log()
      const md = `# ${pr.title}\n\n${pr.body}`
      if (await $.commandExists("glow")) {
        await $`glow -`.stdinText(md)
      } else {
        console.log(md)
      }
    }

    const opts = { noClear: true, default: suggested }
    const bookmark = await $.prompt(
      pr
        ? `\nCreate branch and ${draft ? "draft " : ""}PR with the above title and body?`
        : "\nCreate branch?",
      opts,
    )

    await $`jj git push --named ${bookmark}=${r}`.printCommand()
    // gh needs --repo because there's no .git dir in jj worktrees
    const repo = await getGitHubRepoSlug()
    const args = ["--head", bookmark, "--base", base, "--repo", repo]
    if (draft) args.push("--draft")
    if (!pr) {
      await $`gh pr create ${args} --web`.printCommand()
      return
    }
    // --body-file - reads the body from stdin, avoiding shell quoting and temp files
    const url = await $`gh pr create ${args} --title ${pr.title} --body-file -`
      .stdinText(pr.body)
      .printCommand()
      .text()
    console.log(url)
    await $`gh pr view ${url} --web`
  })
  .parse(Deno.args)

/** Newest *-pr*.md in .claude/notes at the repo root, by modification time. */
async function newestPrDraft() {
  const dir = `${await $`jj root`.text()}/.claude/notes`
  let newest: { path: string; mtime: number } | undefined
  const entries = await Array.fromAsync(Deno.readDir(dir)).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile || !/-pr\b.*\.md$/.test(entry.name)) continue
    const path = `${dir}/${entry.name}`
    const mtime = (await Deno.stat(path)).mtime?.getTime() ?? 0
    if (!newest || mtime > newest.mtime) newest = { path, mtime }
  }
  if (!newest) throw new ValidationError(`No *-pr*.md draft found in ${dir}`)
  console.log(`Using PR draft %c${newest.path}`, "color: #ff6565")
  return newest.path
}

/** Parse a markdown file into a PR title (the h1 on line 1) and body (the rest). */
async function readPrFile(path: string) {
  const text = await Deno.readTextFile(path)
  const [first, ...rest] = text.split("\n")
  const title = first.match(/^# (.+)$/)?.[1]?.trim()
  if (!title) {
    throw new ValidationError(`First line of ${path} must be a markdown h1 ('# title')`)
  }
  const body = rest.join("\n").trim() + "\n"
  return { title, body }
}

/** Commit descriptions in range (no graph, no diff), each labeled with its
 * share of the changed lines when there's more than one. The full diff can be
 * huge on branches that touch many files, and it's overkill for naming. */
async function commitDescriptions(range: string) {
  const diff = `self.diff(${JSON.stringify(`~(${generatedFiles})`)})`
  const stat = `${diff}.stat()`
  const logTmpl = [
    `json(description)`,
    `${stat}.total_added() + ${stat}.total_removed()`,
    `${diff}.files().len()`,
  ].join(` ++ "\\t" ++ `) + ` ++ "\\n"`
  const commits = (await $`jj log -r ${range} --no-graph -T ${logTmpl}`.lines())
    .filter(Boolean)
    .map((line) => {
      const [desc, lines, files] = line.split("\t")
      return { desc: (JSON.parse(desc) as string).trim(), lines: +lines, files: +files }
    })
  if (commits.length === 1) return commits[0].desc + "\n"

  const total = commits.reduce((sum, c) => sum + c.lines, 0)
  return commits.map((c) => {
    const share = total ? `, ${Math.round((100 * c.lines) / total)}% of the PR` : ""
    const label = `[${c.lines} line${c.lines === 1 ? "" : "s"} changed in ${c.files} file${
      c.files === 1 ? "" : "s"
    }${share}]`
    return `${label}\n${c.desc}`
  }).join("\n\n") + "\n"
}

/** Ask the LLM for a branch name from a description of the change. */
async function suggestBranchName(input: string) {
  // Capture both streams instead of using .text(): ai prints its error output
  // to stdout, which .text() throws away, leaving only "Exited with code: 1".
  // The schema keeps Sonnet from occasionally answering with its reasoning
  const schema = `{ name: "string" }`
  const aiResult =
    await $`ai --system ${prompt} --model sonnet -o ${schema} --raw --ephemeral`
      .stdinText(input)
      .stdout("piped")
      .stderr("piped")
      .noThrow()

  if (aiResult.code !== 0) {
    console.error(`\nai exited with code ${aiResult.code}`)
    const output = [aiResult.stdout, aiResult.stderr].join("").trim()
    if (output) console.error(output)
    Deno.exit(1)
  }
  return (JSON.parse(aiResult.stdout) as { name: string }).name.trim()
}
