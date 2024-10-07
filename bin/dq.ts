#!/usr/bin/env -S deno run

import { readAll } from "jsr:@std/io@0.224"
import { parseArgs } from "jsr:@std/cli@1.0/parse-args"

const HELP = `
dq is like jq, except you just write JS. Use the variable 'data' to refer to
JSON read from stdin.

Usage:
  dq <JS code to eval>

Examples:
  echo '{ "a": 1 }' | dq data.a
  cat package.json | dq 'Object.keys(data).slice(0, 5)'
`.trim()

const args = parseArgs(Deno.args, { boolean: ["help"], alias: { h: "help" } })

if (args.help) {
  console.log(HELP)
  Deno.exit()
}

// if no code provided, just pass through the JSON
const code = args._.join(" ").trim() || "data"

// isTerminal is true when the thing is run without stdin piped in
if (Deno.stdin.isTerminal()) {
  console.log("Error: Nothing passed to stdin.\n")
  console.log(HELP)
  Deno.exit(1)
}

// deno-lint-ignore no-unused-vars
const data = JSON.parse(new TextDecoder().decode(await readAll(Deno.stdin)))
const result = eval(code)
console.log(result)
