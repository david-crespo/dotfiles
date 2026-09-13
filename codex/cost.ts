import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"

// USD per million tokens, checked 2026-09-10:
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/models/gpt-6-astra
// https://developers.openai.com/api/docs/guides/prompt-caching
type Price = {
  input: number
  cached: number
  output: number
  writes?: boolean
  long?: boolean
  fast?: number
  flex?: boolean
}

const prices: Record<string, Price> = {
  "gpt-6-astra": { input: 10, cached: 1, output: 50, writes: true, long: true, fast: 2, flex: true },
  "gpt-5.6-sol": { input: 4, cached: 0.4, output: 20, writes: true, long: true, fast: 2, flex: true },
  "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12, writes: true, long: true, fast: 2, flex: true },
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2, writes: true, long: true, fast: 2, flex: true },
  "gpt-5.5": { input: 5, cached: 0.5, output: 30, long: true, fast: 2.5, flex: true },
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15, long: true, fast: 2, flex: true },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5, fast: 2, flex: true },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25, flex: true },
  "gpt-5.3-codex": { input: 1.75, cached: 0.175, output: 14, fast: 2 },
  "gpt-5.2": { input: 1.75, cached: 0.175, output: 14, fast: 2, flex: true },
  "gpt-5.1": { input: 1.25, cached: 0.125, output: 10, fast: 2, flex: true },
}

type Usage = {
  input_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens?: number
  output_tokens: number
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function validUsage(value: any): value is Usage {
  return count(value?.input_tokens) && count(value.cached_input_tokens) && count(value.output_tokens) &&
    (value.cache_write_input_tokens === undefined || count(value.cache_write_input_tokens)) &&
    value.cached_input_tokens + (value.cache_write_input_tokens ?? 0) <= value.input_tokens
}

export function requestCost(model: string, tier: string | null, usage: Usage): number | undefined {
  const price = prices[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")]
  if (!price || !validUsage(usage)) return undefined
  const fast = tier === "priority" || tier === "fast"
  const multiplier = fast ? price.fast : tier === "flex" ? (price.flex ? 0.5 : undefined)
    : !tier || tier === "default" || tier === "auto" ? 1 : undefined
  if (multiplier === undefined) return undefined
  const long = usage.input_tokens > 272_000 && price.long
  // The older models' published Fast rates cover short context only.
  if (long && fast && !price.writes) return undefined
  const writes = usage.cache_write_input_tokens ?? 0
  const ordinary = usage.input_tokens - usage.cached_input_tokens - writes
  const input = (ordinary + writes * (price.writes ? 1.25 : 1)) * price.input +
    usage.cached_input_tokens * price.cached
  // output_tokens already includes reasoning tokens.
  return (input * (long ? 2 : 1) + usage.output_tokens * price.output * (long ? 1.5 : 1)) *
    multiplier / 1_000_000
}

type TurnContext = { model: string; tier: string | null }

// Codex Stop hook (see hooks.json; after editing the hook definition, review and
// trust it in Codex's /hooks menu). Each `turn_context` names the model for a
// turn; each `token_usage_record` is one API request. The latter first appeared
// in Codex 0.154 (2026-09), so older sessions show as partial. Subagent and
// guardian-review threads live in their own rollouts (see `childTranscripts`).
// The JSONL transcript format is not a stable API.
export class CostTracker {
  session = 0
  turns = new Map<string, number>()
  missing = new Set<string>()
  currentTurn = ""
  sessionId = ""
  private provider = "openai"
  private contexts = new Map<string, TurnContext>()

  add(record: any) {
    const p = record?.payload
    if (!p) return
    if (record.type === "session_meta") {
      this.provider = p.model_provider ?? "openai"
      this.sessionId ||= p.session_id ?? ""
    } else if (record.type === "turn_context" && p.turn_id) {
      this.currentTurn = p.turn_id
      this.contexts.set(p.turn_id, { model: p.model ?? "", tier: p.service_tier ?? null })
    } else if (record.type === "token_usage_record") {
      // Subagent requests carry the parent turn they were spawned from.
      const turn = p.root_turn_id ?? p.turn_id ?? this.currentTurn
      const context = this.contexts.get(p.turn_id ?? turn) ?? { model: "", tier: null }
      const cost = this.provider === "openai" && validUsage(p.usage)
        ? requestCost(context.model, context.tier, p.usage) : undefined
      if (cost === undefined) {
        this.missing.add(`${this.provider}/${context.model || "unknown model"}/${context.tier ?? "default"}`)
        return
      }
      this.session += cost
      this.turns.set(turn, (this.turns.get(turn) ?? 0) + cost)
    }
  }

  message(turnId = this.currentTurn): string {
    const money = (value: number) => `$${value.toFixed(value < 0.01 && value > 0 ? 4 : 2)}`
    const turn = this.turns.has(turnId) ? money(this.turns.get(turnId)!) : "unavailable"
    const partial = this.missing.size ? ` · partial: ${[...this.missing].join(", ")}` : ""
    return `Token cost ≈ ${turn} this turn · ${money(this.session)} session${partial}`
  }
}

async function addTranscript(tracker: CostTracker, path: string) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  let priced = false
  let legacy = false
  for await (const line of lines) {
    // Skip parsing the bulk of the transcript (tool outputs, messages).
    if (!/"type":"(session_meta|turn_context|token_usage_record)"/.test(line)) {
      legacy ||= line.includes('"type":"token_count"')
      continue
    }
    priced ||= line.includes('"type":"token_usage_record"')
    try {
      tracker.add(JSON.parse(line))
    } catch {
      // A writer may still be appending the last JSONL record.
      tracker.missing.add("incomplete transcript")
    }
  }
  if (legacy && !priced) tracker.missing.add("requests before Codex 0.154")
}

// Subagent and guardian-review threads are separate rollouts under the same
// ~/.codex/sessions/YYYY/MM/DD tree. Their session_meta shares the root's
// session_id and names a parent_thread_id; forks and resumed threads do not.
export async function childTranscripts(root: string, sessionId: string): Promise<string[]> {
  const match = root.match(/^(.*)\/(\d{4}\/\d{2}\/\d{2})\/[^/]+$/)
  if (!match) return []
  const [, sessions, rootDay] = match
  const children: string[] = []
  for await (const rel of new Bun.Glob("*/*/*/*.jsonl").scan(sessions)) {
    if (rel.slice(0, 10) < rootDay || `${sessions}/${rel}` === root) continue
    const head = await Bun.file(`${sessions}/${rel}`).slice(0, 2048).text()
    if (head.includes(`"session_id":"${sessionId}"`) && head.includes('"parent_thread_id":"') &&
      !head.includes(`"id":"${sessionId}"`)) children.push(`${sessions}/${rel}`)
  }
  return children.sort()
}

export async function estimateTranscript(path: string, turnId?: string): Promise<string> {
  const tracker = new CostTracker()
  await addTranscript(tracker, path)
  const rootTurn = tracker.currentTurn
  if (tracker.sessionId) {
    for (const child of await childTranscripts(path, tracker.sessionId)) await addTranscript(tracker, child)
  }
  return tracker.message(turnId ?? rootTurn)
}

// Find the rollout for a thread id (from `codex exec --json`'s thread.started
// event). Filenames are rollout-<timestamp>-<thread_id>.jsonl under
// ~/.codex/sessions/YYYY/MM/DD.
export async function findRollout(threadId: string): Promise<string | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(threadId)) return undefined
  const sessions = `${process.env.CODEX_HOME ?? `${process.env.HOME}/.codex`}/sessions`
  const found: string[] = []
  for await (const rel of new Bun.Glob(`*/*/*/rollout-*-${threadId}.jsonl`).scan(sessions)) {
    found.push(`${sessions}/${rel}`)
  }
  return found.sort().at(-1)
}

if (import.meta.main) {
  // `bun cost.ts <thread_id>` prices a thread outside the hook, e.g. after each
  // `codex exec` / `codex exec resume` call. "This turn" is the latest turn.
  const threadId = process.argv[2]
  if (threadId) {
    const path = await findRollout(threadId)
    if (!path) {
      console.error(`No rollout found for thread ${threadId}`)
      process.exit(1)
    }
    console.log(await estimateTranscript(path))
    process.exit(0)
  }
  try {
    const input = await Bun.stdin.json()
    if (input.hook_event_name === "Stop" && input.transcript_path) {
      console.log(JSON.stringify({
        systemMessage: await estimateTranscript(input.transcript_path, input.turn_id),
      }))
    }
  } catch {
    // Hook failures must never interrupt or extend the agent's turn.
    console.log(JSON.stringify({ systemMessage: "Token cost unavailable: could not read the transcript." }))
  }
}
