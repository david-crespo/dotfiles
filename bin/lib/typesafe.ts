// Thin wrapper over the Typesafe SDK shared by `tsq` (ad hoc CLI) and `tseval`
// (benchmark harness). Both import this rather than one shelling out to the
// other, so the eval's latency numbers measure the API call, not Deno startup.
//
// Auth: TYPESAFE_API_KEY, or the contents of ~/.config/typesafe/api-key
// (XDG_CONFIG_HOME respected) when the env var is unset. Cost: the published
// rate (https://docs.typesafe.ai/models) is $0.042 per million input tokens
// with output free; TYPESAFE_INPUT_PER_M / TYPESAFE_OUTPUT_PER_M override it.

import { TypeSafeClient } from "@typesafe-ai/sdk"

export type QuestionKind = "choice" | "noul" | "score"

export interface ChoiceQuestion {
  type: "choice"
  instructions: string
  /** option name -> description */
  criteria: Record<string, string>
}
export interface NoulQuestion {
  type: "noul"
  instructions: string
  criteria?: { true: string; false: string }
}
export interface ScoreQuestion {
  type: "score"
  instructions: string
  /** ordered level descriptions, lowest first, at least two */
  criteria: string[]
}
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion

export interface ChoiceAnswer {
  type: "choice"
  choice: string
  confidence: number
  probabilities: Record<string, number>
}
export interface NoulAnswer {
  type: "noul"
  /** probability the answer is yes */
  noul: number
}
export interface ScoreAnswer {
  type: "score"
  /** probability-weighted expected value */
  score: number
  confidence: number
  legend: Record<string, string>
  probabilities: Record<string, number>
}
export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer

export interface Usage {
  input_tokens: number
  output_tokens: number
}

export interface AskResult<K extends string = string> {
  model: string
  answers: Record<K, Answer>
  usage: Usage
  timeMs: number
  /** dollars at the published or overridden rate */
  cost: number
}

export const DEFAULT_MODEL = "jev-latest"

/** Dollars per million tokens, from https://docs.typesafe.ai/models (2026-09). */
export const PUBLISHED_RATES = { input: 0.042, output: 0 }

/** Env override, else the published rate. */
export function typesafeRates(): { input: number; output: number } {
  const input = Number(Deno.env.get("TYPESAFE_INPUT_PER_M"))
  const output = Number(Deno.env.get("TYPESAFE_OUTPUT_PER_M"))
  if (Number.isFinite(input) && Number.isFinite(output) && (input || output)) {
    return { input, output }
  }
  return PUBLISHED_RATES
}

export function costOf(usage: Usage): number {
  const rates = typesafeRates()
  return (usage.input_tokens * rates.input + usage.output_tokens * rates.output) / 1e6
}

const KEY_FILE = `${
  Deno.env.get("XDG_CONFIG_HOME") ?? `${Deno.env.get("HOME")}/.config`
}/typesafe/api-key`

async function apiKey(): Promise<string> {
  const fromEnv = Deno.env.get("TYPESAFE_API_KEY")
  if (fromEnv) return fromEnv
  const fromFile = await Deno.readTextFile(KEY_FILE).then((s) => s.trim()).catch(() => "")
  if (fromFile) return fromFile
  throw new Error(`no Typesafe API key: set TYPESAFE_API_KEY or put the key in ${KEY_FILE}`)
}

let client: TypeSafeClient | undefined

/** One System One request: any state, any number of questions. */
export async function ask<K extends string>(
  state: unknown,
  questions: Record<K, Question>,
  model = DEFAULT_MODEL,
): Promise<AskResult<K>> {
  client ??= new TypeSafeClient({ apiKey: await apiKey() })
  const start = performance.now()
  // The SDK's generics infer answer types from `const` question literals; we
  // build questions dynamically, so go through `any` and type the result here.
  // deno-lint-ignore no-explicit-any
  const result: any = await client.systemOne({ state, questions, model } as any)
  const timeMs = performance.now() - start
  const usage: Usage = {
    input_tokens: result.usage?.input_tokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? 0,
  }
  return {
    model: result.model,
    answers: result.answers,
    usage,
    timeMs,
    cost: costOf(usage),
  }
}

/** Bare value of an answer: option name, yes-probability, or expected score. */
export function answerValue(answer: Answer): string | number {
  switch (answer.type) {
    case "choice":
      return answer.choice
    case "noul":
      return answer.noul
    case "score":
      return answer.score
  }
}

/** Confidence in [0, 1]. Noul has none natively; use distance from 0.5. */
export function answerConfidence(answer: Answer): number {
  return answer.type === "noul" ? Math.max(answer.noul, 1 - answer.noul) : answer.confidence
}
