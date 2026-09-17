#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write=. --allow-net=api.typesafe.ai --allow-run=ai

// tseval: compare Typesafe (jev) against LLMs called through `ai` on
// classification tasks over a labeled dataset. Runs every row through one or
// more runners, persists every prediction, and reports accuracy, confidence
// coverage, latency, and cost side by side.
//
//   tseval run -d <dataset.jsonl> --task keep3 --state title --runner typesafe --runner ai:luna --releases 22
//   tseval run -d <dataset.jsonl> --task keep3 --state title_body --runner typesafe --releases 15..22
//   tseval report <dataset dir>/runs/<file>.jsonl [--errors]
//
// The dataset is a JSONL of rows as described in lib/tseval/tasks.ts (built by
// an unversioned script; pass its path with -d or TSEVAL_DATASET). Tasks and
// state variants live in lib/tseval/tasks.ts; runners in lib/tseval/runners.ts.
//
// Every (runner, task, state, row) result is cached under <dataset dir>/cache/
// keyed by a hash of the exact prompt and state, so adding a runner or
// re-running the report never refetches. Runs land in
// <dataset dir>/runs/<timestamp>_<task>_<state>.jsonl plus a .meta.json with
// the rendered prompts and arguments.
//
// The `ai` runner needs the sandbox off (its wrapper reads a .env the sandbox
// denies). The Typesafe runner needs TYPESAFE_API_KEY (or the key file, see
// lib/typesafe.ts); cost uses the published rate unless TYPESAFE_INPUT_PER_M /
// TYPESAFE_OUTPUT_PER_M override it.

import { Command, EnumType, ValidationError } from "@cliffy/command"
import { Table } from "@cliffy/table"
import { encodeHex } from "@std/encoding/hex"
import { ensureDir } from "@std/fs"
import { dirname, join } from "@std/path"
import { makeRunner, type Prediction, type Runner } from "./lib/tseval/runners.ts"
import {
  renderSystemPrompt,
  type Row,
  STATES,
  type Task,
  TASKS,
} from "./lib/tseval/tasks.ts"

/** Dataset path from -d or TSEVAL_DATASET; runs/ and cache/ sit next to it. */
function resolveDataset(flag?: string): { dataset: string; runs: string; cache: string } {
  const dataset = flag ?? Deno.env.get("TSEVAL_DATASET")
  if (!dataset) {
    throw new ValidationError(
      "dataset required: pass -d <path.jsonl> or set TSEVAL_DATASET",
    )
  }
  const dir = dirname(dataset)
  return { dataset, runs: join(dir, "runs"), cache: join(dir, "cache") }
}

interface ResultRow {
  sha: string
  release: number
  title: string
  prefix: string | null
  placement: string
  label: string
  runner: string
  task: string
  state: string
  prediction: string
  correct: boolean
  collapsed_label?: "keep" | "drop"
  collapsed_prediction?: "keep" | "drop"
  probabilities?: Record<string, number>
  confidence?: number
  tokens?: Prediction["tokens"]
  cost: number | null
  timeMs: number
  wallMs: number
  model: string
  error?: string
}

// --- data -------------------------------------------------------------------

async function loadRows(path: string): Promise<Row[]> {
  const text = await Deno.readTextFile(path)
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Row)
}

/** `22`, `15..22`, or `15,17,22`. */
function parseReleases(spec: string | undefined): (r: number) => boolean {
  if (!spec) return () => true
  const range = spec.match(/^(\d+)\.\.(\d+)$/)
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])]
    return (r) => r >= lo && r <= hi
  }
  const set = new Set(spec.split(",").map(Number))
  return (r) => set.has(r)
}

// --- cache ------------------------------------------------------------------

async function cacheKey(runner: string, task: Task, stateName: string, state: unknown) {
  const material = JSON.stringify({
    runner,
    task: task.name,
    kind: task.kind,
    instructions: task.instructions,
    criteria: task.criteria,
    schema: task.aiSchema,
    stateName,
    state,
  })
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material))
  return encodeHex(digest).slice(0, 32)
}

async function cached<T>(path: string, compute: () => Promise<T>): Promise<T> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T
  } catch {
    const value = await compute()
    await ensureDir(dirname(path))
    await Deno.writeTextFile(path, JSON.stringify(value))
    return value
  }
}

// --- run --------------------------------------------------------------------

async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

async function runOne(
  runner: Runner,
  task: Task,
  stateName: string,
  row: Row,
  all: Row[],
  cacheDir: string | null,
): Promise<ResultRow> {
  const state = STATES[stateName](row, all)
  const key = await cacheKey(runner.name, task, stateName, state)
  const useCache = cacheDir !== null
  const path = join(cacheDir ?? "", runner.name.replace(/[^\w.-]/g, "_"), `${key}.json`)
  const compute = () => runner.run(task, state)
  let pred = useCache ? await cached(path, compute) : await compute()
  // Never cache errors; retry them on the next run.
  if (pred.error && useCache) {
    await Deno.remove(path).catch(() => {})
    pred = await compute()
    if (!pred.error) await Deno.writeTextFile(path, JSON.stringify(pred))
  }
  const label = task.label(row)
  return {
    sha: row.sha,
    release: row.release,
    title: row.title,
    prefix: row.prefix,
    placement: row.placement,
    label,
    runner: runner.name,
    task: task.name,
    state: stateName,
    prediction: pred.prediction,
    correct: pred.prediction === label,
    collapsed_label: task.collapse?.(label),
    collapsed_prediction: pred.prediction && task.collapse
      ? task.collapse(pred.prediction)
      : undefined,
    probabilities: pred.probabilities,
    confidence: pred.confidence,
    tokens: pred.tokens,
    cost: pred.cost,
    timeMs: pred.timeMs,
    wallMs: pred.wallMs,
    model: pred.model,
    error: pred.error,
  }
}

// --- report -----------------------------------------------------------------

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const money = (n: number | null) => (n === null ? "?" : `$${n.toFixed(4)}`)
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

function accuracy(rows: ResultRow[]) {
  return rows.length ? rows.filter((r) => r.correct).length / rows.length : 0
}

/** Confusion matrix (true label x predicted) with per-class precision and
 * recall. Errors are counted under a "?" column. */
function confusion(rows: ResultRow[]) {
  const classes = [...new Set(rows.flatMap((r) => [r.label, r.prediction]))].filter(Boolean)
    .sort()
  const cols = rows.some((r) => !r.prediction) ? [...classes, "?"] : classes
  const count = (label: string, pred: string) =>
    rows.filter((r) => r.label === label && (r.prediction || "?") === pred).length
  const matrix = classes.map((c) => {
    const tp = count(c, c)
    const predicted = rows.filter((r) => r.prediction === c).length
    const actual = rows.filter((r) => r.label === c).length
    return {
      c,
      cells: cols.map((p) => count(c, p)),
      n: actual,
      precision: predicted ? tp / predicted : 0,
      recall: actual ? tp / actual : 0,
    }
  })
  return { cols, matrix }
}

function report(all: ResultRow[], showErrors: boolean) {
  const runners = [...new Set(all.map((r) => r.runner))]
  const header = all[0]
  const rows = new Set(all.map((r) => r.sha)).size
  console.log(`\ntask=${header.task} state=${header.state} rows=${rows}\n`)

  // Headline table, one line per runner.
  const summary = new Table().header([
    "runner",
    "n",
    "err",
    "acc",
    "acc(hard)",
    "bin acc",
    "keep recall",
    "p50 ms",
    "p95 ms",
    "p50 wall",
    "cost total",
    "$/1k rows",
  ])
  for (const name of runners) {
    const rows = all.filter((r) => r.runner === name)
    const ok = rows.filter((r) => !r.error)
    // Hard subset: rows where the prefix does not decide the answer.
    const hard = ok.filter((r) => r.prefix === null || r.prefix === "minor")
    const binary = ok.filter((r) => r.collapsed_label)
    const binAcc = binary.length
      ? binary.filter((r) => r.collapsed_label === r.collapsed_prediction).length /
        binary.length
      : NaN
    const keeps = binary.filter((r) => r.collapsed_label === "keep")
    const keepRecall = keeps.length
      ? keeps.filter((r) => r.collapsed_prediction === "keep").length / keeps.length
      : NaN
    const costs = ok.map((r) => r.cost)
    const total = ok.length && costs.every((c) => c !== null)
      ? costs.reduce((a, c) => a + (c ?? 0), 0)
      : null
    const times = ok.map((r) => r.timeMs)
    // Older run files predate wallMs; fall back to timeMs so `report` still works.
    const walls = ok.map((r) => r.wallMs ?? r.timeMs)
    summary.push([
      name,
      String(rows.length),
      String(rows.length - ok.length),
      pct(accuracy(ok)),
      `${pct(accuracy(hard))} (${hard.length})`,
      Number.isNaN(binAcc) ? "-" : pct(binAcc),
      Number.isNaN(keepRecall) ? "-" : pct(keepRecall),
      quantile(times, 0.5).toFixed(0),
      quantile(times, 0.95).toFixed(0),
      quantile(walls, 0.5).toFixed(0),
      money(total),
      total === null ? "?" : money(total / ok.length * 1000),
    ])
  }
  summary.border(true).render()

  // Confusion matrix per runner: rows are the true label, columns the
  // prediction, so each off-diagonal cell is one kind of mistake.
  for (const name of runners) {
    const rows = all.filter((r) => r.runner === name)
    const { cols, matrix } = confusion(rows)
    const t = new Table().header([
      `${name}: true \\ predicted`,
      ...cols.map((c) => `-> ${c}`),
      "n",
      "precision",
      "recall",
    ])
    for (const { c, cells, n, precision, recall } of matrix) {
      t.push([c, ...cells.map(String), String(n), pct(precision), pct(recall)])
    }
    console.log()
    t.border(true).render()
  }

  // Confidence coverage: what fraction can be auto-decided at each threshold,
  // and how accurate those decisions are. Only runners that report confidence.
  for (const name of runners) {
    const ok = all.filter((r) =>
      r.runner === name && !r.error && r.confidence !== undefined
    )
    if (ok.length === 0) continue
    const t = new Table().header([
      `${name} threshold`,
      "coverage",
      "acc(covered)",
      "acc(rest)",
      "bin acc(covered)",
    ])
    for (const th of [0.5, 0.7, 0.8, 0.9, 0.95, 0.99]) {
      const covered = ok.filter((r) => (r.confidence ?? 0) >= th)
      const rest = ok.filter((r) => (r.confidence ?? 0) < th)
      const bin = covered.filter((r) => r.collapsed_label)
      const binAcc = bin.length
        ? bin.filter((r) => r.collapsed_label === r.collapsed_prediction).length /
          bin.length
        : NaN
      t.push([
        th.toFixed(2),
        `${pct(covered.length / ok.length)} (${covered.length})`,
        pct(accuracy(covered)),
        rest.length ? pct(accuracy(rest)) : "-",
        Number.isNaN(binAcc) ? "-" : pct(binAcc),
      ])
    }
    console.log()
    t.border(true).render()
  }

  if (showErrors) {
    for (const name of runners) {
      const wrong = all.filter((r) => r.runner === name && (!r.correct || r.error))
      console.log(`\n${name}: ${wrong.length} wrong or errored`)
      for (const r of wrong) {
        const conf = r.confidence !== undefined ? ` (${r.confidence.toFixed(2)})` : ""
        const err = r.error ? ` ERROR ${r.error}` : ""
        console.log(
          `  v${r.release} ${r.label} -> ${r.prediction || "?"}${conf}  ${r.title}${err}`,
        )
      }
    }
  }
}

// --- cli --------------------------------------------------------------------

await new Command()
  .name("eval")
  .description("Release-notes curation eval: Typesafe vs ai models")
  .command("run", "Run a task over the dataset with one or more runners")
  .option("-d, --dataset <path:string>", "Dataset JSONL (or TSEVAL_DATASET)")
  .type("task", new EnumType(Object.keys(TASKS)))
  .type("state", new EnumType(Object.keys(STATES)))
  .option("-t, --task <task:task>", "Task", { default: "keep3" })
  .option("-s, --state <state:state>", "State variant", { default: "title" })
  .option(
    "-r, --runner <runner:string>",
    "Runner: typesafe[:model] or ai:<model>[:quick|default|think|think-hard]",
    {
      collect: true,
      default: ["typesafe", "ai:luna"],
    },
  )
  .option("--releases <spec:string>", "Release filter: 22, 15..22, or 15,17,22")
  .option("--limit <n:number>", "Max rows (after release filter)")
  .option("--shuffle", "Shuffle rows before --limit (deterministic seed)")
  .option("-c, --concurrency <n:number>", "Parallel calls per runner", { default: 4 })
  .option("--no-cache", "Ignore cached predictions")
  .option("--errors", "List misclassified rows after the report")
  .action(async (opts) => {
    const task = TASKS[opts.task]
    const paths = resolveDataset(opts.dataset)
    const all = await loadRows(paths.dataset)
    const keep = parseReleases(opts.releases)
    let rows = all.filter((r) => keep(r.release))
    if (opts.shuffle) {
      // Fixed-seed shuffle so --limit picks the same subset every run.
      let seed = 42
      const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
      rows = rows.map((r) => [rand(), r] as const).sort((a, b) => a[0] - b[0]).map((
        [, r],
      ) => r)
    }
    if (opts.limit) rows = rows.slice(0, opts.limit)
    const runners = (opts.runner as string[]).map(makeRunner)
    console.error(
      `task=${task.name} state=${opts.state} rows=${rows.length} runners=${
        runners.map((r) => r.name).join(",")
      }`,
    )

    const results: ResultRow[] = []
    for (const runner of runners) {
      const cacheDir = opts.cache ? paths.cache : null
      const one = (row: Row) => runOne(runner, task, opts.state, row, all, cacheDir)
      // Probe with one row before fanning out. An outage or a bad key fails
      // every call the same way; no point making hundreds of them.
      const first = await one(rows[0])
      if (first.error) {
        console.error(
          `  ${runner.name}: first call failed, skipping runner: ${first.error}`,
        )
        results.push(first)
        continue
      }
      let done = 1
      const out = await pool(rows.slice(1), opts.concurrency, async (row) => {
        const res = await one(row)
        done++
        if (done % 25 === 0 || done === rows.length) {
          console.error(`  ${runner.name}: ${done}/${rows.length}`)
        }
        return res
      })
      results.push(first, ...out)
    }

    await ensureDir(paths.runs)
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)
    const base = join(paths.runs, `${stamp}_${task.name}_${opts.state}`)
    await Deno.writeTextFile(
      `${base}.jsonl`,
      results.map((r) => JSON.stringify(r)).join("\n") + "\n",
    )
    await Deno.writeTextFile(
      `${base}.meta.json`,
      JSON.stringify(
        {
          args: opts,
          dataset: paths.dataset,
          rows: rows.length,
          task: { ...task, label: undefined, collapse: undefined },
          systemPrompt: renderSystemPrompt(task),
          sampleState: STATES[opts.state](rows[0], all),
        },
        null,
        2,
      ),
    )
    console.error(`wrote ${base}.jsonl`)
    report(results, opts.errors ?? false)
  })
  .command("report", "Re-render the report for saved run files")
  .arguments("<files...:string>")
  .option("--errors", "List misclassified rows")
  .action(async (opts, ...files) => {
    for (const file of files) {
      const text = await Deno.readTextFile(file)
      const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResultRow)
      console.log(`\n=== ${file}`)
      report(rows, opts.errors ?? false)
    }
  })
  .parse(Deno.args)
