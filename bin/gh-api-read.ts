#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=gh

// Read-only gh api wrapper. Rejects flags that imply write operations.
// Only flags declared below are allowed; everything else (--method, -f,
// --field, --raw-field, --input, --hostname, etc.) is rejected by cliffy.
//
// The `graphql` endpoint is supported for read-only queries by rejecting
// GraphQL documents that start with a `mutation` operation.
//
// This wrapper intentionally does not support selecting an `operationName`.
// That keeps the validation simple and avoids mixed-operation documents.
//
// Also intentionally does not support reading GraphQL from a file; use stdin
// redirection instead (e.g. `gh-api-read graphql < query.graphql`).

import { Command, ValidationError } from "@cliffy/command"
import { readAll } from "@std/io"
import $ from "@david/dax"

async function readStdinText(): Promise<string> {
  return new TextDecoder().decode(await readAll(Deno.stdin)).trim()
}

function ensureGraphqlReadOnly(doc: string) {
  // Restrictive by design: no leading comments, and reject any document that
  // mentions mutation/subscription anywhere.
  const s = doc.trimStart()

  if (/\bmutation\b/i.test(s)) {
    throw new ValidationError("GraphQL mutations are not allowed")
  }

  if (/\bsubscription\b/i.test(s)) {
    throw new ValidationError("GraphQL subscriptions are not allowed")
  }

  if (/^(query\b|\{)/i.test(s)) return
  throw new ValidationError("graphql only supports queries starting with `query` or `{`")
}

await new Command()
  .name("gh-api-read")
  .description(
    "Read-only gh api wrapper. Rejects flags that imply write operations.",
  )
  .arguments("<endpoint:string>")
  .option("-q, --jq <expr:string>", "jq expression")
  .option("-t, --template <tpl:string>", "Go template")
  .option("--cache <ttl:string>", "Cache TTL")
  .option("--paginate", "Paginate results")
  .option("--slurp", "Slurp paginated results")
  .option(
    "--graphql-query <query:string>",
    "GraphQL query (if endpoint is graphql)",
  )
  .action(async (opts, endpoint) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) {
      throw new ValidationError("absolute URL endpoints are not allowed")
    }
    const endpointName = endpoint.replace(/^\/+/, "").split("?")[0]
      .toLowerCase()
    if (endpointName === "graphql") {
      const query = opts.graphqlQuery ??
        (Deno.stdin.isTerminal() ? "" : await readStdinText())

      if (!query) {
        throw new ValidationError(
          "graphql requires --graphql-query or query on stdin",
        )
      }
      ensureGraphqlReadOnly(query)

      const args: string[] = ["api", "graphql"]
      if (opts.jq) args.push("--jq", opts.jq)
      if (opts.template) args.push("--template", opts.template)
      if (opts.cache) args.push("--cache", opts.cache)
      if (opts.paginate) args.push("--paginate")
      if (opts.slurp) args.push("--slurp")
      args.push("-f", `query=${query}`)

      const result = await $`gh ${args}`
        .env("GH_HOST", "github.com")
        .stdout("inherit")
        .stderr("inherit")
        .noThrow()
      Deno.exit(result.code)
    }
    if (opts.graphqlQuery) {
      throw new ValidationError(
        "--graphql-* options are only valid with the graphql endpoint",
      )
    }
    const result = await $`gh api ${Deno.args}`
      .env("GH_HOST", "github.com")
      .noThrow()
    Deno.exit(result.code)
  })
  .parse()
