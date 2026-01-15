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

console.log(
  `${model} | ${kFmt.format(tokens / 1000)}k (${pct}%) | ${costFmt.format(cost)}`,
)
