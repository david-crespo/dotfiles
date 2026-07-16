#!/usr/bin/env -S deno run --allow-net=raw.githubusercontent.com --allow-run=npm,gh --allow-env --allow-read --allow-write

// Fetch + diff against state. For each watcher: fetch current items, compare
// against the set of IDs seen on previous runs, and report what's new.
// First run seeds a baseline so existing items don't all count as new.
// Relevance gating comes in a later stage.

import $ from "@david/dax"
import { ccChangelog } from "./web-watch/watchers/cc-changelog.ts"
import { ccNpm } from "./web-watch/watchers/cc-npm.ts"
import { ghostty, helix } from "./web-watch/watchers/github.ts"
import { loadSeen, saveSeen } from "./web-watch/state.ts"
import type { Watcher } from "./web-watch/types.ts"

$.setErrorTail(true)

const watchers: Watcher[] = [ccChangelog, ccNpm, helix, ghostty]

/** Fetch a watcher, diff against state, persist, and return a report block. */
async function check(watcher: Watcher): Promise<string> {
  const items = await watcher.fetch()
  const seen = await loadSeen(watcher.name)

  if (seen === null) {
    // First run: seed a baseline so we don't surface everything that already
    // exists. Subsequent runs diff against this.
    await saveSeen(watcher.name, items.map((i) => i.id))
    return `${watcher.name}: seeded ${items.length} items (baseline)`
  }

  const fresh = items.filter((i) => !seen.has(i.id))
  if (fresh.length > 0) {
    // Grow seen to cover everything currently present.
    await saveSeen(watcher.name, new Set([...seen, ...items.map((i) => i.id)]))
  }
  const lines = [`${watcher.name}: ${fresh.length} new (of ${items.length})`]
  for (const item of fresh) lines.push(`  • ${item.title}`)
  return lines.join("\n")
}

// Run all watchers concurrently; one failing doesn't sink the rest. Print in
// watcher order so output stays stable regardless of completion timing.
const results = await Promise.allSettled(watchers.map(check))
for (const [i, result] of results.entries()) {
  if (result.status === "fulfilled") console.log(result.value)
  else console.log(`${watchers[i].name}: error — ${result.reason}`)
}
