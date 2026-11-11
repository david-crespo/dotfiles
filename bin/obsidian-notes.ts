#!/usr/bin/env -S deno run --allow-env --allow-run=/Applications/Obsidian.app/Contents/MacOS/obsidian-cli --allow-read=/Applications/Obsidian.app

// Scoped access to daily notes and the vault layout in Obsidian, through the
// obsidian CLI. Bot notes are plain files in ~/obsidian/Bot notes and need no
// wrapper (see the bot-note skill).

import { Command } from "@cliffy/command"
import $ from "@david/dax"

const DAILY_NOTES = "Daily notes"

// obsidian-cli is the official CLI entrypoint; the lowercase app binary path
// ("MacOS/obsidian") case-insensitively resolves to the main Electron binary,
// which boots a full app instance (UI and all) when Obsidian isn't already
// running and takes the window down with it when this process exits.
// https://obsidian.md/help/cli
const OBSIDIAN = "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli"

async function obs(...args: string[]): Promise<string> {
  const cmd = await $`${OBSIDIAN} ${args}`.noThrow().captureCombined()
  const result = cmd.combined.trim()
  // obsidian-cli exits nonzero when the Obsidian app isn't running ("The CLI
  // is unable to find Obsidian..."). Fail fast with that message rather than
  // letting dax throw an opaque ShellError stack trace.
  if (cmd.code !== 0) {
    console.error(result || `obsidian-cli exited with code ${cmd.code}`)
    Deno.exit(1)
  }
  if (result.startsWith("Error:")) throw new Error(result)
  return result
}

async function vaultPath(): Promise<string> {
  return await obs("vault", "info=path")
}

/** Append to a file, creating it if it doesn't exist. Always prepends a
 * blank-line separator: between existing content and the appended block, or
 * at the start of a new file (Obsidian won't render a callout that starts
 * on line 1 unless the cursor is outside it). */
async function appendOrCreate(path: string, content: string): Promise<void> {
  await obs("read", `path=${path}`)
    .then(() => obs("append", `path=${path}`, `content=\n\n${content}`))
    .catch(() => obs("create", `path=${path}`, `content=\n\n${content}`))
}

async function readStdin(): Promise<string> {
  return (await new Response(Deno.stdin.readable).text()).trim()
}

const dailyRead = new Command()
  .description("Read a daily note (default: today)")
  .arguments("[date:string]")
  .action(async (_opts, date?: string) => {
    const text = date
      ? await obs("read", `path=${DAILY_NOTES}/${date}.md`)
      : await obs("daily:read")
    console.log(text)
  })

const dailyRecent = new Command()
  .description("Read the N most recent daily notes")
  .arguments("[count:number]")
  .action(async (_opts, count = 5) => {
    const listing = await obs("files", `folder=${DAILY_NOTES}`)
    const files = listing.split("\n").filter(Boolean).slice(-count)
    for (const file of files) {
      const date = file.replace(`${DAILY_NOTES}/`, "").replace(".md", "")
      console.log(`\n--- ${date} ---\n`)
      console.log(await obs("read", `path=${file}`))
    }
  })

const dailyAppend = new Command()
  .description(
    "Append content to a daily note (default: today). Reads from stdin, prints the note's path.",
  )
  .option("--date <date:string>", "Date of the note (YYYY-MM-DD, default: today)")
  .action(async ({ date }) => {
    const content = await readStdin()
    const path = date ? `${DAILY_NOTES}/${date}.md` : await obs("daily:path")
    await appendOrCreate(path, content)
    console.log(`${await vaultPath()}/${path}`)
  })

const dailyPath = new Command()
  .description("Print the absolute filesystem path to a daily note (default: today)")
  .arguments("[date:string]")
  .action(async (_opts, date?: string) => {
    const vault = await vaultPath()
    const rel = date ? `${DAILY_NOTES}/${date}.md` : await obs("daily:path")
    console.log(`${vault}/${rel}`)
  })

const dailyList = new Command()
  .description("List daily notes")
  .action(async () => {
    console.log(await obs("files", `folder=${DAILY_NOTES}`))
  })

// Runs inside Obsidian through the CLI's eval. It reads only the metadata
// cache and vault config: frontmatter keys, never values or note bodies.
// Folders in NO_KEYS get counts only (hiring material, which agents under the
// personal account stay out of).
const NO_KEYS = ["Oxide/Hiring"]
const LAYOUT_JS = `(() => {
  const noKeys = ${JSON.stringify(NO_KEYS)}
  const types = app.metadataTypeManager.getAllProperties()
  const bookmarks = app.internalPlugins.getPluginById("bookmarks").instance.items
  const bookmarked = new Set(bookmarks.map((item) => item.path))
  const folders = {}
  for (const file of app.vault.getFiles()) {
    // An attachments/ folder is counted on its parent's line.
    const inAttachments = file.parent.name === "attachments"
    const dir = (inAttachments ? file.parent.parent : file.parent).path
    const folder = (folders[dir] ??= { notes: 0, attachments: 0, files: 0, bases: [], keys: {} })
    if (file.extension === "md") {
      folder.notes++
      if (noKeys.includes(dir)) continue
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      for (const key of Object.keys(frontmatter)) {
        const type = types[key.toLowerCase()]?.widget ?? "text"
        const label = key + ":" + type
        folder.keys[label] = (folder.keys[label] ?? 0) + 1
      }
    } else if (file.extension === "base") {
      folder.bases.push(file.name + (bookmarked.has(file.path) ? "" : " (no bookmark)"))
    } else if (inAttachments) folder.attachments++
    else folder.files++
  }
  return JSON.stringify({ excluded: app.vault.getConfig("userIgnoreFilters"), folders })
})()`

type Layout = {
  excluded: string[]
  folders: Record<
    string,
    {
      notes: number
      attachments: number
      files: number
      bases: string[]
      keys: Record<string, number>
    }
  >
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

const vaultLayout = new Command()
  .description(
    "Print the vault's folders: note counts, bases, and frontmatter keys with types and counts",
  )
  .action(async () => {
    const result = await obs("eval", `code=${LAYOUT_JS}`)
    const layout: Layout = JSON.parse(result.replace(/^=> /, ""))
    console.log(`Excluded files: ${layout.excluded.join(", ")}\n`)
    for (
      const [dir, f] of Object.entries(layout.folders).sort(([a], [b]) =>
        a.localeCompare(b)
      )
    ) {
      const name = dir === "/" ? "(vault root)" : `${dir}/`
      const parts = [
        f.notes && count(f.notes, "note"),
        f.attachments && count(f.attachments, "attachment"),
        f.files && count(f.files, "other file"),
        ...f.bases,
      ].filter(Boolean)
      console.log(`${name}  ${parts.join(", ")}`)
      const keys = Object.entries(f.keys).sort(([, a], [, b]) => b - a)
      if (keys.length) console.log(`  ${keys.map(([k, n]) => `${k} ${n}`).join(", ")}`)
      else if (f.notes && NO_KEYS.includes(dir)) console.log("  (keys not listed)")
    }
  })

await new Command()
  .name("obsidian-notes")
  .description("Scoped access to Obsidian daily notes and the vault layout")
  .action(function () {
    this.showHelp()
  })
  .command("daily:read", dailyRead)
  .command("daily:recent", dailyRecent)
  .command("daily:append", dailyAppend)
  .command("daily:path", dailyPath)
  .command("daily:list", dailyList)
  .command("vault:layout", vaultLayout)
  .parse(Deno.args)
