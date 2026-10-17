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

// Subscription usage windows. rate_limits is only present for Pro/Max accounts
// (so not the enterprise one) and only after the first API response; each
// window can be absent on its own:
// https://code.claude.com/docs/en/statusline#rate-limit-usage
// "3:40", no AM/PM: the 5h reset is never far enough away to be ambiguous
function clockTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(at)
  return parts
    .filter((p) => p.type === "hour" || p.type === "minute" || p.type === "literal")
    .map((p) => p.value)
    .join("")
    .trim()
}

// "Wed", or "3pm" when the reset is less than a day away
function weekReset(at: Date): string {
  if (at.getTime() - Date.now() >= 24 * 60 * 60 * 1000) {
    return at.toLocaleDateString("en-US", { weekday: "short" })
  }
  return at
    .toLocaleTimeString("en-US", { hour: "numeric" })
    .replace(/\s/, "") // ICU may use a narrow no-break space here
    .toLowerCase()
}

function windowSegment(
  label: string,
  window: { used_percentage?: number; resets_at?: number } | undefined,
  formatReset: (at: Date) => string,
): string | undefined {
  if (typeof window?.used_percentage !== "number") return undefined
  const used = `${label} ${Math.round(window.used_percentage)}%`
  if (typeof window.resets_at !== "number") return used
  return `${used} → ${formatReset(new Date(window.resets_at * 1000))}`
}

const segments = [
  model,
  `${kFmt.format(tokens / 1000)}k (${pct}%)`,
  costFmt.format(cost),
  cacheColdSegment(),
  windowSegment("5h", input.rate_limits?.five_hour, clockTime),
  // Shown always for now to get a feel for weekly usage. Once that's familiar,
  // consider hiding it until used_percentage passes ~70%.
  windowSegment("7d", input.rate_limits?.seven_day, weekReset),
].filter(Boolean)

console.log(segments.join(" | "))
