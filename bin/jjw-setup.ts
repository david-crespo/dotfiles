#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=jj

import $ from "@david/dax"
import { join } from "@std/path"

const repoRoot = (await $`jj root`.text()).trim()
const repoName = repoRoot.split("/").at(-1)!

const baseDir = join(Deno.env.get("HOME")!, "oxide", "jj-workspaces")
await Deno.mkdir(baseDir, { recursive: true })

let i = 1
while (await Deno.stat(join(baseDir, `${repoName}-${i}`)).catch(() => null)) {
  i++
}
const wspath = join(baseDir, `${repoName}-${i}`)

// capture jj output and echo to stderr so only the path goes to stdout
const jjOut = await $`jj workspace add ${wspath}`.text()
if (jjOut.trim()) console.error(jjOut)

// symlink claude local settings if present (not versioned)
const localSettings = join(repoRoot, ".claude", "settings.local.json")
if (await Deno.stat(localSettings).catch(() => null)) {
  const destDir = join(wspath, ".claude")
  await Deno.mkdir(destDir, { recursive: true })
  await Deno.symlink(localSettings, join(destDir, "settings.local.json"))
}

// only output: the path for the shell wrapper to cd into
console.log(wspath)
