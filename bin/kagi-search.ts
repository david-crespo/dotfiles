#!/usr/bin/env -S deno run --allow-env=KAGI_API_KEY --allow-net=kagi.com

// Kagi Search API (v1) CLI. Reads KAGI_API_KEY from the env.
//
//   kagi-search <query...>          web search; prints title / url / snippet
//   kagi-search extract <url...>    fetch up to 10 pages as markdown
//
// Use --json on either for the raw API response.

import { Command } from "@cliffy/command"

const API = "https://kagi.com/api/v1"

interface Envelope<T> {
  meta?: { trace?: string; ms?: number; node?: string }
  data?: T
  error?: Array<{ code: number; msg: string }>
}

function apiKey(): string {
  const key = Deno.env.get("KAGI_API_KEY")
  if (!key) {
    console.error("KAGI_API_KEY is not set")
    Deno.exit(1)
  }
  return key
}

async function post<T>(path: string, body: unknown): Promise<Envelope<T>> {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const env: Envelope<T> = await response.json()
  if (!response.ok || env.error?.length) {
    const msg = env.error?.map((e) => e.msg).join("; ") ?? response.statusText
    console.error(`Kagi API failed (${response.status}): ${msg}`)
    Deno.exit(1)
  }
  return env
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

interface SearchItem {
  title?: string
  url?: string
  snippet?: string
}

async function runSearch(query: string[], limit: number, json: boolean) {
  const env = await post<{ search?: SearchItem[] }>("/search", {
    query: query.join(" "),
  })
  if (json) {
    console.log(JSON.stringify(env, null, 2))
    return
  }
  const results = (env.data?.search ?? [])
    .filter((r) => r.url && r.title)
    .slice(0, limit)
  if (results.length === 0) {
    console.error("No results")
    Deno.exit(1)
  }
  for (const r of results) {
    console.log(stripHtml(r.title!))
    console.log(`  ${r.url}`)
    if (r.snippet) console.log(`  ${stripHtml(r.snippet)}`)
    console.log()
  }
}

interface ExtractPage {
  url: string
  markdown?: string
  error?: string
}

async function runExtract(urls: string[], json: boolean) {
  if (urls.length > 10) {
    console.error("The extract endpoint accepts at most 10 URLs")
    Deno.exit(1)
  }
  const env = await post<ExtractPage[]>("/extract", {
    pages: urls.map((url) => ({ url })),
  })
  if (json) {
    console.log(JSON.stringify(env, null, 2))
    return
  }
  let hadError = false
  ;(env.data ?? []).forEach((page, i) => {
    if (i > 0) console.log("\n---\n")
    console.log(`# ${page.url}\n`)
    if (page.error) {
      hadError = true
      console.error(`(error: ${page.error})`)
    } else {
      console.log(page.markdown ?? "(no content)")
    }
  })
  if (hadError) Deno.exit(1)
}

const search = new Command()
  .description("Web search; prints title / url / snippet per result")
  .arguments("<query...:string>")
  .option("-n, --limit <n:number>", "Max results to show", { default: 10 })
  .option("--json", "Print raw JSON response")
  .action((options, ...query) => runSearch(query, options.limit, !!options.json))

const extract = new Command()
  .description("Fetch up to 10 pages and print their content as markdown")
  .arguments("<url...:string>")
  .option("--json", "Print raw JSON response")
  .action((options, ...urls) => runExtract(urls, !!options.json))

await new Command()
  .name("kagi-search")
  .description("Web search and page extraction via the Kagi API")
  .arguments("<query...:string>")
  .option("-n, --limit <n:number>", "Max results to show", { default: 10 })
  .option("--json", "Print raw JSON response")
  // Bare invocation (no subcommand) runs a search.
  .action((options, ...query) => runSearch(query, options.limit, !!options.json))
  .command("search", search)
  .command("extract", extract)
  .parse(Deno.args)
