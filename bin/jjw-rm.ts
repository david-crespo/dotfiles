#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj,rm

import $ from "@david/dax"

const names = (await $`jj workspace list -T 'name ++ "\n"'`.lines())
  .filter((n) => n && n !== "default")

if (names.length === 0) {
  console.error("No non-default workspaces found.")
  Deno.exit(0)
}

const i = await $.select({ message: "Remove workspace", options: names })
const name = names[i]

const wsPath = (await $`jj workspace root --name ${name}`.text()).trim()

const ok = await $.confirm({ message: `Delete ${wsPath}?`, default: false })
if (!ok) Deno.exit(0)

await Deno.permissions.request({ name: "write", path: wsPath })
await $`jj workspace forget ${name}`.printCommand()
await $`rm -rf ${wsPath}`.printCommand()
