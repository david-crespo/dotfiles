import $ from "@david/dax"

export interface PullRequestSummary {
  number: number
  title: string
  url: string
  headRefName: string
}

/** Extract GitHub owner/repo from jj's origin remote URL. */
export async function getGitHubRepoSlug(): Promise<string> {
  const remotes = await $`jj git remote list`.lines()
  const origin = remotes
    .map((line) => line.match(/^origin\s+(.+)$/)?.[1])
    .find((url) => url !== undefined)
  if (!origin) throw new Error("No origin remote found")

  const match = origin.match(/github\.com[:/](.+?)(?:\.git)?$/)
  if (!match) throw new Error(`Cannot parse GitHub repo from: ${origin}`)
  return match[1]
}

/** List every open PR in `repo`, including the head bookmark used to match JJ state. */
export async function listOpenPullRequests(repo: string): Promise<PullRequestSummary[]> {
  return await $`gh pr list --repo ${repo} --state open --limit 1000 --json ${"number,title,url,headRefName"}`
    .json<PullRequestSummary[]>()
}
