// Runners: one call per (row, task). Both return the same Prediction shape so
// the report code is runner-agnostic.

import $ from "@david/dax"
import { answerConfidence, ask, DEFAULT_MODEL, type Question } from "../typesafe.ts"
import { renderSystemPrompt, type Task } from "./tasks.ts"

export interface Prediction {
  /** Option name (for noul: "true" / "false"). Empty string on error. */
  prediction: string
  probabilities?: Record<string, number>
  /** 0-1. Typesafe reports it for choice; for noul we use max(p, 1-p).
   * `ai` has no calibrated confidence, so it is undefined there. */
  confidence?: number
  tokens?: { input: number; output: number; cached?: number }
  /** Dollars. null only on error. */
  cost: number | null
  /** Provider-reported round trip: the SDK call for Typesafe, `ai`'s own
   * timing for the LLM. */
  timeMs: number
  /** Wall clock as seen by the caller, including process startup for `ai`.
   * This is the latency a hook or CLI pipeline would actually wait. */
  wallMs: number
  model: string
  error?: string
  raw?: unknown
}

export interface Runner {
  name: string
  run(task: Task, state: unknown): Promise<Prediction>
}

// --- Typesafe ---------------------------------------------------------------

export function typesafeRunner(model = DEFAULT_MODEL): Runner {
  return {
    // Plain "typesafe" for the default model keeps existing cache entries valid.
    name: model === DEFAULT_MODEL ? "typesafe" : `typesafe:${model}`,
    async run(task, state) {
      const start = performance.now()
      try {
        const question = {
          type: task.kind,
          instructions: task.instructions,
          criteria: task.criteria,
        } as Question
        const result = await ask(state, { answer: question }, model)
        const answer = result.answers.answer
        const tokens = {
          input: result.usage.input_tokens,
          output: result.usage.output_tokens,
        }
        const base = {
          tokens,
          cost: result.cost,
          timeMs: result.timeMs,
          wallMs: performance.now() - start,
          model: result.model,
          raw: answer,
        }
        if (answer.type === "noul") {
          const p = answer.noul
          return {
            ...base,
            prediction: p >= 0.5 ? "true" : "false",
            probabilities: { true: p, false: 1 - p },
            confidence: answerConfidence(answer),
          }
        }
        if (answer.type === "choice") {
          return {
            ...base,
            prediction: answer.choice,
            probabilities: answer.probabilities,
            confidence: answer.confidence,
          }
        }
        return {
          ...base,
          prediction: String(answer.score),
          probabilities: answer.probabilities,
          confidence: answer.confidence,
        }
      } catch (e) {
        const elapsed = performance.now() - start
        return {
          prediction: "",
          cost: null,
          timeMs: elapsed,
          wallMs: elapsed,
          model,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    },
  }
}

// --- ai CLI -----------------------------------------------------------------

/** Shape of `ai --json` output (llm-cli AssistantMessage). */
interface AiMessage {
  model: string
  content: string
  tokens: { input: number; output: number; input_cache_hit?: number }
  cost: number
  timeMs: number
}

/** Turn `ai -o` content into an option name. Primitive schemas come back as
 * the bare value ("drop", "true"); anything else we try to parse as JSON. */
function parseAiContent(content: string): string {
  const trimmed = content.trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === "string" || typeof parsed === "boolean") return String(parsed)
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return String((parsed as { value: unknown }).value)
    }
    return trimmed
  } catch {
    return trimmed.replace(/^['"]|['"]$/g, "")
  }
}

/** Reasoning effort, mapped onto `ai`'s thinking flags. */
export const EFFORTS = {
  quick: ["-q"],
  default: ["--think-default"],
  think: ["--think"],
  "think-hard": ["--think-hard"],
} as const
export type Effort = keyof typeof EFFORTS

/**
 * `ai -m <model> <effort flag> --json --ephemeral --system <prompt> -o <schema>`
 * with the state JSON on stdin. `quick` (`-q`) minimizes reasoning and is the
 * baseline; `--json` (llm-cli rev zx) prints the whole assistant message
 * including cost and timing. The `ai` wrapper sources its API keys from a .env
 * the sandbox cannot read, so runs that use this runner need the sandbox off.
 */
export function aiRunner(model: string, effort: Effort = "quick"): Runner {
  return {
    // "ai:luna" for quick keeps existing cache entries valid.
    name: effort === "quick" ? `ai:${model}` : `ai:${model}:${effort}`,
    async run(task, state) {
      const system = renderSystemPrompt(task)
      const args = [
        "-m",
        model,
        ...EFFORTS[effort],
        "--json",
        "--ephemeral",
        "--system",
        system,
        "-o",
        task.aiSchema,
      ]
      const start = performance.now()
      const result = await $`ai ${args}`
        .stdinText(JSON.stringify(state))
        .stdout("piped")
        .stderr("piped")
        .noThrow()
      const wallMs = performance.now() - start
      if (result.code !== 0) {
        return {
          prediction: "",
          cost: null,
          timeMs: wallMs,
          wallMs,
          model,
          error: `ai exited ${result.code}: ${
            (result.stderr || result.stdout).trim().slice(0, 500)
          }`,
        }
      }
      let msg: AiMessage
      try {
        msg = JSON.parse(result.stdout.trim().split("\n").at(-1)!)
      } catch {
        return {
          prediction: "",
          cost: null,
          timeMs: wallMs,
          wallMs,
          model,
          error: `unparseable ai --json output: ${result.stdout.slice(0, 300)}`,
        }
      }
      return {
        prediction: parseAiContent(msg.content),
        tokens: {
          input: msg.tokens.input,
          output: msg.tokens.output,
          cached: msg.tokens.input_cache_hit,
        },
        cost: msg.cost,
        // ai's own timeMs is the provider round trip; wallMs includes Deno startup.
        timeMs: msg.timeMs,
        wallMs,
        model: msg.model,
      }
    },
  }
}

/** Parse `--runner` values: `typesafe[:<model>]` or `ai:<model>[:<effort>]`
 * where effort is one of quick (default), default, think, think-hard. */
export function makeRunner(spec: string): Runner {
  const [kind, model, effort, ...extra] = spec.split(":")
  if (kind === "typesafe" && !effort) return typesafeRunner(model || undefined)
  if (kind === "ai" && model && extra.length === 0) {
    if (effort && !(effort in EFFORTS)) {
      throw new Error(
        `unknown effort '${effort}' (expected ${Object.keys(EFFORTS).join(", ")})`,
      )
    }
    return aiRunner(model, (effort as Effort | undefined) ?? "quick")
  }
  throw new Error(
    `unknown runner '${spec}' (expected typesafe[:model] or ai:<model>[:<effort>])`,
  )
}
