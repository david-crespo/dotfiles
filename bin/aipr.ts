#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=gh,ai,fzf --allow-net=api.github.com

import $ from "jsr:@david/dax@0.43.0"
import { readAll } from "jsr:@std/io@0.225.2"
import { Command, ValidationError } from "jsr:@cliffy/command@1.0.0-rc.7"

const today = new Date().toISOString().slice(0, 10)
const reviewSystemPrompt =
  `You are an experienced software engineer reviewing a code change. You will
get a diff and possibly a written PR description and linked issues, and possibly
more files for context.

Review the change for correctness, convention-following, elegance, and good user
experience. Also consider whether the PR description adequately explains the
goals of the code change and whether the code is the best way of achieving those
goals. Have high standards and be a serious critic, but avoid nitpicks or call
them out as such. Remember that because you are only seeing a diff, you are not
seeing all the context that might be required. An import or variable definition
that is not in the diff may already have been in the file before this change.

Do not reproduce the diff except in small parts in order to comment on a
few lines. Do not reproduce large chunks of the diff. Write your response in
GitHub markdown with headings, paragraphs, backticks for code, etc. Focus on
substantive suggestions that improve correctness or clarity. Do NOT go through
the change piece by piece and describe what the PR does in detail unless it is
needed to explain a suggestion. Do not bother praising the change as necessary
or important or good.

The length of the review should be proportionate to the length and complexity
of the change. A short and simple change might require very little commentary,
especially if it's easy to tell whether it's working as intended. Even a long
change might not need much review if it is very straightforward.

Today's date is ${today}. If given a repo and PR number, include a header
at the top of your response like '## Review of [reponame#1234: PR Title
Here](https://github.com/owner/reponame/pull/1234)'.`

const linkedIssuesGraphql = `
  query($owner: String!, $repo: String!, $pr_number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr_number) {
        closingIssuesReferences(first: 50) {
          nodes { repository { name }, number, title, body }
        }
      }
    }
  }
 `

const reviewsGraphql = `
  query($owner: String!, $repo: String!, $pr_number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr_number) {
        reviews(first: 100) {
          nodes {
            comments(first: 100) {
              nodes {
                body
                outdated
                path
                line
                originalLine
                diffHunk
                commit { oid }
                author { login }
                createdAt
              }
            }
          }
        }
      }
    }
  }
`

const cb = (s: string, lang = "") => `\`\`\`${lang}\n${s}\n\`\`\``

/** Stick `s` under a section heading if truthy*/
const mdSection = (label: string) => (s: string | undefined) =>
  s ? `# ${label}\n\n${s}` : undefined

type RepoSel = { owner: string; repo: string }
type PrSel = RepoSel & { pr: number }
type LinkedIssue = {
  repository: { name: string }
  number: number
  title: string
  body: string
}
type LinkedIssues = {
  data: {
    repository: { pullRequest: { closingIssuesReferences: { nodes: LinkedIssue[] } } }
  }
}
type Actor = { login: string }
type Commit = { oid: string }
type Comment = {
  body: string
  author: Actor
  outdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  diffHunk: string
  createdAt: string
  commit: Commit
}
type Review = {
  author: Actor
  state: string
  submittedAt: string
  comments: { nodes: Comment[] }
}
type Reviews = {
  data: {
    repository: { pullRequest: { reviews: { nodes: Review[] } } }
  }
}

const getPrArgs = (sel: PrSel) => ["-R", `${sel.owner}/${sel.repo}`, sel.pr]

/** Filter out gigantic useless lockfiles from diff */
function filterDiff(rawDiff: string): string {
  const lines = rawDiff.split("\n")
  const filesToExclude = ["/package-lock.json", "/Cargo.lock", "/bun.lock", "/deno.lock"]

  const filteredLines = []
  let skipUntilNextDiff = false

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      skipUntilNextDiff = filesToExclude.some((filename) => line.includes(filename))
    }

    // filtering out super log lines is meant to avoid context bloat due to,
    // e.g., proptest regressions files
    if (!skipUntilNextDiff && line.length < 500) filteredLines.push(line)
  }

  return cb(filteredLines.join("\n"), "diff")
}

const graphql = <T>(sel: PrSel, query: string) =>
  $`gh api graphql -f owner=${sel.owner} -f repo=${sel.repo} -F pr_number=${sel.pr} -f query=${query}`
    .json<T>()

const getLinkedIssues = (sel: PrSel) =>
  graphql<LinkedIssues>(sel, linkedIssuesGraphql).then((raw) => {
    const linkedIssues = raw.data.repository.pullRequest.closingIssuesReferences.nodes
    return linkedIssues.map((i) =>
      `## ${i.title} (${i.repository.name}#${i.number})\n\n${i.body}`
    ).join("\n\n")
  })

const fetchComments = (sel: PrSel) =>
  graphql<Reviews>(sel, reviewsGraphql).then((raw) =>
    raw.data.repository.pullRequest.reviews.nodes.flatMap((r) =>
      r.comments.nodes.map((c) =>
        [
          `## ${c.author.login} (${c.createdAt}${c.outdated ? ", outdated" : ""})`,
          `**Path**: ${c.path}`,
          `**Line**: ${c.line || c.originalLine}`,
          `**Commit**: ${c.commit.oid}`,
          cb(c.diffHunk.split("\n").slice(-4).join("\n"), "diff"),
          c.body,
        ].join("\n\n")
      )
    ).join("\n\n")
  )

const getPrContext = (sel: PrSel, includeComments: boolean) =>
  Promise.all([
    $`gh pr view ${getPrArgs(sel)}`.text().then(mdSection("Body")),
    getLinkedIssues(sel).then(mdSection("Linked issues")),
    $`gh pr diff ${getPrArgs(sel)}`.text().then(filterDiff).then(mdSection("Diff")),
    includeComments
      ? fetchComments(sel).then(mdSection("Comments"))
      : Promise.resolve(undefined),
  ]).then((results) => results.filter((x) => !!x).join("\n\n"))

const pickPr = ({ owner, repo }: RepoSel) =>
  $`gh pr list -R ${owner}/${repo} --limit 100 --json number,title,updatedAt,author --template \
    '{{range .}}{{tablerow .number .title .author.name (timeago .updatedAt)}}{{end}}' |
    fzf --height 25% --reverse --accept-nth=1`.json<number>()

function parseRepoSelector(repoStr: string): RepoSel {
  const parts = repoStr.split("/")
  if (parts.length === 1) {
    return { owner: "oxidecomputer", repo: parts[0] }
  } else if (parts.length === 2) {
    const [owner, repo] = parts
    return { owner, repo }
  }

  throw new ValidationError(
    `Bad repo selector '${repoStr}'. Must look like 'oxidecomputer/console' or 'console'.`,
  )
}

async function getCurrRepo(): Promise<RepoSel> {
  type Resp = { owner: { login: string }; name: string }
  const { name, owner } = await $`gh repo view --json name,owner`.json<Resp>()
  return { repo: name, owner: owner.login }
}

async function getPrSelector(repoStr: string | undefined, prArg: number | undefined) {
  // if the repo is not given, try to figure it out from the dir
  const { owner, repo } = repoStr ? parseRepoSelector(repoStr) : await getCurrRepo()
  await $`gh repo view ${owner}/${repo}`.text() // blow up early if repo doesn't exist
  const pr = prArg ? prArg : await pickPr({ owner, repo })
  if (!prArg) {
    console.log(`Reviewing PR #${pr} (https://github.com/${owner}/${repo}/pull/${pr})\n`)
  }
  return { owner, repo, pr }
}

async function getStdin() {
  if (Deno.stdin.isTerminal()) return undefined
  return new TextDecoder().decode(await readAll(Deno.stdin)).trim() || undefined
}

async function aiReview(model: string | undefined, inputs: (string | undefined)[]) {
  const args = ["--system", reviewSystemPrompt]
  if (model) {
    args.push("-m", model)
  } else {
    args.push("-m", "sonnet", "-t", "think-high")
  }
  const prompt = inputs.filter((x) => x).join("\n\n")
  await $`ai ${args}`.stdinText(prompt)
}

const reviewCmd = new Command()
  .description("Review a PR")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .option("-p,--prompt <prompt:string>", "Additional instructions", { default: "" })
  .option("-m,--model <model:string>", "Model (passed to ai command)")
  .option("-d, --dry-run", "Print PR context to stdout without calling LLM")
  .option("-c, --comments", "Include existing PR comments in review context", {
    default: false,
  })
  .arguments("[pr:integer]")
  .action(async (opts, pr) => {
    const prSel = await getPrSelector(opts.repo, pr)
    const prContext = await getPrContext(prSel, opts.comments)
    if (opts.dryRun) {
      console.log(prContext)
      return
    }
    const stdin = mdSection("Additional context")(await getStdin())
    await aiReview(opts.model, [prContext, stdin, opts.prompt])
  })

// in review, stdin is just for additional context, but in local, it's the whole thing

const localCmd = new Command()
  .description("Review code from stdin instead of a PR")
  .option("-p,--prompt <prompt:string>", "Additional instructions", { default: "" })
  .option("-m,--model <model:string>", "Model (passed to ai command)")
  .action(async (opts) => {
    const stdin = await getStdin()
    if (!stdin) throw new ValidationError("Input through stdin is required")
    await aiReview(opts.model, [stdin, opts.prompt])
  })

// TODO: repomap view and regen and clear
// TODO: make -R and PR number global options and define the commands inline here so the types are right

await new Command()
  .name("aipr")
  .description("Review PRs and debug CI failures.")
  .helpOption("-h, --help", "Show help")
  .action(() => {
    throw new ValidationError("Subcommand required")
  })
  .command("review", reviewCmd)
  .command("local", localCmd)
  .parse()
