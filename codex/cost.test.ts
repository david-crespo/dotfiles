import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { childTranscripts, CostTracker, estimateTranscript, requestCost } from "./cost.ts"

test("prices cache reads, cache writes, and output including reasoning", () => {
  expect(requestCost("gpt-6-astra", null, {
    input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 300, output_tokens: 100,
  })).toBeCloseTo(0.01035)
})

test("prices Fast, Flex, dated models, and the long-context boundary", () => {
  const usage = { input_tokens: 272_000, cached_input_tokens: 0, output_tokens: 1000 }
  expect(requestCost("gpt-6-astra", "priority", usage)).toBeCloseTo(5.54)
  expect(requestCost("gpt-6-astra", "flex", usage)).toBeCloseTo(1.385)
  expect(requestCost("gpt-6-astra-2026-09-01", "default", { ...usage, input_tokens: 272_001 }))
    .toBeCloseTo(5.51502)
  expect(requestCost("gpt-5.5", "fast", { ...usage, input_tokens: 272_001 })).toBeUndefined()
  expect(requestCost("gpt-5.6-sol", "ultrafast", usage)).toBeUndefined()
  expect(requestCost("unknown", null, usage)).toBeUndefined()
})

function context(tracker: CostTracker, turn: string, model = "gpt-6-astra", tier: string | null = null) {
  tracker.add({ type: "turn_context", payload: { turn_id: turn, model, service_tier: tier } })
}

function request(tracker: CostTracker, turn: string, input: number, root = turn) {
  const usage = { input_tokens: input, cached_input_tokens: 0, output_tokens: 0 }
  tracker.add({ type: "token_usage_record", payload: { turn_id: turn, root_turn_id: root, usage } })
}

test("sums requests per turn and per session using each turn's model", () => {
  const tracker = new CostTracker()
  context(tracker, "a")
  request(tracker, "a", 1000)
  request(tracker, "a", 1000)
  context(tracker, "b", "gpt-5.6-luna", "priority")
  request(tracker, "b", 1000)
  request(tracker, "b", 1000)
  expect(tracker.turns.get("a")).toBeCloseTo(0.02)
  expect(tracker.turns.get("b")).toBeCloseTo(0.0008)
  expect(tracker.session).toBeCloseTo(0.0208)
  expect(tracker.message("b")).toContain("$0.0008 this turn · $0.02 session")
})

test("charges subagent requests to the parent turn at the subagent's model", () => {
  const tracker = new CostTracker()
  context(tracker, "a")
  request(tracker, "a", 1000)
  context(tracker, "guardian-1", "gpt-5.6-luna")
  request(tracker, "guardian-1", 1000, "a")
  expect(tracker.turns.get("a")).toBeCloseTo(0.0102)
  expect(tracker.turns.has("guardian-1")).toBe(false)
})

const sessionMeta = (id: string, session: string, parent?: string) =>
  JSON.stringify({ type: "session_meta", payload: { session_id: session, id, parent_thread_id: parent } }) + "\n"

async function sessionsTree(home: string) {
  const day = join(home, "sessions", "2026", "09", "10")
  await mkdir(day, { recursive: true })
  await mkdir(join(home, "sessions", "2026", "09", "09"))
  const usage = { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }
  const records = (turn: string, root: string, model: string) => [
    { type: "turn_context", payload: { turn_id: turn, model } },
    { type: "token_usage_record", payload: { turn_id: turn, root_turn_id: root, usage } },
  ].map((record) => JSON.stringify(record)).join("\n") + "\n"
  await writeFile(join(day, "rollout-root.jsonl"), sessionMeta("root", "root") + records("t1", "t1", "gpt-6-astra"))
  await writeFile(join(day, "rollout-child.jsonl"), sessionMeta("child", "root", "root") + records("c1", "t1", "gpt-6-astra"))
  await writeFile(join(day, "rollout-fork.jsonl"), sessionMeta("fork", "root") + records("f1", "f1", "gpt-6-astra"))
  await writeFile(join(day, "rollout-other.jsonl"), sessionMeta("other", "other", "elsewhere") + records("o1", "o1", "gpt-6-astra"))
  await writeFile(join(home, "sessions", "2026", "09", "09", "rollout-old.jsonl"), sessionMeta("old", "root", "root"))
  return join(day, "rollout-root.jsonl")
}

test("finds subagent rollouts by session id and parent link, ignoring forks and other sessions", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-cost-test-"))
  try {
    const root = await sessionsTree(home)
    expect(await childTranscripts(root, "root")).toEqual([root.replace("rollout-root", "rollout-child")])
    expect(await childTranscripts(join(home, "rollout.jsonl"), "root")).toEqual([])
    expect(await estimateTranscript(root, "t1")).toBe("Token cost ≈ $0.03 this turn · $0.03 session")
  } finally {
    await rm(home, { recursive: true })
  }
})

test("marks unknown models and invalid usage as partial without dropping priced requests", () => {
  const tracker = new CostTracker()
  context(tracker, "a")
  request(tracker, "a", 1000)
  tracker.add({ type: "token_usage_record", payload: { turn_id: "a", usage: { input_tokens: -1 } } })
  context(tracker, "b", "unknown")
  request(tracker, "b", 1000)
  expect(tracker.session).toBeCloseTo(0.01)
  expect(tracker.message()).toContain("unavailable this turn")
  expect(tracker.message()).toContain("partial: openai/gpt-6-astra/default, openai/unknown/default")
})

test("does not use OpenAI prices for custom providers", () => {
  const tracker = new CostTracker()
  tracker.add({ type: "session_meta", payload: { model_provider: "custom" } })
  context(tracker, "a")
  request(tracker, "a", 1000)
  expect(tracker.session).toBe(0)
  expect(tracker.message()).toContain("partial: custom/")
})

test("missing transcripts reject so the hook can report unavailable", async () => {
  await expect(estimateTranscript("/nonexistent/codex-cost-test.jsonl")).rejects.toThrow()
})

test("the configured hook emits informational JSON and never asks Codex to continue", async () => {
  // hooks.json runs cost.ts from $HOME/repos/dotfiles; point HOME at this checkout.
  const home = await mkdtemp(join(tmpdir(), "codex-cost-test-"))
  try {
    await mkdir(join(home, "repos"))
    await symlink(dirname(dirname(fileURLToPath(import.meta.url))), join(home, "repos", "dotfiles"))
    const path = await sessionsTree(home)
    const config = await Bun.file(new URL("./hooks.json", import.meta.url)).json()
    const command = config.hooks.Stop[0].hooks.find((hook: any) => hook.command.includes("cost.ts")).command
    const child = Bun.spawn(["/bin/sh", "-c", command], {
      env: { ...process.env, HOME: home },
      stdin: new Blob([JSON.stringify({ hook_event_name: "Stop", transcript_path: path, turn_id: "t1" })]),
      stdout: "pipe", stderr: "pipe",
    })
    const output = JSON.parse(await new Response(child.stdout).text())
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stderr).text()).toBe("")
    expect(Object.keys(output)).toEqual(["systemMessage"])
    expect(output.systemMessage).toBe("Token cost ≈ $0.03 this turn · $0.03 session")
  } finally {
    await rm(home, { recursive: true })
  }
})
