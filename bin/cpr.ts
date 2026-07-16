#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh

import $ from "@david/dax"

interface PullRequest {
  number: number
  title: string
  url: string
  headRefName: string
}

async function getRepoSlug(): Promise<string> {
  const remotes = await $`jj git remote list`.lines()
  const origin = remotes.find((line) => line.startsWith("origin "))?.split(/\s+/)[1]
  if (!origin) throw new Error("No origin remote found")

  const match = origin.match(/github\.com[:/](.+?)(?:\.git)?$/)
  if (!match) throw new Error(`Cannot parse GitHub repo from: ${origin}`)
  return match[1]
}

async function getStackBookmarks(): Promise<string[]> {
  const template = `local_bookmarks.map(|b| b.name()).join("\\n") ++ "\\n"`
  const lines =
    await $`jj log --ignore-working-copy --no-graph -r ${"trunk()..@ & bookmarks()"} -T ${template}`
      .lines()
  return lines.filter((line) => line.length > 0)
}

const bookmarks = await getStackBookmarks()
if (bookmarks.length === 0) {
  throw new Error("No local bookmark found between trunk and the working copy")
}

const repo = await getRepoSlug()
const allPrs =
  await $`gh pr list --repo ${repo} --state open --limit 1000 --json ${"number,title,url,headRefName"}`
    .json<PullRequest[]>()
const prsByBookmark = new Map(allPrs.map((pr) => [pr.headRefName, pr]))
const prs = bookmarks.flatMap((bookmark) => {
  const pr = prsByBookmark.get(bookmark)
  return pr ? [pr] : []
})

if (prs.length === 0) {
  throw new Error(`No open PR found for: ${bookmarks.join(", ")}`)
}

let pr = prs[0]
if (prs.length > 1) {
  const { index } = await $.select({
    message: "Choose PR",
    options: prs.map((candidate) => `#${candidate.number} ${candidate.title}`),
  })
  pr = prs[index]
}

await $`gh pr view --repo ${repo} ${pr.number} --web`
