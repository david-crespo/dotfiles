#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,open

import $ from "@david/dax"
import { Command } from "@cliffy/command"

interface CheckRun {
  id: number
  name: string
  status: string
  details_url: string
  app: { slug: string }
}

interface WorkflowRun {
  id: number
  name: string
  status: string
}

interface TimelineEvent {
  event: string
  before?: string
}

interface Commit {
  sha: string
  commit: { message: string }
}

interface PrInfo {
  number: number
  title: string
  url: string
}

interface RepoRef {
  owner: string
  repo: string
}

type CommitRef = RepoRef & { sha: string }
type PrRef = RepoRef & { pr: number }

function parseRepo(repoArg: string): { owner: string; repo: string } {
  const parts = repoArg.split("/")
  if (parts.length === 1) {
    // repo only, assume oxidecomputer org
    return { owner: "oxidecomputer", repo: parts[0] }
  } else if (parts.length === 2) {
    return { owner: parts[0], repo: parts[1] }
  }
  throw new Error(`Invalid repo reference: ${repoArg}`)
}

async function getCurrentRepo(): Promise<RepoRef> {
  const text = await $`gh repo view --json owner,name --jq '.owner.login + "/" + .name'`
    .text()
  const [owner, repo] = text.trim().split("/")
  if (!owner || !repo) throw new Error("Not in a GitHub repository")
  return { owner, repo }
}

async function findPrFromBookmark(): Promise<PrRef & { title: string }> {
  const bookmarksOutput =
    await $`jj log -r 'ancestors(@, 10) & bookmarks()' --no-graph -T 'local_bookmarks ++ "\n"'`
      .text()
  const bookmarks = bookmarksOutput
    .split("\n")
    .map((b: string) => b.trim())
    .filter((b: string) => b && b !== "main")

  if (bookmarks.length === 0) {
    throw new Error("No feature branch bookmark found in recent ancestors")
  }

  const bookmark = bookmarks[0]
  const prInfo: PrInfo = await $`gh pr view ${bookmark} --json number,title,url`.json()

  const { owner, repo } = await getCurrentRepo()

  const confirmed = await $.confirm(`Cancel CI for PR #${prInfo.number}: ${prInfo.title}?`)
  if (!confirmed) {
    $.logError("Cancelled")
    Deno.exit(1)
  }

  return { owner, repo, pr: prInfo.number, title: prInfo.title }
}

async function getPrCommits(prRef: PrRef): Promise<string[]> {
  const commits: Commit[] =
    await $`gh api repos/${prRef.owner}/${prRef.repo}/pulls/${prRef.pr}/commits`
      .json()
  return commits.map((c) => c.sha)
}

async function getForcePushedCommits(prRef: PrRef): Promise<string[]> {
  const events: TimelineEvent[] =
    await $`gh api repos/${prRef.owner}/${prRef.repo}/issues/${prRef.pr}/timeline --paginate`
      .json()
  return events
    .filter((e) => e.event === "head_ref_force_pushed" && e.before)
    .map((e) => e.before!)
}

async function getRunningChecks(
  commitRef: CommitRef,
): Promise<CheckRun[]> {
  const response =
    await $`gh api repos/${commitRef.owner}/${commitRef.repo}/commits/${commitRef.sha}/check-runs`
      .json() as { check_runs: CheckRun[] }
  return response.check_runs.filter((run) => run.status !== "completed")
}

async function cancelGitHubActions(
  commitRef: CommitRef,
): Promise<void> {
  const response =
    await $`gh api repos/${commitRef.owner}/${commitRef.repo}/actions/runs?head_sha=${commitRef.sha}&event=pull_request`
      .json() as { workflow_runs: WorkflowRun[] }

  await Promise.all(
    response.workflow_runs.map((run) =>
      $`gh api repos/${commitRef.owner}/${commitRef.repo}/actions/runs/${run.id}/cancel --method POST --silent`
        .noThrow()
    ),
  )
}

async function main(prArg?: string, repoArg?: string) {
  let owner: string, repo: string, pr: number

  if (prArg) {
    const prNum = parseInt(prArg, 10)
    if (isNaN(prNum)) throw new Error(`Invalid PR number: ${prArg}`)
    pr = prNum

    if (repoArg) {
      ;({ owner, repo } = parseRepo(repoArg))
    } else {
      ;({ owner, repo } = await getCurrentRepo())
    }
  } else {
    ;({ owner, repo, pr } = await findPrFromBookmark())
  }

  $.logStep(`Checking PR #${pr} in ${owner}/${repo}...`)
  const repoRef: RepoRef = { owner, repo }
  const prRef: PrRef = { ...repoRef, pr }

  // Get all commits: current + force-pushed
  const currentCommits = await getPrCommits(prRef)
  const forcePushedCommits = await getForcePushedCommits(prRef)
  const allCommits = [...new Set([...currentCommits, ...forcePushedCommits])]

  // Find commits with running checks
  const commitsWithRunningCI: { sha: string; checks: CheckRun[] }[] = []
  for (const sha of allCommits) {
    const checks = await getRunningChecks({ ...repoRef, sha })
    if (checks.length > 0) {
      commitsWithRunningCI.push({ sha, checks })
    }
  }

  if (commitsWithRunningCI.length === 0) {
    $.log("No running CI found.")
    return
  }

  // Select commit if multiple
  let selectedCommit: { sha: string; checks: CheckRun[] }
  if (commitsWithRunningCI.length === 1) {
    selectedCommit = commitsWithRunningCI[0]
  } else {
    const options = commitsWithRunningCI.map((c) =>
      `${c.sha.slice(0, 7)} (${c.checks.length} running)`
    )
    const index = await $.select({
      message: "Select commit to cancel CI for:",
      options,
    })
    selectedCommit = commitsWithRunningCI[index]
  }

  $.logStep(`Cancelling CI for ${selectedCommit.sha.slice(0, 7)}...`)

  // Group checks by type
  const ghActionsChecks = selectedCommit.checks.filter((c) =>
    c.app.slug === "github-actions"
  )
  const externalChecks = selectedCommit.checks.filter((c) =>
    c.app.slug !== "github-actions"
  )

  // Cancel GitHub Actions
  if (ghActionsChecks.length > 0) {
    await cancelGitHubActions({ ...repoRef, sha: selectedCommit.sha })
  }

  // Open external CI in browser
  for (const check of externalChecks) {
    $.logStep(`Opening ${check.name} in browser...`)
    await $`open ${check.details_url}`
  }

  $.log("Done.")
}

await new Command()
  .name("cancel-ci")
  .description("Cancel CI jobs on PR commits, including force-pushed ones")
  .option(
    "-R, --repo <repo:string>",
    "Repository (owner/repo, or just repo if Oxide)",
  )
  .arguments("[pr:number]")
  .action(({ repo }, pr?: number) => main(pr?.toString(), repo))
  .parse(Deno.args)
