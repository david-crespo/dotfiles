#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,gh,fzf,git

import $ from "@david/dax"

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

/**
 * Resolve the git dir backing the current jj repo. In a non-default workspace
 * .jj/repo is a text file pointing at the default's .jj/repo; the actual git
 * dir is named in store/git_target (relative to that store directory).
 */
async function gitDir(): Promise<string> {
  const root = (await $`jj root`.text()).trim()
  const repoLink = `${root}/.jj/repo`
  const stat = await Deno.stat(repoLink)
  const repoDir = stat.isDirectory
    ? repoLink
    : await Deno.realPath(`${root}/.jj/${(await Deno.readTextFile(repoLink)).trim()}`)
  const target = (await Deno.readTextFile(`${repoDir}/store/git_target`)).trim()
  return target.startsWith("/") ? target : await Deno.realPath(`${repoDir}/store/${target}`)
}

async function pickPr(repo: string): Promise<string | null> {
  const tmpl = `{{range .}}{{tablerow .number .title .author.name (timeago .updatedAt)}}{{end}}`
  const list = $`gh pr list -R ${repo} --limit 100 --json number,title,updatedAt,author --template ${tmpl}`
  const choice = await list.pipe($`fzf --height 25% --reverse --accept-nth=1`).noThrow(130).text()
  return choice.trim() || null
}

interface PrMeta {
  headRefName: string
  isCrossRepository: boolean
}

const repo = await getRepoSlug()
const pr = await pickPr(repo)
if (!pr) Deno.exit(0)

const meta = await $`gh pr view -R ${repo} ${pr} --json headRefName,isCrossRepository`
  .json<PrMeta>()
const { headRefName: branch, isCrossRepository: cross } = meta
console.log(`Checking out PR #${pr} (${branch})`)

if (cross) {
  // Fork PR: branch isn't on origin, but GitHub exposes refs/pull/N/head.
  // Workspaces have no local .git, so target the resolved git dir.
  const dir = await gitDir()
  await $`git --git-dir=${dir} fetch origin +refs/pull/${pr}/head:refs/heads/pr-${pr}`
  await $`jj git import`.quiet()
  await $`jj new pr-${pr}`
} else {
  await $`jj git fetch`
  await $`jj bookmark track ${branch}@origin`.noThrow().quiet()
  await $`jj new ${branch}`
}
await $`jj log -n 2`
