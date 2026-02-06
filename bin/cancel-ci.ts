#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,open

import $ from "@david/dax"
import { Command } from "@cliffy/command"

interface CheckRun {
  id: number
  name: string
  status: string
  details_url: string
  started_at: string
  app: { slug: string }
}

interface CommitInfo {
  sha: string
  message: string
  date: string
}

interface WorkflowRun {
  id: number
  name: string
  status: string
  head_sha: string
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

async function findPrFromBookmark(): Promise<PrRef & { title: string; branch: string }> {
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

  return { owner, repo, pr: prInfo.number, title: prInfo.title, branch: bookmark }
}

async function getPrCommits(prRef: PrRef): Promise<string[]> {
  const commits: Commit[] =
    await $`gh api repos/${prRef.owner}/${prRef.repo}/pulls/${prRef.pr}/commits`
      .json()
  return commits.map((c) => c.sha)
}

async function getActiveCIShas(
  repoRef: RepoRef,
  branch: string,
): Promise<string[]> {
  const [inProgress, queued] = await Promise.all([
    $`gh api repos/${repoRef.owner}/${repoRef.repo}/actions/runs -f branch=${branch} -f status=in_progress --paginate --jq '.workflow_runs[].head_sha'`
      .text(),
    $`gh api repos/${repoRef.owner}/${repoRef.repo}/actions/runs -f branch=${branch} -f status=queued --paginate --jq '.workflow_runs[].head_sha'`
      .text(),
  ])
  const shas = `${inProgress}\n${queued}`
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(shas)]
}

async function getRunningChecks(
  commitRef: CommitRef,
): Promise<CheckRun[]> {
  const response =
    await $`gh api repos/${commitRef.owner}/${commitRef.repo}/commits/${commitRef.sha}/check-runs`
      .json() as { check_runs: CheckRun[] }
  return response.check_runs.filter((run) => run.status !== "completed")
}

async function getCommitInfo(commitRef: CommitRef): Promise<CommitInfo> {
  const response =
    await $`gh api repos/${commitRef.owner}/${commitRef.repo}/commits/${commitRef.sha}`
      .json() as { sha: string; commit: { message: string; committer: { date: string } } }
  return {
    sha: response.sha,
    message: response.commit.message.split("\n")[0], // first line only
    date: response.commit.committer.date,
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

async function cancelGitHubActionsRun(
  repoRef: RepoRef,
  runId: number,
): Promise<void> {
  await $`gh api repos/${repoRef.owner}/${repoRef.repo}/actions/runs/${runId}/cancel --method POST --silent`
    .noThrow()
}

async function main(prArg?: string, repoArg?: string) {
  let owner: string, repo: string, pr: number, branch: string

  if (prArg) {
    const prNum = parseInt(prArg, 10)
    if (isNaN(prNum)) throw new Error(`Invalid PR number: ${prArg}`)
    pr = prNum

    if (repoArg) {
      ;({ owner, repo } = parseRepo(repoArg))
    } else {
      ;({ owner, repo } = await getCurrentRepo())
    }
    branch = (await $`gh api repos/${owner}/${repo}/pulls/${pr} --jq .head.ref`
      .text()).trim()
  } else {
    ;({ owner, repo, pr, branch } = await findPrFromBookmark())
  }

  $.logStep(`Checking PR #${pr} in ${owner}/${repo}...`)
  const repoRef: RepoRef = { owner, repo }
  const prRef: PrRef = { ...repoRef, pr }

  // Get all commits: current PR commits + any with active workflow runs (includes force-pushed)
  const currentCommits = await getPrCommits(prRef)
  const activeCIShas = await getActiveCIShas(repoRef, branch)
  const allCommits = [...new Set([...currentCommits, ...activeCIShas])]

  // Find commits with running checks and fetch their info
  const commitsWithRunningCI: { info: CommitInfo; checks: CheckRun[] }[] = []
  for (const sha of allCommits) {
    const checks = await getRunningChecks({ ...repoRef, sha })
    if (checks.length > 0) {
      const info = await getCommitInfo({ ...repoRef, sha })
      commitsWithRunningCI.push({ info, checks })
    }
  }

  if (commitsWithRunningCI.length === 0) {
    $.log("No running CI found.")
    return
  }

  // Sort by date (most recent first) using check start time
  commitsWithRunningCI.sort((a, b) => {
    const aTime = Math.min(...a.checks.map((c) => new Date(c.started_at).getTime()))
    const bTime = Math.min(...b.checks.map((c) => new Date(c.started_at).getTime()))
    return bTime - aTime
  })

  // Select commit
  let selectedCommit: { info: CommitInfo; checks: CheckRun[] }
  if (commitsWithRunningCI.length === 1) {
    selectedCommit = commitsWithRunningCI[0]
    const startedAt = Math.min(
      ...selectedCommit.checks.map((c) => new Date(c.started_at).getTime()),
    )
    $.log(
      `${selectedCommit.info.sha.slice(0, 7)} ${
        selectedCommit.info.message.slice(0, 50)
      } (${
        formatRelativeTime(new Date(startedAt).toISOString())
      }, ${selectedCommit.checks.length} running)`,
    )
  } else {
    const options = commitsWithRunningCI.map((c) => {
      const startedAt = Math.min(...c.checks.map((ch) => new Date(ch.started_at).getTime()))
      const msg = c.info.message.length > 50
        ? c.info.message.slice(0, 47) + "..."
        : c.info.message
      return `${c.info.sha.slice(0, 7)} ${msg} (${
        formatRelativeTime(new Date(startedAt).toISOString())
      }, ${c.checks.length} running)`
    })
    const index = await $.select({
      message: "Select commit to cancel CI for:",
      options,
    })
    selectedCommit = commitsWithRunningCI[index]
  }

  // Confirm cancellation
  const confirmed = await $.confirm(
    `Cancel ${selectedCommit.checks.length} CI jobs for ${
      selectedCommit.info.sha.slice(0, 7)
    }?`,
  )
  if (!confirmed) {
    $.log("Cancelled.")
    return
  }

  $.logStep(`Cancelling CI for ${selectedCommit.info.sha.slice(0, 7)}...`)

  // Group checks by type
  const ghActionsChecks = selectedCommit.checks.filter((c) =>
    c.app.slug === "github-actions"
  )
  const externalChecks = selectedCommit.checks.filter((c) =>
    c.app.slug !== "github-actions"
  )

  // Cancel GitHub Actions
  if (ghActionsChecks.length > 0) {
    const runsUrl =
      `repos/${repoRef.owner}/${repoRef.repo}/actions/runs?head_sha=${selectedCommit.info.sha}&event=pull_request`
    const response = await $`gh api ${runsUrl}`.json() as { workflow_runs: WorkflowRun[] }

    const runsToCancel = response.workflow_runs.filter((r) => r.status !== "completed")
    await Promise.all(
      runsToCancel.map((run) => cancelGitHubActionsRun(repoRef, run.id)),
    )
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
