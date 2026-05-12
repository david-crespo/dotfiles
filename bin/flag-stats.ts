#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=atuin

import { Command } from "@cliffy/command"
import { Table } from "@cliffy/table"
import { parseArgs } from "@std/cli/parse-args"
import $ from "@david/dax"

await new Command()
  .name("flag-stats")
  .description("Show flag-usage stats for a command from atuin history.")
  .arguments("<command:string>")
  .action(async (_opts, cmd) => {
    const lines = await $`atuin search --filter-mode global --search-mode prefix --limit 100000 --format ${"{time}|{command}"} ${cmd}`
      .stderr("null")
      .lines()

    const flags = new Map<string, { count: number; last: string }>()
    let total = 0

    for (const row of lines) {
      const sep = row.indexOf("|")
      if (sep < 0) continue
      const ts = row.slice(0, sep)
      // only consider tokens before the first pipe in the command
      const cmdPart = row.slice(sep + 1).split("|")[0].trim()
      const tokens = cmdPart.split(/\s+/)
      if (tokens[0] !== cmd) continue
      total++

      const parsed = parseArgs(tokens.slice(1))
      for (const key of Object.keys(parsed)) {
        if (key === "_") continue
        const flagName = key.length === 1 ? `-${key}` : `--${key}`
        const s = flags.get(flagName) ?? { count: 0, last: "" }
        s.count++
        if (ts > s.last) s.last = ts
        flags.set(flagName, s)
      }
    }

    const now = Date.now()
    const rows = [...flags]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([flag, { count, last }]) => {
        const date = last.slice(0, 10)
        const daysAgo = Math.floor((now - new Date(date).getTime()) / 86_400_000)
        return [flag, String(count), date, String(daysAgo)]
      })

    console.log(`${cmd}: ${total} invocations\n`)
    console.log(
      new Table()
        .header(["Flag", "Count", "Last used", "Days ago"])
        .body(rows)
        .border()
        .padding(1)
        .toString(),
    )
  })
  .parse(Deno.args)
