#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=jj,git,ah,rex

import { Command, ValidationError } from "@cliffy/command"
import $ from "@david/dax"
import { ExitPromptError } from "@inquirer/core"
import input from "@inquirer/input"
import { dim, setColorEnabled, stripAnsiCode } from "@std/fmt/colors"
import { dirname, join } from "@std/path"
import {
  confirmed,
  padEnd,
  pickWithAction,
  terminalColumns,
  textWidth,
  truncateWidth,
} from "./lib/picker.ts"

$.setErrorTail(true)

interface Workspace {
  name: string
  wsPath: string
  /**
   * Short change ID of the workspace's working copy, or its parent if @ is
   * empty and undescribed. Colored like jj's when listed with color.
   */
  rev: string
  /** First line of that commit's description */
  revDesc: string
  /** Whether it's the workspace jj resolved from the cwd */
  current: boolean
}

/**
 * Resolve the default workspace's path by chasing the .jj/repo pointer from
 * the current workspace: it's either a directory (we're in default already)
 * or a text file pointing at default's .jj/repo. Used instead of
 * `jj workspace root --name default`, which errors in repos whose default
 * workspace has no recorded root (created before jj 0.38).
 */
async function defaultRoot(): Promise<string> {
  const cwdRoot = (await $`jj root`.text()).trim()
  const repoLink = join(cwdRoot, ".jj", "repo")
  const stat = await Deno.stat(repoLink)
  if (stat.isDirectory) return cwdRoot
  const rel = (await Deno.readTextFile(repoLink)).trim()
  const resolved = await Deno.realPath(join(cwdRoot, ".jj", rel))
  // resolved is /<default>/.jj/repo; strip /repo and /.jj
  return dirname(dirname(resolved))
}

/**
 * List workspaces in one subprocess call. `self.root()` renders empty for
 * workspaces with no recorded root (moved/deleted dirs, or repos created
 * before jj 0.38 — all local repos were backfilled 2026-08). A workspace's @ is
 * usually a fresh empty commit on top of the real work, so in that case show
 * the parent (the first one, for a merge). With color on, jj colors every
 * field, so all but the rev get stripped.
 */
async function listWorkspaces(color = false): Promise<Workspace[]> {
  const rev = (c: string) =>
    `${c}.change_id().shortest(8) ++ "\t" ++ ${c}.description().first_line()`
  const tmpl =
    `name ++ "\t" ++ self.current_workspace() ++ "\t" ++ self.root() ++ "\t" ++ if(
    target.empty() && !target.description(),
    target.parents().map(|c| ${rev("c")}).join("\t"),
    ${rev("target")},
  ) ++ "\n"`
  const colorArg = color ? "always" : "never"
  return (await $`jj workspace list --color ${colorArg} -T ${tmpl}`.lines())
    .filter((l) => l)
    .map((line) => {
      const [name, current, wsPath, rev, revDesc] = line.split("\t")
      return {
        name: stripAnsiCode(name),
        current: stripAnsiCode(current) === "true",
        wsPath: stripAnsiCode(wsPath),
        rev,
        revDesc: stripAnsiCode(revDesc),
      }
    })
}

interface WorkspaceInfo extends Workspace {
  /** What the agent in the workspace's Rex tab is doing, from ah */
  summary: string
}

async function workspaceInfos(color: boolean): Promise<WorkspaceInfo[]> {
  const workspaces = await listWorkspaces(color)
  const hasTool = !!(await $.which("ah"))
  if (!hasTool) {
    console.error("ah not found in PATH; skipping summaries")
  }
  // What the agent in each workspace's Rex tab is doing, by workspace root
  const summaries: { root: string; summary: string | null }[] = hasTool
    ? await $`ah workspace ls --json`.json()
    : []
  return workspaces.map((ws) => ({
    ...ws,
    summary: summaries.find((w) => w.root === ws.wsPath)?.summary ?? "",
  }))
}

const COLUMN_GAP = 2
/** Width of the picker's "❯ " in front of each row */
const PICKER_PREFIX = 2

/**
 * One line per workspace: a star on the current one, name, rev, description,
 * and ah summary, with the last two cut to fit `columns`.
 */
function formatRows(infos: WorkspaceInfo[], columns: number): string[] {
  const maxWidth = (cells: string[]) => Math.max(0, ...cells.map(textWidth))
  const descs = infos.map((i) => i.revDesc || "(no description set)")
  const nameWidth = maxWidth(infos.map((i) => i.name))
  const revWidth = maxWidth(infos.map((i) => i.rev))
  const descMax = maxWidth(descs)
  const summaryMax = maxWidth(infos.map((i) => i.summary))

  // the star is 2 cells wide, then a space
  const fixed = 3 + nameWidth + COLUMN_GAP + revWidth + COLUMN_GAP
  const rest = Math.max(10, columns - PICKER_PREFIX - fixed)
  // The description gets what the summaries leave, but at least half
  const descWidth = Math.min(
    descMax,
    summaryMax ? Math.max(Math.ceil(rest / 2), rest - COLUMN_GAP - summaryMax) : rest,
  )
  const summaryWidth = rest - descWidth - COLUMN_GAP

  return infos.map((info, i) => {
    const desc = truncateWidth(descs[i], descWidth)
    const cells = [
      info.current ? "⭐" : "  ",
      padEnd(info.name, nameWidth),
      padEnd(info.rev, revWidth),
      padEnd(info.revDesc ? desc : dim(desc), descWidth),
      info.summary && dim(truncateWidth(info.summary, summaryWidth)),
    ]
    const line = cells[0] + " " + cells.slice(1).join(" ".repeat(COLUMN_GAP))
    return line.trimEnd()
  })
}

/** Symlink src into the workspace if it exists and is gitignored. */
async function symlinkIfIgnored(
  repoRoot: string,
  wspath: string,
  relPath: string,
) {
  const src = join(repoRoot, relPath)
  if (!(await Deno.stat(src).catch(() => null))) return
  const ignored = await $`git check-ignore -q ${relPath}`
    .cwd(repoRoot).noThrow().quiet()
  if (ignored.code !== 0) return
  const dest = join(wspath, relPath)
  await Deno.mkdir(dirname(dest), { recursive: true })
  await Deno.symlink(src, dest)
}

/**
 * Create a workspace at ~/jj-workspaces/<repo>-<name>, or the next free
 * number without a name, and return its path.
 */
async function createWorkspace(name?: string): Promise<string> {
  // use the default workspace, not the current one — creating from inside an
  // existing workspace should still name and link relative to the main checkout
  const defaultPath = await defaultRoot()
  const repoName = defaultPath.split("/").at(-1)!

  const baseDir = join(Deno.env.get("HOME")!, "jj-workspaces")
  await Deno.mkdir(baseDir, { recursive: true })
  const exists = (n: string | number) =>
    Deno.stat(join(baseDir, `${repoName}-${n}`)).then(() => true, () => false)

  let suffix: string | number = 1
  if (name) {
    if (name.includes("/")) throw new ValidationError(`Name can't contain /: ${name}`)
    if (await exists(name)) {
      throw new ValidationError(`${repoName}-${name} already exists`)
    }
    suffix = name
  } else {
    while (await exists(suffix)) suffix++
  }
  const wspath = join(baseDir, `${repoName}-${suffix}`)

  // capture jj output and echo to stderr so only the path goes to stdout
  const jjOut = await $`jj workspace add ${wspath}`.text()
  if (jjOut.trim()) console.error(jjOut)

  await symlinkIfIgnored(defaultPath, wspath, join(".claude", "settings.local.json"))
  await symlinkIfIgnored(defaultPath, wspath, join(".claude", "notes"))
  await symlinkIfIgnored(defaultPath, wspath, ".helix")
  await symlinkIfIgnored(defaultPath, wspath, "CLAUDE.local.md")
  return wspath
}

/**
 * Remove the workspaces and their directories, asking first if `confirm` is set.
 * Returns whether it did.
 */
async function removeWorkspaces(selected: Workspace[], confirm: boolean): Promise<boolean> {
  for (const { name, current } of selected) {
    if (name === "default") throw new ValidationError("Can't remove the default workspace")
    if (current) {
      throw new ValidationError(`Can't remove ${name}: the shell is inside it`)
    }
  }
  const paths = selected.map((w) => w.wsPath).join(", ")
  if (confirm && !(await confirmed(`Delete ${paths}?`))) return false

  for (const { name } of selected) {
    // snapshots the working copy, forgets the workspace (and its Git
    // worktree, if colocated), and deletes the directory
    await $`jj workspace remove ${name}`.printCommand()
  }
  return true
}

/**
 * Hand the shell wrapper (jjw in .zprofile) a directory to cd into. The
 * wrapper reads it from the fd in JJW_CD_FD so stdout can stay on the
 * terminal. Without the wrapper, e.g. from the Claude worktree hook, print it.
 */
function cdTo(path: string) {
  const fd = Deno.env.get("JJW_CD_FD")
  if (fd) Deno.writeTextFileSync(`/dev/fd/${fd}`, path)
  else console.log(path)
}

/** Ctrl+C in a prompt exits like it would anywhere else */
async function exitOnCancel<T>(prompt: Promise<T>): Promise<T> {
  try {
    return await prompt
  } catch (e) {
    if (e instanceof ExitPromptError) Deno.exit(130)
    throw e
  }
}

/** Open a Rex tab in `dir` right after this one and focus it */
async function openRexTab(dir: string) {
  const session = Deno.env.get("REX_SESSION")
  const block = Deno.env.get("REX_BLOCK")
  if (!session || !block) throw new ValidationError("Not in a Rex terminal")
  const here = await $`rex block inspect -s ${session} ${block} --json`.json()
  const created = await $`rex window new -s ${session} -c ${dir} --json`.json()
  await $`rex window move -s ${session} ${created.window_id} --after ${here.block.window_id}`
  // `rex window focus` only changes the server's active tab, so ask the app to
  // show it. Without -C, Rex picks the app if exactly one is connected. `do`
  // is quoted because dax parses the command as shell, where it's a keyword.
  await $`rex 'do' session.select session_id=${session} window_id=${created.window_id}`
}

/** Workspace list where Enter cds and letter keys do the rest */
async function picker() {
  let initialIndex: number | undefined
  while (true) {
    const infos = await workspaceInfos(true)
    const current = infos.findIndex((i) => i.current)
    const picked = await pickWithAction({
      message: "Workspaces",
      options: formatRows(infos, terminalColumns()),
      initialIndex: Math.min(initialIndex ?? Math.max(0, current), infos.length - 1),
      enter: "cd",
      keys: { n: "new", o: "open", l: "log", d: "remove" },
      hints: [
        ["enter", "cd"],
        ["n", "new"],
        ["o", "open in new tab"],
        ["l", "log"],
        ["d", "remove"],
        ["q", "quit"],
      ],
    })
    if (!picked) return
    const ws = infos[picked.index]

    switch (picked.action) {
      case "cd":
        return cdTo(ws.wsPath)
      case "new": {
        const name = await exitOnCancel(input({ message: "Name (empty for next number)" }))
        return cdTo(await createWorkspace(name.trim() || undefined))
      }
      case "open":
        return await openRexTab(ws.wsPath)
      case "log":
        await $`jj log`.cwd(ws.wsPath)
        return
      case "remove":
        try {
          // a keypress in a list is easy to hit by accident
          await removeWorkspaces([ws], true)
        } catch (e) {
          if (!(e instanceof ValidationError)) throw e
          console.error(e.message)
        }
        initialIndex = picked.index
    }
  }
}

const createCmd = new Command()
  .description(
    "Create a new jj workspace at ~/jj-workspaces/<repo>-<name> and cd into it. " +
      "Without a name, uses the next free number.",
  )
  .arguments("[name:string]")
  .action(async (_opts, name?: string) => cdTo(await createWorkspace(name)))

const rmCmd = new Command()
  .description("Remove jj workspaces")
  .arguments("<names...:string>")
  .action(async (_opts, ...names: string[]) => {
    const workspaces = await listWorkspaces()
    const selected = names.map((name) => {
      const ws = workspaces.find((w) => w.name === name)
      if (!ws) throw new ValidationError(`No workspace named ${name}`)
      return ws
    })
    // naming the workspaces is confirmation enough, and `jj workspace remove`
    // snapshots the working copy first, so only ignored files are lost
    await removeWorkspaces(selected, false)
  })

const lsCmd = new Command()
  .description("List jj workspaces")
  .action(async () => {
    const tty = Deno.stdout.isTerminal()
    const color = tty && !Deno.noColor
    setColorEnabled(color)
    const infos = await workspaceInfos(color)
    const columns = tty ? terminalColumns() : Infinity
    for (const line of formatRows(infos, columns)) console.log(line)
  })

await new Command()
  .name("jjw")
  .description("Manage jj workspaces. Without a subcommand, pick one from a list.")
  .action(picker)
  .command("create", createCmd).alias("c")
  .command("rm", rmCmd)
  .command("ls", lsCmd)
  .command("cd", "Same as jjw with no subcommand").action(picker)
  .parse()
