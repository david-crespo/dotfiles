#!/usr/bin/env bun

// No daily cost tracking because pulling it from JSONL files is unreliable:
// Anthropic doesn't log thinking or tool use tokens in output_tokens, and
// subagent conversations are in nested directories. See ccusage issues #705,
// #779, #797, #806.

const input = await Bun.stdin.json()

const size = input.context_window.context_window_size
const usage = input.context_window.current_usage
const tokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0)
const model = input.model.display_name
const cost = input.cost.total_cost_usd ?? 0
const pct = Math.floor(tokens * 100 / size)

const kFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const costFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

// When the prompt cache goes cold, the next message pays the full uncached
// input price for the whole context. prompt_cache.expires_at comes from Claude
// Code (>= 2.1.251): https://code.claude.com/docs/en/statusline#prompt-cache-fields
// Absolute time rather than an age, since the status line only re-renders on
// activity.
function cacheColdSegment(): string | undefined {
  const pc = input.prompt_cache
  if (!pc) return undefined
  if (pc.warm === false) return "cache cold"
  if (typeof pc.expires_at !== "number") return undefined
  const at = new Date(pc.expires_at * 1000)
  return `cache cold ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

const segments = [
  model,
  `${kFmt.format(tokens / 1000)}k (${pct}%)`,
  costFmt.format(cost),
  cacheColdSegment(),
].filter(Boolean)

console.log(segments.join(" | "))
