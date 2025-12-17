#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=gh,ai,fzf --allow-net=api.github.com

import $ from "jsr:@david/dax@0.43.0"
import { readAll } from "jsr:@std/io@0.225.2"
import { Command, ValidationError } from "jsr:@cliffy/command@1.0.0-rc.7"

const today = new Date().toISOString().slice(0, 10)
const reviewSystemPrompt =
  `You are an experienced software engineer reviewing a code change. You will
get a diff and possibly a written PR description and linked issues, and possibly
more files for context.

Review the change for correctness, convention-following, elegance, security,
and good user experience. Also consider whether the PR description adequately
explains the goals of the code change and whether the code is the best way of
achieving those goals. Have high standards and be a serious critic, but avoid
nitpicks or call them out as such. Remember that because you are only seeing a
diff, you are not seeing all the context that might be required. An import or
variable definition that is not in the diff may already have been in the file
before this change. Assume that the code compiles and lints -- we only use this
tool after such obvious issues are fixed.

CRITICAL: Only provide actionable feedback. If code is correct and follows
conventions, say nothing about it. Do not describe what the code does or
summarize the changes. Do not explain the PR's purpose unless that explanation
directly supports a specific suggestion for improvement. If you have no
substantive concerns or improvements to suggest, respond with a brief statement
to that effect.

Do not reproduce the diff except in small parts in order to comment on
a specific issue. Write your response in GitHub markdown with headings,
paragraphs, backticks for code, etc. Every comment should be a concrete
suggestion for improvement or a specific concern about correctness, performance,
or maintainability.

The length of the review should be proportionate to the number of issues found,
not the size of the change. A large PR with no problems should receive a minimal
response. Write concisely: assume the reader is very familiar with the change.

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

const trackingIssueGraphql = `
  query($owner: String!, $repo: String!, $issue_number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $issue_number) {
        title
        body
        subIssues(first: 100) {
          nodes {
            number
            title
            state
            repository { nameWithOwner }
          }
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
            author { login }
            body
            submittedAt
          }
        }
        reviewThreads(first: 100) {
          nodes {
            isCollapsed
            comments(first: 100) {
              nodes {
                body
                isMinimized
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
const toRepoStr = (repoSel: RepoSel) => `${repoSel.owner}/${repoSel.repo}`
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

type Commit = {
  authors: Actor[]
  committedDate: string
  messageBody: string
  messageHeadline: string
  oid: string
}

type Comment = {
  body: string
  author: Actor
  outdated: boolean
  isMinimized: boolean
  path: string
  line: number | null
  originalLine: number | null
  diffHunk: string
  createdAt: string
  commit: { oid: string }
}
type Review = {
  author: Actor
  body: string
  submittedAt: string
}
type ReviewThread = {
  isCollapsed: boolean
  comments: { nodes: Comment[] }
}

type Reviews = {
  data: {
    repository: {
      pullRequest: {
        reviews: { nodes: Review[] }
        reviewThreads: { nodes: ReviewThread[] }
      }
    }
  }
}

type SubIssue = {
  number: number
  title: string
  state: string
  repository: { nameWithOwner: string }
}
type TrackingIssue = {
  data: {
    repository: {
      issue: {
        title: string
        body: string
        subIssues: { nodes: SubIssue[] }
      }
    }
  }
}

const getPrArgs = (sel: PrSel) => ["-R", toRepoStr(sel), sel.pr]

const REPO_EXCLUDES: Record<string, RegExp[]> = {
  "oxidecomputer/omicron": [
    // exclude giant schema files in omicron because the new versioning setup
    // makes and entire new schema file instead of modifying the existing one
    // TODO: be smart and get the actual schema diff
    // https://github.com/oxidecomputer/console/blob/main/tools/deno/api-diff.ts
    /^openapi\/[^\/]+\/.+\.json$/,
  ],
}

/** Filter out gigantic useless lockfiles from diff */
function filterDiff(rawDiff: string, sel?: RepoSel): string {
  const lines = rawDiff.split("\n")
  const excludes = [/package-lock\.json$/, /Cargo\.lock$/, /bun\.lock$/, /deno\.lock$/]

  const repoStr = sel ? toRepoStr(sel) : undefined
  if (repoStr && REPO_EXCLUDES[repoStr]) {
    excludes.push(...REPO_EXCLUDES[repoStr])
  }

  const filteredLines = []
  let skipUntilNextDiff = false

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      // diff --git a/file b/file
      const filename = line.split(" ").pop()?.substring(2) || ""
      skipUntilNextDiff = excludes.some((re) => re.test(filename))
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

type IssueSel = RepoSel & { issue: number }
const issueGraphql = <T>(sel: IssueSel, query: string) =>
  $`gh api graphql -f owner=${sel.owner} -f repo=${sel.repo} -F issue_number=${sel.issue} -f query=${query}`
    .json<T>()

const getLinkedIssues = async (sel: PrSel) => {
  const raw = await graphql<LinkedIssues>(sel, linkedIssuesGraphql)
  const linkedIssues = raw.data.repository.pullRequest.closingIssuesReferences.nodes
  return linkedIssues.map((i) =>
    `## ${i.title} (${i.repository.name}#${i.number})\n\n${i.body}`
  ).join("\n\n")
}

const fetchCommits = async (sel: PrSel) => {
  const { commits } = await $`gh pr view ${getPrArgs(sel)} --json commits`.json<
    { commits: Commit[] }
  >()
  return commits.flatMap((c) => [
    `## ${c.oid}`,
    `**Authors**: ${c.authors.map((a) => a.login).join(", ")}`,
    `**Date**: ${c.committedDate}`,
    c.messageHeadline,
    c.messageBody,
  ]).join("\n\n")
}

const fetchComments = async (sel: PrSel) => {
  const raw = await graphql<Reviews>(sel, reviewsGraphql)

  const reviews = raw.data.repository.pullRequest.reviews.nodes
    .filter((r) => r.body)
    .flatMap((r) => [`## Review by ${r.author.login} (${r.submittedAt})`, r.body])

  const reviewComments = raw.data.repository.pullRequest.reviewThreads.nodes
    .filter((r) => !r.isCollapsed)
    .flatMap((r) =>
      r.comments.nodes
        .filter((c) => !c.isMinimized)
        .flatMap((c) => [
          `## Comment by ${c.author.login} (${c.createdAt}${
            c.outdated ? ", outdated" : ""
          })`,
          `**Path**: ${c.path}`,
          `**Line**: ${c.line || c.originalLine}`,
          `**Commit**: ${c.commit.oid}`,
          cb(c.diffHunk.split("\n").slice(-4).join("\n"), "diff"),
          c.body,
        ])
    )

  return [...reviews, ...reviewComments].join("\n\n")
}
const getPrContext = (sel: PrSel, includeComments: boolean) =>
  Promise.all([
    $`gh pr view ${getPrArgs(sel)}`.text().then(mdSection("Body")),
    getLinkedIssues(sel).then(mdSection("Linked issues")),
    $`gh pr diff ${getPrArgs(sel)}`.text().then((d) => filterDiff(d, sel)).then(
      mdSection("Diff"),
    ),
    fetchCommits(sel).then(mdSection("Commits")),
    includeComments
      ? fetchComments(sel).then(mdSection("Comments"))
      : Promise.resolve(undefined),
  ])
    .then((results) => results.filter((x) => !!x).join("\n\n"))

const pickPr = (sel: RepoSel) =>
  $`gh pr list -R ${
    toRepoStr(sel)
  } --limit 100 --json number,title,updatedAt,author --template \
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

async function getPrSelector(repoArg: string | undefined, prArg: number | undefined) {
  // if the repo is not given, try to figure it out from the dir
  const repoSel = repoArg ? parseRepoSelector(repoArg) : await getCurrRepo()
  const repoStr = toRepoStr(repoSel)
  await $`gh repo view ${repoStr}`.text() // blow up early if repo doesn't exist
  const pr = prArg ? prArg : await pickPr(repoSel)
  if (!prArg) {
    console.log(`Reviewing PR #${pr} (https://github.com/${repoStr}/pull/${pr})\n`)
  }
  return { ...repoSel, pr }
}

async function getStdin() {
  if (Deno.stdin.isTerminal()) return undefined
  return new TextDecoder().decode(await readAll(Deno.stdin)).trim() || undefined
}

async function aiReview(model: string | undefined, inputs: (string | undefined)[]) {
  const args = ["--system", reviewSystemPrompt, "--model", model]
  const prompt = inputs.filter((x) => x).join("\n\n")
  await $`ai ${args}`.stdinText(prompt)
}

const DEFAULT_MODEL = "gpt-5"

const reviewCmd = new Command()
  .description("Review a PR")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .option("-p,--prompt <prompt:string>", "Additional instructions", { default: "" })
  .option("-m,--model <model:string>", "Model (passed to ai command)", {
    default: DEFAULT_MODEL,
  })
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
  .option("-m,--model <model:string>", "Model (passed to ai command)", {
    default: DEFAULT_MODEL,
  })
  .action(async (opts) => {
    const stdin = await getStdin()
    if (!stdin) throw new ValidationError("Input through stdin is required")
    await aiReview(opts.model, [stdin, opts.prompt])
  })

const discussionCmd = new Command()
  .description("Print PR discussion w/o diff (body, linked issues, comments)")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .arguments("[pr:integer]")
  .action(async (opts, pr) => {
    const prSel = await getPrSelector(opts.repo, pr)
    const prContext = await Promise.all([
      $`gh pr view ${getPrArgs(prSel)}`.text().then(mdSection("Body")),
      fetchCommits(prSel).then(mdSection("Commits")),
      getLinkedIssues(prSel).then(mdSection("Linked issues")),
      fetchComments(prSel).then(mdSection("Comments")),
    ])
      .then((results) => results.filter((x) => !!x).join("\n\n"))
    console.log(prContext)
  })

const trackingCmd = new Command()
  .description("Print tracking issue with subissues")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .arguments("<issue:integer>")
  .action(async (opts, issue) => {
    const { owner, repo } = opts.repo ? parseRepoSelector(opts.repo) : await getCurrRepo()
    const sel: IssueSel = { owner, repo, issue }
    const raw = await issueGraphql<TrackingIssue>(sel, trackingIssueGraphql)
    const { title, body, subIssues } = raw.data.repository.issue

    console.log(`# ${title}\n`)
    console.log(body)
    console.log("\n## Subissues\n")
    for (const sub of subIssues.nodes) {
      const state = sub.state === "OPEN" ? "[ ]" : "[x]"
      console.log(`- ${state} ${sub.repository.nameWithOwner}#${sub.number}: ${sub.title}`)
    }
  })

await new Command()
  .name("aipr")
  .description("Review PRs and debug CI failures.")
  .helpOption("-h, --help", "Show help")
  .action(() => {
    throw new ValidationError("Subcommand required")
  })
  .command("review", reviewCmd)
  .command("local", localCmd)
  .command("discussion", discussionCmd)
  .command("tracking", trackingCmd)
  .parse()
