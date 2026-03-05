#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=codex

// Wrapper for codex exec that extracts structured output and computes cost.
//
// Usage:
//   codex-call.ts "prompt"                          # new session
//   codex-call.ts --resume <thread_id> "prompt"     # continue session
//
// On new sessions, prepends a preamble explaining the setup to Codex.
// On resume, the prompt is sent as-is (Codex already has context).
//
// Outputs a single JSON object to stdout.

import { Command } from "jsr:@cliffy/command@1.0.0-rc.7"
import $ from "jsr:@david/dax@^0.45.0"

const MODEL = "gpt-5.4"
const EFFORT = "xhigh"

// gpt-5.4 pricing per token (as of 2026-03)
const INPUT_RATE = 2.5 / 1_000_000
const CACHED_RATE = 0.25 / 1_000_000
const OUTPUT_RATE = 15.0 / 1_000_000

const PREAMBLE = `\
You are being called by Claude Code to review a code change. You are running \
in a read-only sandbox — you can read files with cat, rg, etc. to verify your \
claims, but you cannot run tests or write files. If you want to test a \
hypothesis (e.g., write a test to check an edge case), describe the test \
clearly and Claude will run it for you. Claude may come back with follow-up \
questions or results from running your suggestions.

Focus on substantive issues: bugs, logic errors, missed edge cases, incorrect \
assumptions. Skip style nits and theoretical concerns.

`

interface Usage {
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
}

interface CodexEvent {
  type: string
  thread_id?: string
  item?: { text: string }
  usage?: Usage
}

function parseEvents(lines: string[]) {
  const events: CodexEvent[] = lines.filter(Boolean).map((l) => JSON.parse(l))

  const threadId = events.find((e) => e.type === "thread.started")?.thread_id
  const response = events
    .filter((e) => e.type === "item.completed")
    .map((e) => e.item!.text)
    .join("\n")

  const usage = events.find((e) => e.type === "turn.completed")?.usage ?? {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
  }

  const cost =
    (usage.input_tokens - usage.cached_input_tokens) * INPUT_RATE +
    usage.cached_input_tokens * CACHED_RATE +
    usage.output_tokens * OUTPUT_RATE

  return {
    thread_id: threadId,
    response,
    input_tokens: usage.input_tokens,
    cached_tokens: usage.cached_input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: Math.round(cost * 100) / 100,
  }
}

await new Command()
  .name("codex-call")
  .description("Call codex exec and return structured JSON with cost.")
  .arguments("<prompt:string>")
  .option("--resume <thread-id:string>", "Resume an existing Codex session")
  .action(async ({ resume }, prompt) => {
    // Prepend preamble on new sessions; resume already has context
    const fullPrompt = resume ? prompt : PREAMBLE + prompt

    const args = resume
      ? ["exec", "resume", resume, "-m", MODEL, "-c", `model_reasoning_effort=${EFFORT}`, "--json", fullPrompt]
      : ["exec", "-m", MODEL, "-c", `model_reasoning_effort=${EFFORT}`, "--json", fullPrompt]

    const lines = await $`codex ${args}`.stderr("null").lines()
    console.log(JSON.stringify(parseEvents(lines), null, 2))
  })
  .parse()
