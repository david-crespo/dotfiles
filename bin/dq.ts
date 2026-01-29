#!/usr/bin/env -S deno run

import { readAll } from "@std/io"
import { parseArgs } from "@std/cli/parse-args"
import * as R from "remeda"
import { Table } from "@cliffy/table"

R.map // this foolishness gets deno not to tree-shake remeda

const HELP = `
dq is like jq, except you just write JS. Use the variable 'data' to refer
to input from stdin. By default, the input is run through JSON.parse. Use
-l/--lines to treat the input as lines instead (i.e., split it on newline).
The utility library Remeda (https://remedajs.com/) is in scope as 'R'.

Usage:
  dq '<JS code to eval>'

Examples:
  echo '{ "a": 1 }' | dq data.a
  cat package.json | dq 'Object.keys(data).slice(0, 5)'
  ls | dq -l "data.filter(f => f.startsWith('z')).length"
  ls | dq -l "R.countBy(data, s => s[0])"

Options:
  -l, --lines    Assume input is text in lines and split it.
                 data will be an array of strings.
`.trim()

// deno-lint-ignore no-unused-vars
const table = (rows: (string | number)[][]) => new Table().body(rows).padding(3).toString()

const args = parseArgs(Deno.args, {
  boolean: ["help", "lines"],
  alias: { h: "help", l: "lines" },
})

if (args.help) {
  console.log(HELP)
  Deno.exit()
}

// if no code provided, just pass through the JSON
const code = args._.join(" ").trim() || "data"

// don't blow up when there's no stdin -- allow dq to be used for evaling code
const input = Deno.stdin.isTerminal()
  ? undefined
  : new TextDecoder().decode(await readAll(Deno.stdin))

// deno-lint-ignore no-unused-vars
const data = args.lines
  // fallback value for no input depends on --lines
  ? (input ? input.trim().split("\n") : [])
  : (input ? JSON.parse(input) : undefined)

const result = eval(code)
console.log(result)
