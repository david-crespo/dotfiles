#!/usr/bin/env -S deno run --allow-env --allow-run=obsidian --allow-read=/Applications/Obsidian.app

// Scoped access to daily notes and bot notes in Obsidian.
// Wraps the obsidian CLI so it can be allowlisted as a single command.

import { Command } from "@cliffy/command"
import $ from "@david/dax"

const BOT_NOTES = "Base files/Bot notes"
const DAILY_NOTES = "Daily notes"

const OBSIDIAN = "/Applications/Obsidian.app/Contents/MacOS/obsidian"

async function obs(...args: string[]): Promise<string> {
  return (await $`${OBSIDIAN} ${args}`.stderr("null").text()).trim()
}

async function vaultPath(): Promise<string> {
  return obs("vault", "info=path")
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
  .description("Append content to a daily note (default: today). Reads from stdin.")
  .option("--date <date:string>", "Date of the note (YYYY-MM-DD, default: today)")
  .action(async ({ date }) => {
    const content = (await new Response(Deno.stdin.readable).text()).trim()
    if (date) {
      await obs("append", `path=${DAILY_NOTES}/${date}.md`, `content=${content}`)
    } else {
      await obs("daily:append", `content=${content}`)
    }
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

const botRead = new Command()
  .description("Read a bot note by name (without .md)")
  .arguments("<name:string>")
  .action(async (_opts, name: string) => {
    console.log(await obs("read", `path=${BOT_NOTES}/${name}.md`))
  })

const botPath = new Command()
  .description("Print the absolute filesystem path to a bot note")
  .arguments("<name:string>")
  .action(async (_opts, name: string) => {
    const vault = await vaultPath()
    console.log(`${vault}/${BOT_NOTES}/${name}.md`)
  })

const botList = new Command()
  .description("List bot notes")
  .action(async () => {
    console.log(await obs("files", `folder=${BOT_NOTES}`))
  })

const botCreate = new Command()
  .description("Create a bot note. Reads content from stdin.")
  .arguments("<name:string>")
  .action(async (_opts, name: string) => {
    const content = (await new Response(Deno.stdin.readable).text()).trim()
    await obs("create", `path=${BOT_NOTES}/${name}.md`, `content=${content}`)
  })

const botAppend = new Command()
  .description("Append content to a bot note. Reads content from stdin.")
  .arguments("<name:string>")
  .action(async (_opts, name: string) => {
    const content = (await new Response(Deno.stdin.readable).text()).trim()
    await obs("append", `path=${BOT_NOTES}/${name}.md`, `content=${content}`)
  })

await new Command()
  .name("obsidian-notes")
  .description("Scoped access to Obsidian daily notes and bot notes")
  .action(function () {
    this.showHelp()
  })
  .command("daily:read", dailyRead)
  .command("daily:recent", dailyRecent)
  .command("daily:append", dailyAppend)
  .command("daily:path", dailyPath)
  .command("daily:list", dailyList)
  .command("bot:read", botRead)
  .command("bot:path", botPath)
  .command("bot:list", botList)
  .command("bot:create", botCreate)
  .command("bot:append", botAppend)
  .parse(Deno.args)
