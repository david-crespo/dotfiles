import type { EngineInterface as Host, Register } from 'claude-code'

// Runs recipes of MCP calls and host commands with no model in the loop,
// writing each step's output to a file in one run folder. Each recipe is a
// tool, `mcp__mcp-batch__<skill>_<recipe>`, that starts it and returns the
// folder at once, so the agent can keep talking while it runs; `wait` blocks
// until it is done and says which steps worked.
//
// A recipe is a `<recipe>.recipe.json` file in a skill folder, under
// ~/.claude/skills or the project's .claude/skills:
//   {
//     "description": "What the tool gathers, for the model",
//     "vars": {
//       "days": { "type": "number", "description": "Inbox window", "default": 3 }
//     },
//     "steps": [
//       { "name": "notes", "run": ["./notes.sh", "--days", "${days}"] },
//       { "name": "inbox",
//         "mcp": { "server": "claude.ai Gmail", "tool": "search_threads",
//                  "args": { "query": "newer_than:${days}d", "pageSize": 20 } },
//         "paginate": { "token": "nextPageToken", "arg": "pageToken", "items": "threads" },
//         "format": ["bun", "format.ts", "gmail"] }
//     ]
//   }
// `vars` is the tool's input schema, and a var with no default is required.
// `${name}` takes a var, or a timestamp: `${now}`, `${now+7d}`, `${now-2d}`.
// Commands run in the recipe's folder, so `./script` and relative arguments
// name its siblings. A `run` step's stdout is `<name>.txt`, and an `mcp` step's
// result, its pages merged, is `<name>.json`. With `format`, that output is
// piped to the command, whose stdout is `<name>.txt` (a `run` step's own
// output moves to `<name>.raw.txt`). What `format` writes to stderr is a
// warning: `wait` shows the step as WARN with the text, which is how a recipe
// flags a command that exits 0 with part of its output missing.
//
// Tools are declared at session start, so a new recipe or a change to its
// vars takes /reload-plugins; the steps are read again at each run.

const RUNS = '/tmp/claude/mcp-batch'
const SUFFIX = '.recipe.json'

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }
type Vars = Record<string, string | number>
type Var = { type: 'string' | 'number'; description?: string; default?: string | number }
type Paginate = { token: string; arg: string; items: string; max?: number }
type Step = { name: string; timeoutMs?: number; format?: string[] } & (
  | { run: string[] }
  | { mcp: { server: string; tool: string; args?: Record<string, Json> }; paginate?: Paginate }
)
type Recipe = { description?: string; vars?: Record<string, Var>; steps: Step[] }

type Outcome = { name: string; state: 'ok' | 'warn' | 'failed'; files: string[]; summary: string; warnings?: string }
type Status = { recipe: string; started: string; finished?: string; steps: string[]; done: Outcome[] }

export const register: Register = on => {
  // Registered tool name → recipe path, and the name `wait` got. Kept from the
  // registration's result, since the prefix is the plugin's installed name.
  const recipes = new Map<string, { path: string; name: string }>()
  let waitTool = ''

  on('session.start', async ($, e, next) => {
    recipes.clear()
    for (const { name, path } of await findRecipes($)) {
      let spec: { description: string; inputSchema: Record<string, unknown> }
      try {
        spec = toolSpec(JSON.parse(await $.fs.read(path)) as Recipe)
      } catch (err) {
        spec = { description: `Broken mcp-batch recipe ${path}: ${err}`, inputSchema: { type: 'object' } }
      }
      const { tool } = await $.tool.register({ name, ...spec })
      recipes.set(tool, { path, name })
    }
    ;({ tool: waitTool } = await $.tool.register({
      name: 'wait',
      description:
        'Wait for an mcp-batch run to finish (up to 10 minutes) and list each step with its files and whether it succeeded.',
      inputSchema: {
        type: 'object',
        properties: { dir: { type: 'string', description: 'The run folder the recipe tool returned' } },
        required: ['dir'],
      },
    }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === waitTool) return { result: await wait($, (e as unknown as { dir: string }).dir) }
    const recipe = recipes.get(e.tool)
    if (!recipe) return next(e)
    return { result: await start($, recipe.path, recipe.name, e as unknown as Record<string, unknown>) }
  })
}

async function start($: Host, path: string, name: string, input: Record<string, unknown>): Promise<string> {
  const recipeDir = path.slice(0, path.lastIndexOf('/'))
  let recipe: Recipe
  try {
    recipe = JSON.parse(await $.fs.read(path)) as Recipe
  } catch (err) {
    return `Can't read recipe ${path}: ${err}`
  }

  // Fill every placeholder before anything runs, so a missing var is an
  // error the agent sees now rather than a failed step later.
  const started = new Date()
  const vars: Vars = {}
  for (const [key, spec] of Object.entries(recipe.vars ?? {})) {
    const value = input[key] ?? spec.default
    if (typeof value === 'string' || typeof value === 'number') vars[key] = value
  }
  const missing = new Set<string>()
  const steps = recipe.steps.map(s => fill(s, vars, started, missing) as Step)
  if (missing.size) return `No value for ${[...missing].map(m => '${' + m + '}').join(', ')}`

  const dir = `${RUNS}/${name}-${stamp(started)}`
  const status: Status = { recipe: path, started: started.toISOString(), steps: steps.map(s => s.name), done: [] }
  // Writes queue so a slow write never lands over a newer one.
  let writing = Promise.resolve()
  const save = () => (writing = writing.then(() => $.fs.write(`${dir}/status.json`, JSON.stringify(status, null, 2))))
  await save()

  // Outlives this call: the hook returns the folder now, and the steps
  // finish on their own, marking the run done for wait.
  void Promise.all(
    steps.map(async s => {
      status.done.push(await runStep($, s, dir, recipeDir))
      await save()
    }),
  ).then(async () => {
    status.finished = new Date().toISOString()
    await save()
    await $.fs.write(`${dir}/done`, '')
  })

  return `Running ${steps.length} steps (${status.steps.join(', ')}) into ${dir}. Call wait with that folder before reading it.`
}

async function wait($: Host, dir: string): Promise<string> {
  if (!(await $.fs.exists(`${dir}/status.json`))) return `wait: no mcp-batch run in ${dir}`
  // The wait is a host process, so it costs this hook's budget nothing.
  const waited = await $.process
    .run(['sh', '-c', 'until [ -f "$1/done" ]; do sleep 1; done', 'sh', dir], { timeoutMs: 600_000 })
    .catch((err: unknown) => err)
  const status = JSON.parse(await $.fs.read(`${dir}/status.json`)) as Status
  const label = { ok: 'ok    ', warn: 'WARN  ', failed: 'FAILED' }
  const lines = status.steps.flatMap(name => {
    const o = status.done.find(d => d.name === name)
    if (!o) return [`...    ${name.padEnd(10)} still running`]
    const line = `${label[o.state]} ${name.padEnd(10)} ${o.files.join(' ') || '-'}  ${o.summary}`
    return [line, ...(o.warnings?.split('\n').map(w => `         ${w}`) ?? [])]
  })
  if (!(waited && typeof waited === 'object' && 'exitCode' in waited)) {
    return [`Not done after 10 minutes (${waited}), files in ${dir}:`, ...lines].join('\n')
  }
  const secs = Math.round((Date.parse(status.finished!) - Date.parse(status.started)) / 1000)
  return [`Finished in ${secs}s, files in ${dir}:`, ...lines].join('\n')
}

async function runStep($: Host, step: Step, dir: string, cwd: string): Promise<Outcome> {
  const files: string[] = []
  const notes: string[] = []
  const save = async (file: string, text: string) => {
    await $.fs.write(`${dir}/${file}`, text)
    files.push(file)
  }
  try {
    let output: string
    if ('run' in step) {
      const r = await exec($, step.run, cwd, step.timeoutMs)
      output = r.stdout
      await save(`${step.name}.${step.format ? 'raw.txt' : 'txt'}`, output)
      if (r.isStdoutTruncated) notes.push('TRUNCATED at 4 MiB')
      if (r.stderr.trim()) notes.push(`stderr: ${firstLine(r.stderr)}`)
    } else {
      const { value, items } = await callAll($, step.mcp.server, step.mcp.tool, step.mcp.args ?? {}, step.paginate)
      output = JSON.stringify(value)
      await save(`${step.name}.json`, output)
      if (items !== undefined) notes.push(`${items} ${step.paginate!.items}`)
    }

    let warnings: string | undefined
    if (step.format) {
      const r = await exec($, step.format, cwd, step.timeoutMs, output)
      await save(`${step.name}.txt`, r.stdout)
      output = r.stdout
      warnings = r.stderr.trim() || undefined
    }
    if (files.includes(`${step.name}.txt`)) notes.unshift(`${lineCount(output)} lines`)
    return { name: step.name, state: warnings ? 'warn' : 'ok', files, summary: notes.join('; '), warnings }
  } catch (err) {
    return { name: step.name, state: 'failed', files, summary: String(err) }
  }
}

async function exec($: Host, argv: string[], cwd: string, timeoutMs = 600_000, stdin?: string) {
  const [cmd, ...rest] = argv
  // `./script` names a file next to the recipe, not one in the session's cwd
  const bin = cmd!.startsWith('./') ? `${cwd}/${cmd!.slice(2)}` : cmd!
  const r = await $.process.run([bin, ...rest], { cwd, timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
  if (r.exitCode !== 0) throw new Error(`${argv.join(' ')}: exit ${r.exitCode}: ${r.stderr.trim().slice(0, 1000)}`)
  return r
}

// One MCP call, or with `paginate` every page of it, merged into the first
// page's object: the items arrays concatenated and the page token dropped.
async function callAll(
  $: Host,
  server: string,
  tool: string,
  args: Record<string, Json>,
  paginate?: Paginate,
): Promise<{ value: Json; items?: number }> {
  if (!paginate) return { value: await callOnce($, server, tool, args) }
  let first: Record<string, Json> | undefined
  const all: Json[] = []
  let token: string | undefined
  do {
    const page = (await callOnce($, server, tool, token ? { ...args, [paginate.arg]: token } : args)) as Record<
      string,
      Json
    >
    first ??= page
    const items = page[paginate.items]
    if (Array.isArray(items)) all.push(...items)
    token = typeof page[paginate.token] === 'string' ? (page[paginate.token] as string) : undefined
  } while (token && all.length < (paginate.max ?? 1000))
  const { [paginate.token]: _, ...rest } = first!
  return { value: { ...rest, [paginate.items]: all }, items: all.length }
}

async function callOnce($: Host, server: string, tool: string, args: Record<string, Json>): Promise<Json> {
  const r = await $.mcp.call(server, tool, args)
  const block = r.content?.[0]
  const text = block?.type === 'text' ? block.text : undefined
  if (r.isError || text === undefined) throw callError(tool, text ?? JSON.stringify(r))
  try {
    return JSON.parse(text) as Json
  } catch {
    throw callError(tool, `not JSON: ${text}`)
  }
}

// A result over the engine's MCP output limit comes back as an "Error: result
// ... exceeds maximum allowed tokens" text instead of the JSON, for a plugin's
// call as for the model's.
function callError(tool: string, text: string): Error {
  const hint = text.includes('exceeds maximum allowed tokens') ? ' (lower the page size in the recipe)' : ''
  return new Error(`${tool}: ${text.slice(0, 500)}${hint}`)
}

// Every `<recipe>.recipe.json` one level down in the user's and the project's
// skill folders, named `<skill>_<recipe>`; the project's wins a name both have.
async function findRecipes($: Host): Promise<{ name: string; path: string }[]> {
  const r = await $.process.run(['sh', '-c', 'printf "%s\\n%s" "$HOME" "$PWD"'])
  const [home, cwd] = r.stdout.split('\n')
  const found = new Map<string, string>()
  for (const root of [`${home}/.claude/skills`, `${cwd}/.claude/skills`]) {
    for (const skill of await $.fs.list(root).catch(() => [])) {
      for (const file of await $.fs.list(`${root}/${skill.name}`).catch(() => [])) {
        if (!file.name.endsWith(SUFFIX)) continue
        const name = `${skill.name}_${file.name.slice(0, -SUFFIX.length)}`.replace(/[^A-Za-z0-9_-]/g, '_')
        found.set(name, `${root}/${skill.name}/${file.name}`)
      }
    }
  }
  return [...found].map(([name, path]) => ({ name, path }))
}

function toolSpec(recipe: Recipe): { description: string; inputSchema: Record<string, unknown> } {
  const vars = recipe.vars ?? {}
  const steps = recipe.steps.map(s => s.name).join(', ')
  const how = `Runs its steps (${steps}) in the background and returns the run folder at once; call wait with it before reading the files.`
  return {
    description: recipe.description ? `${recipe.description} ${how}` : how,
    inputSchema: {
      type: 'object',
      properties: vars,
      required: Object.keys(vars).filter(k => vars[k]!.default === undefined),
    },
  }
}

// Replaces ${name} placeholders in every string of a step. A string that is
// exactly one placeholder takes the var's own type, so `"pageSize": "${n}"`
// stays a number; argv entries are stringified after.
function fill(value: unknown, vars: Vars, now: Date, missing: Set<string>): unknown {
  if (typeof value === 'string') {
    const lookup = (name: string): string | number => {
      const offset = /^now([+-]\d+)d$/.exec(name)
      if (name === 'now') return now.toISOString()
      if (offset) return new Date(now.getTime() + Number(offset[1]) * 86_400_000).toISOString()
      const v = vars[name]
      if (v === undefined) missing.add(name)
      return v ?? ''
    }
    const whole = /^\$\{([^}]+)\}$/.exec(value)
    if (whole) return lookup(whole[1]!)
    return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => String(lookup(name)))
  }
  if (Array.isArray(value)) return value.map(v => fill(v, vars, now, missing))
  if (value && typeof value === 'object') {
    const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars, now, missing)]))
    for (const key of ['run', 'format'] as const) {
      if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(String)
    }
    return out
  }
  return value
}

function lineCount(s: string): number {
  return s === '' ? 0 : s.replace(/\n$/, '').split('\n').length
}

function firstLine(s: string): string {
  return s.trim().split('\n')[0]?.slice(0, 300) ?? ''
}

function stamp(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => p.find(x => x.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}${get('minute')}${get('second')}`
}
