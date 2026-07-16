#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh

import $ from "@david/dax"
import { getGitHubRepoSlug, listOpenPullRequests } from "./lib/github.ts"
import { stackBookmarks } from "./lib/jj.ts"

const bookmarks = await stackBookmarks()
if (bookmarks.length === 0) {
  throw new Error("No local bookmark found between trunk and the working copy")
}

const repo = await getGitHubRepoSlug()
const allPrs = await listOpenPullRequests(repo)
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
