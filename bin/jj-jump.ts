#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=jj

import { Command } from "@cliffy/command"
import $ from "@david/dax"

interface JumpOp { id: string; type: "new" | "edit" }

/** Op IDs for new/edit operations (intentional working-copy hops). */
async function jumpOps(): Promise<JumpOp[]> {
  const filter =
    'if(description.starts_with("new "), "new " ++ self.id().short(12) ++ "\\n", ' +
    'if(description.starts_with("edit "), "edit " ++ self.id().short(12) ++ "\\n", ""))'
  return (await $`jj op log --no-graph --limit 200 -T ${filter}`.lines())
    .filter((x) => x)
    .map((line) => {
      const [type, id] = line.split(" ")
      return { id, type: type as "new" | "edit" }
    })
}

/** The change ID the user was working on at a given op. */
async function cidAtOp(op: JumpOp) {
  const resolve = (rev: string) =>
    $`jj log --at-op ${op.id} --ignore-working-copy --no-graph -r ${rev} -T ${"change_id.short(8)"}`
      .noThrow().text().then((c) => c.trim())
  if (op.type === "edit") return await resolve("@")
  // `new` creates an ephemeral wc commit that's usually abandoned.
  // Use it if it survived (had changes), otherwise fall back to @-.
  const at = await resolve("@")
  if (at && await changeExists(at)) return at
  return await resolve("@-")
}

/** Whether a change ID still exists in the repo. */
async function changeExists(cid: string) {
  return (await $`jj log --no-graph -r ${`present(${cid})`} -T ${'"x"'}`.noThrow().text())
    .trim() !== ""
}

// Yield distinct consecutive @ change IDs from the op log
async function* distinctCids() {
  let prev = ""
  for (const op of await jumpOps()) {
    const cid = await cidAtOp(op)
    if (cid && cid !== prev) {
      prev = cid
      yield cid
    }
  }
}

await new Command()
  .name("jj-jump")
  .description("Jump back to the Nth previous working-copy position")
  .arguments("[n:integer]")
  .action(async (_options, n = 1) => {
    const cids = distinctCids()
    await cids.next() // skip current @

    let found = 0
    for await (const cid of cids) {
      if (!await changeExists(cid)) continue
      found += 1
      if (found < n) continue
      await $`jj log -r ${cid}`.printCommand()
      const ok = await $.confirm({ message: `Jump?`, default: true, noClear: true })
      if (ok) await $`jj new ${cid}`
      Deno.exit(0)
    }

    console.error(`No position ${n} step(s) back.`)
    Deno.exit(1)
  })
  .parse(Deno.args)
