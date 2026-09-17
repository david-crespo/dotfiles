#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net=api.typesafe.ai

// tsq: ask Typesafe (jev) a structured question about whatever is on stdin.
// Fast, cheap snap judgments that return a distribution instead of prose.
//
//   echo "My card was charged twice" | tsq choice "Which team handles this?" \
//       returns="Exchanges, refunds, wrong items" billing="Charges, invoices, payments"
//   echo "..." | tsq noul "Is the customer angry?" [true="..." false="..."]
//   echo "..." | tsq score "How urgent?" "can wait" "this week" "today" "right now"
//   tsq run questions.json < state.json      # many questions, raw API shape
//
// State is stdin. It is parsed as JSON when it looks like JSON (object or
// array), otherwise sent as a string; --text forces the string. Output is the
// answer plus usage, timing, and cost as JSON; --value prints only the bare
// answer (option name, yes-probability, or expected score) for shell use.
//
// Needs TYPESAFE_API_KEY or ~/.config/typesafe/api-key. Cost uses the published
// rate; TYPESAFE_INPUT_PER_M / TYPESAFE_OUTPUT_PER_M override it.

import { Command, ValidationError } from "@cliffy/command"
import { readAll } from "@std/io"
import { answerValue, ask, DEFAULT_MODEL, type Question } from "./lib/typesafe.ts"

async function readState(forceText: boolean): Promise<unknown> {
  if (Deno.stdin.isTerminal()) {
    throw new ValidationError("state is read from stdin; pipe or redirect something in")
  }
  const raw = new TextDecoder().decode(await readAll(Deno.stdin)).trim()
  if (!raw) throw new ValidationError("empty state on stdin")
  if (forceText || !/^[[{]/.test(raw)) return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** `name=description` pairs from positional args. */
function parseCriteria(pairs: string[], what: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf("=")
    if (eq <= 0) {
      throw new ValidationError(`${what} must look like name=description, got '${pair}'`)
    }
    out[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return out
}

interface OutputOpts {
  value?: boolean
  model: string
  text?: boolean
}

async function askOne(question: Question, opts: OutputOpts) {
  const state = await readState(opts.text ?? false)
  const result = await ask(state, { answer: question }, opts.model)
  const answer = result.answers.answer
  if (opts.value) {
    console.log(String(answerValue(answer)))
    return
  }
  const { type: _type, ...rest } = answer
  emit({
    ...rest,
    model: result.model,
    usage: result.usage,
    timeMs: Math.round(result.timeMs),
    cost: result.cost,
  })
}

function emit(value: unknown) {
  console.log(
    Deno.stdout.isTerminal() ? JSON.stringify(value, null, 2) : JSON.stringify(value),
  )
}

await new Command()
  .name("tsq")
  .description("Ask Typesafe a structured question about stdin")
  .globalOption("-m, --model <model:string>", "Typesafe model", { default: DEFAULT_MODEL })
  .globalOption("--text", "Send stdin as a plain string even if it looks like JSON")
  .command("choice", "Pick one option. Options are name=description pairs.")
  .arguments("<instructions:string> <option...:string>")
  .option("-v, --value", "Print only the chosen option name")
  .action(async (opts, instructions, ...options) => {
    const criteria = parseCriteria(options, "option")
    if (Object.keys(criteria).length < 2) {
      throw new ValidationError("choice needs at least two options")
    }
    await askOne({ type: "choice", instructions, criteria }, opts)
  })
  .command("noul", "Yes/no probability. Optional true=... false=... descriptions.")
  .arguments("<instructions:string> [criteria...:string]")
  .option("-v, --value", "Print only the yes-probability")
  .action(async (opts, instructions, ...pairs) => {
    const criteria = parseCriteria(pairs, "criteria")
    const keys = Object.keys(criteria).sort().join(",")
    if (keys && keys !== "false,true") {
      throw new ValidationError("noul criteria must be exactly true=... and false=...")
    }
    await askOne(
      {
        type: "noul",
        instructions,
        criteria: keys ? { true: criteria.true, false: criteria.false } : undefined,
      },
      opts,
    )
  })
  .command("score", "Rate against ordered levels, lowest first (at least two).")
  .arguments("<instructions:string> <level...:string>")
  .option("-v, --value", "Print only the expected score")
  .action(async (opts, instructions, ...levels) => {
    if (levels.length < 2) throw new ValidationError("score needs at least two levels")
    await askOne({ type: "score", instructions, criteria: levels }, opts)
  })
  .command(
    "run",
    "Ask several questions in one call. FILE is a JSON map of name -> question in API shape.",
  )
  .arguments("<file:string>")
  .action(async (opts, file) => {
    const questions = JSON.parse(await Deno.readTextFile(file)) as Record<string, Question>
    const state = await readState(opts.text ?? false)
    const result = await ask(state, questions, opts.model)
    emit({ ...result, timeMs: Math.round(result.timeMs) })
  })
  .parse(Deno.args)
