#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=jj,rm,git,ghostty-tab-title

import { Command, ValidationError } from "@cliffy/command"
import $ from "@david/dax"
import { dirname, join } from "@std/path"

interface Workspace {
  name: string
  wsPath: string
}

/**
 * Resolve the default workspace's path. `jj workspace root --name default`
 * errors with "Workspace has no recorded path", so we chase the .jj/repo
 * pointer from the current workspace: it's either a directory (we're in
 * default already) or a text file pointing at default's .jj/repo.
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
 * List workspaces (name + path) in one subprocess call. `self.root()` errors
 * for the default workspace, so the template skips it and we substitute the
 * default's path resolved via .jj/repo.
 */
async function listWorkspaces(): Promise<Workspace[]> {
  const tmpl = 'name ++ "\t" ++ if(name == "default", "", self.root()) ++ "\n"'
  const [lines, defaultPath] = await Promise.all([
    $`jj workspace list -T ${tmpl}`.lines(),
    defaultRoot(),
  ])
  return lines.filter((l) => l).map((line) => {
    const [name, path] = line.split("\t")
    return { name, wsPath: name === "default" ? defaultPath : path }
  })
}

interface WorkspaceInfo {
  name: string
  wsPath: string
  description: string
  current: boolean
}

async function workspaceInfos(workspaces: Workspace[]): Promise<WorkspaceInfo[]> {
  const cwd = Deno.cwd()
  const hasTool = !!(await $.which("ghostty-tab-title"))
  if (!hasTool) {
    console.error("ghostty-tab-title not found in PATH; skipping descriptions")
  }
  return await Promise.all(workspaces.map(async ({ name, wsPath }) => ({
    name,
    wsPath,
    description: hasTool
      ? (await $`ghostty-tab-title description ${wsPath}`.text()).trim()
      : "",
    current: cwd === wsPath || cwd.startsWith(wsPath + "/"),
  })))
}

function formatOptions(infos: WorkspaceInfo[]): string[] {
  const maxName = Math.max(...infos.map((i) => i.name.length))
  return infos.map((info) => {
    // ⭐ is two cells wide in most terminal fonts, so non-current entries pad
    // with three spaces to stay column-aligned with "⭐ ".
    const prefix = info.current ? "⭐ " : "   "
    const paddedName = info.name.padEnd(maxName)
    const desc = info.description ? ` — ${info.description}` : ""
    return `${prefix}${paddedName}${desc}`
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

const createCmd = new Command()
  .description("Create a new jj workspace and print its path")
  .action(async () => {
    // use the default workspace, not the current one — running `jjw c` from
    // inside an existing workspace should still name and link relative to the
    // main checkout
    const defaultPath = await defaultRoot()
    const repoName = defaultPath.split("/").at(-1)!

    const baseDir = join(Deno.env.get("HOME")!, "jj-workspaces")
    await Deno.mkdir(baseDir, { recursive: true })

    let i = 1
    while (
      await Deno.stat(join(baseDir, `${repoName}-${i}`)).catch(() => null)
    ) {
      i++
    }
    const wspath = join(baseDir, `${repoName}-${i}`)

    // capture jj output and echo to stderr so only the path goes to stdout
    const jjOut = await $`jj workspace add ${wspath}`.text()
    if (jjOut.trim()) console.error(jjOut)

    await symlinkIfIgnored(defaultPath, wspath, join(".claude", "settings.local.json"))
    await symlinkIfIgnored(defaultPath, wspath, join(".claude", "notes"))
    await symlinkIfIgnored(defaultPath, wspath, ".helix")

    // only output: the path for the shell wrapper to cd into
    console.log(wspath)
  })

const rmCmd = new Command()
  .description("Remove a jj workspace")
  .action(async () => {
    const workspaces = (await listWorkspaces()).filter((w) => w.name !== "default")
    if (workspaces.length === 0) {
      console.error("No non-default workspaces found.")
      Deno.exit(0)
    }
    const i = await $.select({
      message: "Remove workspace",
      options: workspaces.map((w) => w.name),
    })
    const { name, wsPath } = workspaces[i]

    const cwd = Deno.cwd()
    if (cwd === wsPath || cwd.startsWith(wsPath + "/")) {
      console.error(`Refusing to delete ${wsPath}: cwd is inside it. cd out first.`)
      Deno.exit(1)
    }

    const ok = await $.confirm({ message: `Delete ${wsPath}?`, default: false })
    if (!ok) Deno.exit(0)

    // snapshot the target's working copy so any un-snapshotted edits land as
    // commits in the repo before we forget the workspace and delete its files
    await $`jj util snapshot`.cwd(wsPath).printCommand()
    await $`jj workspace forget ${name}`.printCommand()
    await $`rm -rf ${wsPath}`.printCommand()
  })

const cdCmd = new Command()
  .description("Pick a jj workspace and print its path")
  .action(async () => {
    const infos = await workspaceInfos(await listWorkspaces())
    const i = await $.select({
      message: "cd to workspace",
      options: formatOptions(infos),
    })
    console.log(infos[i].wsPath)
  })

const lsCmd = new Command()
  .description("List jj workspaces")
  .action(async () => {
    const infos = await workspaceInfos(await listWorkspaces())
    for (const line of formatOptions(infos)) {
      console.log(line)
    }
  })

await new Command()
  .name("jjw")
  .description("Manage jj workspaces")
  .action(() => {
    throw new ValidationError("Subcommand required")
  })
  .command("create", createCmd).alias("c")
  .command("rm", rmCmd)
  .command("ls", lsCmd)
  .command("cd", cdCmd)
  .parse()
