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
  .description("Append content to today's daily note")
  .arguments("<content:string>")
  .action(async (_opts, content: string) => {
    await obs("daily:append", `content=${content}`)
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

const botList = new Command()
  .description("List bot notes")
  .action(async () => {
    console.log(await obs("files", `folder=${BOT_NOTES}`))
  })

const botCreate = new Command()
  .description("Create a bot note")
  .arguments("<name:string>")
  .option("--content <content:string>", "Note content (reads stdin if omitted)")
  .action(async ({ content }, name: string) => {
    if (!content) {
      const buf = await new Response(Deno.stdin.readable).text()
      content = buf.trim()
    }
    await obs("create", `path=${BOT_NOTES}/${name}.md`, `content=${content}`)
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
  .command("daily:list", dailyList)
  .command("bot:read", botRead)
  .command("bot:list", botList)
  .command("bot:create", botCreate)
  .parse(Deno.args)
