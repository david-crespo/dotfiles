#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run=jj,rm

import { Command, ValidationError } from "@cliffy/command"
import $ from "@david/dax"
import { join } from "@std/path"

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

    // symlink claude local settings if present (not versioned)
    const localSettings = join(repoRoot, ".claude", "settings.local.json")
    if (await Deno.stat(localSettings).catch(() => null)) {
      const destDir = join(wspath, ".claude")
      await Deno.mkdir(destDir, { recursive: true })
      await Deno.symlink(
        localSettings,
        join(destDir, "settings.local.json"),
      )
    }

    // only output: the path for the shell wrapper to cd into
    console.log(wspath)
  })

const rmCmd = new Command()
  .description("Remove a jj workspace")
  .action(async () => {
    const names = (await $`jj workspace list -T 'name ++ "\n"'`.lines())
      .filter((n) => n && n !== "default")

    if (names.length === 0) {
      console.error("No non-default workspaces found.")
      Deno.exit(0)
    }

    const i = await $.select({ message: "Remove workspace", options: names })
    const name = names[i]

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
