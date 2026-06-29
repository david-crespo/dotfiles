import type { Item, Watcher } from "../types.ts"

const CHANGELOG_URL =
  "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md"

/**
 * Parse CHANGELOG.md into one item per version. The file is a flat list of
 * `## <version>` headings, each followed by `-` bullets until the next heading.
 */
export function parseChangelog(md: string): Item[] {
  const items: Item[] = []
  let version: string | null = null
  let body: string[] = []

  const flush = () => {
    if (version) {
      items.push({
        id: version,
        title: `Claude Code ${version}`,
        body: body.join("\n").trim(),
        url: CHANGELOG_URL,
      })
    }
    version = null
    body = []
  }

  for (const line of md.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      flush()
      version = heading[1]
    } else if (version) {
      body.push(line)
    }
  }
  flush()
  return items
}

export const ccChangelog: Watcher = {
  name: "cc-changelog",
  async fetch(): Promise<Item[]> {
    const res = await fetch(CHANGELOG_URL)
    if (!res.ok) {
      throw new Error(`fetch ${CHANGELOG_URL}: ${res.status} ${res.statusText}`)
    }
    return parseChangelog(await res.text())
  },
}
