#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,ai --allow-net=api.github.com

import $ from "jsr:@david/dax@0.43.0"
import { Command, ValidationError } from "jsr:@cliffy/command@1.0.0-rc.7"
import { Octokit } from "npm:@octokit/rest@21.1.1"

const octokit = new Octokit()

const reviewSystemPrompt =
  "You are part of a focused, concise pull request review system. You will get the description and diff of the PR, along with full copies of the modified files for context. Review the change for correctness and convention-following. Do not reproduce the diff except in parts in order to comment to comment on that part. Do not reproduce large chunks of the diff. Focus on substantive suggestions that improve correctness or clarity. Do NOT go through the change and listing and describing what the PR does in detail unless it is relevant to a suggested change."

const cb = (s: string, lang = "") => `\`\`\`${lang}\n${s}\n\`\`\``

type PrSelector = { owner: string; repo: string; pull_number: number }

async function getPrContext(args: PrSelector) {
  const [fullPr, diff] = await Promise.all([
    octokit.pulls.get(args),
    octokit.pulls.get({ ...args, mediaType: { format: "diff" } }),
  ])
  return [
    "# Body",
    fullPr.data.body,
    "# Diff",
    cb(diff.data as unknown as string),
  ].join("\n\n") + "\n\n"
}

// TODO: need PR picker for when none is specified

function getRepoSelector(repoStr: string) {
  const [owner, repo] = repoStr.split("/")
  if (!(owner && repo)) {
    throw new ValidationError(
      `Bad repo selector '${repoStr}'. Must look like oxidecomputer/console.`,
    )
  }
  return { owner, repo }
}

const reviewCmd = new Command()
  .description("Review a PR")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)", { required: true })
  .arguments("<pr:integer>")
  .action(async (opts, pr) => {
    const { owner, repo } = getRepoSelector(opts.repo)
    const prContext = await getPrContext({ owner, repo, pull_number: pr })
    await $`ai -e --system ${reviewSystemPrompt}`.stdinText(
      prContext + "Review the above change.",
    )
  })

const debugCmd = new Command()
  .description("Debug recent CI failures")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)", { required: true })
  .arguments("<pr:integer>")
  .action(async (opts, pr) => {
    const { owner, repo } = getRepoSelector(opts.repo)
    const args = { owner, repo, pull_number: pr }
    const ref = (await octokit.pulls.get(args)).data.head.ref

    const [prContext, failures] = await Promise.all([
      getPrContext({ owner, repo, pull_number: pr }),
      (octokit.actions.listWorkflowRunsForRepo({ owner, repo, branch: ref })).then(
        (resp) => resp.data.workflow_runs.filter((run) => run.conclusion === "failure"),
      ),
    ])

    // using gh because I couldn't figure out how to get the logs with octokit
    const output = (await Promise.all(
      failures.map((f) =>
        $`gh run view -R ${opts.repo} ${f.id} --log-failed`.text()
          // eat errors and log them
          .catch((e) => console.log(`Error fetching log for run ${f.id}`, e))
      ),
    )).join("\n\n")

    await $`ai -e 'Figure out why the diff might be causing this test failure.'`.stdinText(
      prContext + cb(output),
    )
  })

const contextCmd = new Command()
  .description("Print context to stdout")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)", { required: true })
  .arguments("<pr:integer>")
  .action(async (opts, pr) => {
    const { owner, repo } = getRepoSelector(opts.repo)
    const prContext = await getPrContext({ owner, repo, pull_number: pr })
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
