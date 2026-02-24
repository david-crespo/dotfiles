#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=jj,rm,git

import { Command, ValidationError } from "@cliffy/command"
import $ from "@david/dax"
import { join } from "@std/path"

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
  await Deno.mkdir(dest.substring(0, dest.lastIndexOf("/")), {
    recursive: true,
  })
  await Deno.symlink(src, dest)
}

const createCmd = new Command()
  .description("Create a new jj workspace and print its path")
  .action(async () => {
    const repoRoot = (await $`jj root`.text()).trim()
    const repoName = repoRoot.split("/").at(-1)!

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

    await symlinkIfIgnored(repoRoot, wspath, join(".claude", "settings.local.json"))
    await symlinkIfIgnored(repoRoot, wspath, ".helix")

    // only output: the path for the shell wrapper to cd into
    console.log(wspath)
  })

const rmCmd = new Command()
  .description("Remove a jj workspace")
  .arguments("[name:string]")
  .action(async (_options: void, nameArg?: string) => {
    const names = (await $`jj workspace list -T 'name ++ "\n"'`.lines())
      .filter((n) => n && n !== "default")

    if (names.length === 0) {
      console.error("No non-default workspaces found.")
      Deno.exit(0)
    }

    let name: string
    if (nameArg) {
      if (!names.includes(nameArg)) {
        console.error(`Unknown workspace: ${nameArg}`)
        console.error(`Known workspaces: ${names.join(", ")}`)
        Deno.exit(1)
      }
      name = nameArg
    } else {
      const i = await $.select({ message: "Remove workspace", options: names })
      name = names[i]
    }

    const wsPath = (await $`jj workspace root --name ${name}`.text()).trim()

    const ok = await $.confirm({
      message: `Delete ${wsPath}?`,
      default: false,
    })
    if (!ok) Deno.exit(0)

    const perm = await Deno.permissions.request({
      name: "write",
      path: wsPath,
    })
    if (perm.state === "granted") {
      await $`jj workspace forget ${name}`.printCommand()
      await $`rm -rf ${wsPath}`.printCommand()
    }
  })

const lsCmd = new Command()
  .description("List jj workspaces")
  .action(async () => {
    const names = (await $`jj workspace list -T 'name ++ "\n"'`.lines())
      .filter((n) => n && n !== "default")

    if (names.length === 0) {
      console.error("No non-default workspaces found.")
      return
    }

    for (const name of names) {
      const wsPath = (await $`jj workspace root --name ${name}`.text()).trim()
      console.log(`${name}\t${wsPath}`)
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
  .parse()
