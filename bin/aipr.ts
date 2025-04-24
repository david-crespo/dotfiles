#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai --allow-net=api.github.com

import $ from "jsr:@david/dax@0.43.0"
import { Command, ValidationError } from "jsr:@cliffy/command@1.0.0-rc.7"

const reviewSystemPrompt =
  "You are part of a focused, concise pull request review system. You will get example comments to show the kind of feedback we're looking for, plus the description and diff of the PR, plus possibly more files for context. Review the change for correctness, convention-following, elegance, and good user experience. Do not reproduce the diff except in small parts in order to comment on a few lines. Do not reproduce large chunks of the diff. Focus on substantive suggestions that improve correctness or clarity. Do NOT go through the change and listing and describing what the PR does in detail unless it is relevant to a suggested change."

const cb = (s: string, lang = "") => `\`\`\`${lang}\n${s}\n\`\`\``

type PrSelector = { owner: string; repo: string; pr: number }

const getPrArgs = (sel: PrSelector) => $.rawArg(`-R ${sel.owner}/${sel.repo} ${sel.pr}`)

async function getPrContext(sel: PrSelector) {
  const [fullPr, diff] = await Promise.all([
    $`gh pr view ${getPrArgs(sel)}`.text(),
    $`gh pr diff ${getPrArgs(sel)}`.text(),
  ])
  return ["# Body", fullPr, "# Diff", cb(diff)].join("\n\n") + "\n\n"
}

// TODO: need PR picker for when none is specified

function getRepoSelector(repoStr: string) {
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

const reviewCmd = new Command()
  .description("Review a PR")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)", { required: true })
  .arguments("<pr:integer>")
  .action(async (opts, pr) => {
    const { owner, repo } = getRepoSelector(opts.repo)
    const prContext = await getPrContext({ owner, repo, pr })
    // cat errors are automatically logged
    const exampleComments = await $`cat ~/comments.txt`.text().catch(() => "")
    await $`ai -e --system ${reviewSystemPrompt}`.stdinText(
      exampleComments + prContext + "Review the above change.",
    )
  })

const LOG_LINE_PREFIX = /^.+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g

// TODO: picker for which workflow run to debug

type Run = { conclusion: string; databaseId: number }

const debugCmd = new Command()
  .description("Debug recent CI failures")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)", { required: true })
  .arguments("<pr:integer>")
  .action(async (opts, pr) => {
    const { owner, repo } = getRepoSelector(opts.repo)
    const sel = { owner, repo, pr }
    const refArgs = getPrArgs(sel)
    const ref = await $`gh pr view --json headRefName --jq .headRefName ${refArgs}`.text()

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
  .option("-R,--repo <repo:string>", "Repo (owner/repo)", { required: true })
  .arguments("<pr:integer>")
  .action(async (opts, pr) => {
    const { owner, repo } = getRepoSelector(opts.repo)
    const prContext = await getPrContext({ owner, repo, pr })
    console.log(prContext)
  })

// TODO: repomap view and regen and clear

await new Command()
  .name("aipr")
  .description("Review PRs and debug CI failures.")
  .helpOption("-h, --help", "Show help")
  .command("review", reviewCmd)
  .command("debug-ci", debugCmd)
  .command("context", contextCmd)
  .parse(Deno.args)
