#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=gh

// Unsubscribe from GitHub issue/PR notification threads. The only write this
// wrapper can perform is the `updateSubscription` GraphQL mutation with state
// UNSUBSCRIBED or IGNORED — it cannot subscribe, comment, or touch anything
// else, so it is safe to allowlist (same idea as gh-api-read).
//
// Usage: gh-unsub [--state IGNORED] [--check] owner/repo#123 [owner/repo#456 ...]
//
// Reads current viewerSubscription state first and only mutates threads that
// are still SUBSCRIBED (or have no recorded state). The state read works with
// `repo` scope, but the mutation requires the `notifications` scope; refresh
// with `gh auth refresh -h github.com -s notifications` if it fails on scopes.

import { Command, EnumType, ValidationError } from "@cliffy/command"
import $ from "@david/dax"

const REF_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/

type Ref = { owner: string; repo: string; number: number; alias: string }

function parseRefs(args: string[]): Ref[] {
  return args.map((arg, i) => {
    const m = arg.match(REF_RE)
    if (!m) {
      throw new ValidationError(`invalid ref '${arg}' (expected owner/repo#number)`)
    }
    return { owner: m[1], repo: m[2], number: Number(m[3]), alias: `t${i}` }
  })
}

async function graphql(doc: string): Promise<Record<string, unknown>> {
  const result = await $`gh api graphql -f ${`query=${doc}`}`
    .env("GH_HOST", "github.com")
    .stdout("piped")
  return JSON.parse(result.stdout).data
}

await new Command()
  .name("gh-unsub")
  .description("Unsubscribe from GitHub issue/PR notification threads.")
  .type("state", new EnumType(["UNSUBSCRIBED", "IGNORED"]))
  .option("--state <state:state>", "Target subscription state", {
    default: "UNSUBSCRIBED" as const,
  })
  .option("--check", "Only print current subscription state; do not mutate")
  .arguments("<...refs:string>")
  .action(async (opts, ...args) => {
    const refs = parseRefs(args)

    const lookup = refs.map((r) =>
      `${r.alias}: repository(owner: "${r.owner}", name: "${r.repo}") {
        issueOrPullRequest(number: ${r.number}) {
          ... on Issue { id viewerSubscription }
          ... on PullRequest { id viewerSubscription }
        }
      }`
    ).join("\n")
    const data = await graphql(`query {\n${lookup}\n}`) as Record<
      string,
      { issueOrPullRequest: { id: string; viewerSubscription: string | null } | null }
    >

    const toMutate: Ref[] = []
    for (const ref of refs) {
      const node = data[ref.alias]?.issueOrPullRequest
      const refName = `${ref.owner}/${ref.repo}#${ref.number}`
      if (!node) {
        console.error(`${refName}: not found`)
        continue
      }
      const state = node.viewerSubscription ?? "(none)"
      if (opts.check || state === "UNSUBSCRIBED" || state === "IGNORED") {
        console.log(`${refName}: ${state}`)
      } else {
        toMutate.push(ref)
      }
    }
    if (opts.check || toMutate.length === 0) return

    const mutation = toMutate.map((r) => {
      const id = data[r.alias].issueOrPullRequest!.id
      return `${r.alias}: updateSubscription(input: {subscribableId: "${id}", state: ${opts.state}}) {
        subscribable { viewerSubscription }
      }`
    }).join("\n")
    const result = await graphql(`mutation {\n${mutation}\n}`) as Record<
      string,
      { subscribable: { viewerSubscription: string } }
    >
    for (const ref of toMutate) {
      const state = result[ref.alias]?.subscribable?.viewerSubscription ?? "ERROR"
      console.log(`${ref.owner}/${ref.repo}#${ref.number}: ${state}`)
    }
  })
  .parse()
