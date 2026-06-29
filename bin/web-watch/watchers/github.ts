import $ from "@david/dax"
import type { Item, Watcher } from "../types.ts"

interface GhPr {
  number: number
  title: string
  body: string
  url: string
  labels: { name: string }[]
}

/**
 * Recently merged PRs in a repo, one item per PR. Merged PRs are a cleaner unit
 * than raw commits (one entry per change, with a title and body to judge).
 * Labels are carried into the body so the relevance gate can use them as a
 * cheap pre-filter; this stage does no filtering itself.
 */
export async function fetchMergedPrs(repo: string, limit = 30): Promise<Item[]> {
  const prs =
    await $`gh pr list -R ${repo} --state merged --limit ${limit} --json number,title,body,url,labels`
      .json<GhPr[]>()
  return prs.map((pr) => {
    const labels = pr.labels.map((l) => l.name)
    const labelLine = labels.length ? `Labels: ${labels.join(", ")}\n\n` : ""
    return {
      id: String(pr.number),
      title: `#${pr.number} ${pr.title}`,
      body: labelLine + (pr.body ?? "").trim(),
      url: pr.url,
    }
  })
}

export const helix: Watcher = {
  name: "helix",
  fetch: () => fetchMergedPrs("helix-editor/helix"),
}

export const ghostty: Watcher = {
  name: "ghostty",
  fetch: () => fetchMergedPrs("ghostty-org/ghostty"),
}
