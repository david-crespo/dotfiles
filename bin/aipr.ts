#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=gh,ai,fzf --allow-net=api.github.com

import $ from "jsr:@david/dax@0.43.0"
import { Command, ValidationError } from "jsr:@cliffy/command@1.0.0-rc.7"

const reviewSystemPrompt =
  "You are part of a focused, concise pull request review system. You will get the description and diff of the PR, plus possibly more files for context. Review the change for correctness, convention-following, elegance, and good user experience. Do not reproduce the diff except in small parts in order to comment on a few lines. Do not reproduce large chunks of the diff. Focus on substantive suggestions that improve correctness or clarity. Do NOT go through the change and listing and describing what the PR does in detail unless it is relevant to a suggested change. Do not bother praising the change as important or good. At the top of your response, include a header like '## Review of [reponame#1234: PR Title Here](https://github.com/owner/reponame/pull/1234)'"

const cb = (s: string, lang = "") => `\`\`\`${lang}\n${s}\n\`\`\``

type RepoSel = { owner: string; repo: string }
type PrSel = RepoSel & { pr: number }

const getPrArgs = (sel: PrSel) => ["-R", `${sel.owner}/${sel.repo}`, sel.pr]

async function getPrContext(sel: PrSel) {
  const [fullPr, diff] = await Promise.all([
    $`gh pr view ${getPrArgs(sel)}`.text(),
    $`gh pr diff ${getPrArgs(sel)}`.text(),
  ])

  return ["# Body", fullPr, "# Diff", cb(diff, "diff")].join("\n\n")
}

const pickPr = ({ owner, repo }: RepoSel) =>
  $`gh pr list -R ${owner}/${repo} --limit 100 --json number,title,updatedAt,author --template \
    '{{range .}}{{tablerow .number .title .author.name (timeago .updatedAt)}}{{end}}' |
    fzf --height 25% --reverse --accept-nth=1`.json<number>()

function parseRepoSelector(repoStr: string): RepoSel {
  const parts = repoStr.split("/")
  if (parts.length === 1) {
    return { owner: "oxidecomputer", repo: parts[0] }
  } else if (parts.length === 2) {
    const [owner, repo] = parts
    return { owner, repo }
  }

  throw new ValidationError(
    `Bad repo selector '${repoStr}'. Must look like 'oxidecomputer/console' or 'console'.`,
  )
}

async function getCurrRepo(): Promise<RepoSel> {
  type Resp = { owner: { login: string }; name: string }
  const { name, owner } = await $`gh repo view --json name,owner`.json<Resp>()
  return { repo: name, owner: owner.login }
}

async function getPrSelector(repoStr: string | undefined, prArg: number | undefined) {
  // if the repo is not given, try to figure it out from the dir
  const { owner, repo } = repoStr ? parseRepoSelector(repoStr) : await getCurrRepo()
  await $`gh repo view ${owner}/${repo}`.text() // blow up early if repo doesn't exist
  const pr = prArg ? prArg : await pickPr({ owner, repo })
  if (!prArg) {
    console.log(`Reviewing PR #${pr} (https://github.com/${owner}/${repo}/pull/${pr})\n`)
  }
  return { owner, repo, pr }
}

const reviewCmd = new Command()
  .description("Review a PR")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .option("-p,--prompt <prompt:string>", "Additional instructions", { default: "" })
  .option("-m,--model <model:string>", "Model (passed to ai command)")
  .arguments("[pr:integer]")
  .action(async (opts, pr) => {
    const prSel = await getPrSelector(opts.repo, pr)
    const prContext = await getPrContext(prSel)

    const aiArgs = ["--system", reviewSystemPrompt]
    if (opts.model) aiArgs.push("-m", opts.model)

    await $`ai ${aiArgs}`.stdinText(
      prContext +
        `Review the above change, focusing on things to change or fix. Don't bother listing what's good about it beyond a sentence or two. Make sure to verify the claims in the PR body. ${opts.prompt}`,
    )
  })

const LOG_LINE_PREFIX = /^.+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g

// TODO: picker for which workflow run to debug

type Run = { conclusion: string; databaseId: number }

const debugCmd = new Command()
  .description("Debug recent CI failures")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .arguments("[pr:integer]")
  .action(async (opts, pr) => {
    const sel = await getPrSelector(opts.repo, pr)
    const refArgs = getPrArgs(sel)
    const ref = await $`gh pr view --json headRefName --jq .headRefName ${refArgs}`.text()

    const { owner, repo } = sel
    const [prContext, runs] = await Promise.all([
      getPrContext(sel),
      $`gh run list -R ${owner}/${repo} -b ${ref} --json databaseId,conclusion`
        .json<Run[]>(),
    ])

    const failureIds = runs
      .filter((r) => r.conclusion === "failure")
      .map((f) => f.databaseId)

    // first is most recent
    const failureId = failureIds.at(0)
    if (!failureId) {
      console.log("No run failures found")
      return
    }

    const log = (await $`gh run view -R ${owner}/${repo} ${failureId} --log-failed`.text()
      // eat errors and log them
      .catch((e) => {
        console.warn(`Error fetching log for run ${failureId}`, e)
        return ""
      }))
      // remove prefixes and cap number of lines
      .split("\n")
      .map((line) => line.replace(LOG_LINE_PREFIX, ""))
      .slice(-1000)
      .join("\n")

    await $`ai -e 'Figure out why the diff might be causing this test failure.'`.stdinText(
      prContext + cb(log),
    )
  })

const contextCmd = new Command()
  .description("Print context to stdout")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .arguments("[pr:integer]")
  .action(async (opts, pr) => {
    const prSel = await getPrSelector(opts.repo, pr)
    const prContext = await getPrContext(prSel)
    console.log(prContext)
  })

// TODO: repomap view and regen and clear
// TODO: make -R and PR number global options and define the commands inline here so the types are right

await new Command()
  .name("aipr")
  .description("Review PRs and debug CI failures.")
  .helpOption("-h, --help", "Show help")
  .action(() => {
    throw new ValidationError("Subcommand required")
  })
  .command("review", reviewCmd)
  .command("debug-ci", debugCmd)
  .command("context", contextCmd)
  .parse()
