#!/usr/bin/env bun

const input = await Bun.stdin.json();

const size = input.context_window.context_window_size;
const usage = input.context_window.current_usage;
const tokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0);
const model = input.model.display_name;
const cost = input.cost.total_cost_usd ?? 0;
const pct = Math.floor(tokens * 100 / size);

const kFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const costFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

console.log(
  `${model} | ${kFmt.format(tokens / 1000)}k (${pct}%) | ${
    costFmt.format(cost)
  }`,
);
