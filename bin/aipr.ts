#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=gh,ai,fzf --allow-net=api.github.com

import $ from "jsr:@david/dax@0.43.0"
import { readAll } from "jsr:@std/io@0.225.2"
import { Command, ValidationError } from "jsr:@cliffy/command@1.0.0-rc.7"

const today = new Date().toISOString().slice(0, 10)
const reviewSystemPrompt =
  `You are an experienced software engineer reviewing a code change. You will
get a diff and possibly a written PR description and linked issues, and possibly
more files for context. Review the change for correctness, convention-following,
elegance, and good user experience. Also consider whether the PR description
adequately explains the goals of the code change and whether the code is
the best way of achieving those goals. Have high standards and be a harsh
critic. We want really high-quality code. Do not reproduce the diff except
in small parts in order to comment on a few lines. Do not reproduce large
chunks of the diff. Focus on substantive suggestions that improve correctness
or clarity. Do NOT go through the change piece by piece and describe what
the PR does in detail unless it is needed to explain a suggestion. Do not
bother praising the change as necessary or important or good. At the top of
your response, include a header like '## Review of [reponame#1234: PR Title
Here](https://github.com/owner/reponame/pull/1234)'. Today's date is ${today}.`

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

const cb = (s: string, lang = "") => `\`\`\`${lang}\n${s}\n\`\`\``

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

const getPrArgs = (sel: PrSel) => ["-R", `${sel.owner}/${sel.repo}`, sel.pr]

/** Filter out gigantic useless lockfiles from diff */
function filterDiff(rawDiff: string): string {
  const lines = rawDiff.split("\n")
  const filesToExclude = ["/package-lock.json", "/Cargo.lock"]

  const filteredLines = []
  let skipUntilNextDiff = false

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      skipUntilNextDiff = filesToExclude.some((filename) => line.includes(filename))
    }

    if (!skipUntilNextDiff) filteredLines.push(line)
  }

  return filteredLines.join("\n")
}

async function getPrContext(sel: PrSel) {
  const [fullPr, diff, linkedIssuesRaw] = await Promise.all([
    $`gh pr view ${getPrArgs(sel)}`.text(),
    $`gh pr diff ${getPrArgs(sel)}`.text().then(filterDiff),
    $`gh api graphql -f owner=${sel.owner} -f repo=${sel.repo} -F pr_number=${sel.pr} -f query=${linkedIssuesGraphql}`
      .json<LinkedIssues>(),
  ])
  const linkedIssues =
    linkedIssuesRaw.data.repository.pullRequest.closingIssuesReferences.nodes
  const linkedIssuesMd = linkedIssues.map((i) =>
    `## ${i.title} (${i.repository.name}#${i.number})\n\n${i.body}`
  ).join("\n\n")
  return ["# Body", fullPr, "# Linked issues", linkedIssuesMd, "# Diff", cb(diff, "diff")]
    .join("\n\n")
}

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

const basePrompt =
  "Review the above change, focusing on things to change or fix. Don't bother listing what's good about it beyond a sentence or two."

type Opts = { prompt: string; model?: string }

async function aiReview(change: string, opts: Opts) {
  const args = ["--system", reviewSystemPrompt]
  if (opts.model) args.push("-m", opts.model)
  const prompt = [change, basePrompt, opts.prompt].filter((x) => x).join("\n\n")
  await $`ai ${args}`.stdinText(prompt)
}

const reviewCmd = new Command()
  .description("Review a PR")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .option("-p,--prompt <prompt:string>", "Additional instructions", { default: "" })
  .option("-m,--model <model:string>", "Model (passed to ai command)")
  .arguments("[pr:integer]")
  .action(async (opts, pr) => {
    const prSel = await getPrSelector(opts.repo, pr)
    const prContext = await getPrContext(prSel)
    await aiReview(prContext, opts)
  })

const localCmd = new Command()
  .description("Review code from stdin instead of a PR")
  .option("-p,--prompt <prompt:string>", "Additional instructions", { default: "" })
  .option("-m,--model <model:string>", "Model (passed to ai command)")
  .action(async (opts) => {
    const stdin = new TextDecoder().decode(await readAll(Deno.stdin)).trim()
    if (!stdin) throw new ValidationError("Input through stdin is required")
    await aiReview(stdin, opts)
  })

const contextCmd = new Command()
  .description("Print context to stdout")
  .option("-R,--repo <repo:string>", "Repo (owner/repo)")
  .arguments("[pr:integer]")
  .action(async (opts, pr) => {
    const prSel = await getPrSelector(opts.repo, pr)
    const prContext = await getPrContext(prSel)
    console.log(prContext)
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
  .command("context", contextCmd)
  .parse()
