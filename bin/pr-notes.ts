#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=gh,pbcopy,fzf

import $ from "@david/dax"
import { Command, ValidationError } from "@cliffy/command"
import { walk } from "@std/fs/walk"
import { basename } from "@std/path"

/** Fuzzy multi-select files under a directory with fzf. fzf draws its UI on
 * /dev/tty, so we feed candidates on stdin and read the picks off stdout.
 * Aborting (Esc / Ctrl-C → exit 130) cancels the whole operation silently. */
async function pickFiles(dir: string): Promise<string[]> {
  const candidates: string[] = []
  for await (const entry of walk(dir, { includeDirs: false })) {
    candidates.push(entry.path)
  }
  candidates.sort()
  if (candidates.length === 0) throw new ValidationError(`no files under ${dir}`)
  // fzf exit codes: 0 = selection, 1 = no match, 2 = error, 130 = Ctrl-C/Esc.
  const result = await $`fzf --multi --prompt=${`${dir}> `}`
    .stdinText(candidates.join("\n"))
    .stdout("piped")
    .noThrow()
  if (result.code === 130) Deno.exit(0) // user aborted: cancel, no message
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(`fzf failed (exit ${result.code})`)
  }
  return result.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
}

/** Wrap each file's contents in a collapsible <details> block. The blank lines
 * around the body are required for GitHub to render the markdown inside. */
function inlineBlocks(files: string[]): string {
  return files
    .map((f) => {
      const content = Deno.readTextFileSync(f)
      return `<details>\n<summary><code>${basename(f)}</code></summary>\n\n` +
        `${content}\n\n</details>\n`
    })
    .join("\n")
}

/** GitHub caps PR bodies and issue/PR comments at 65536 characters (not bytes).
 * Undocumented but enforced: the API rejects longer bodies with
 * "Body is too long (maximum is 65536 characters)". See
 * https://github.com/orgs/community/discussions/27190 */
const GITHUB_MAX_CHARS = 65536

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "-")

/** Upload files to a gist and return a markdown block linking it and each file
 * by its in-page anchor (file-<name lowercased, non-alphanumerics -> dashes>). */
async function gistBlock(files: string[], dryRun: boolean): Promise<string> {
  // gh gist create has no JSON output; it writes only the gist URL to stdout
  // (progress goes to stderr), so trim it and sanity-check the prefix. In a dry
  // run, skip the upload and stand in a placeholder URL so the block still forms.
  const url = dryRun
    ? "https://gist.github.com/DRY-RUN"
    : (await $`gh gist create --desc notes ${files}`.text()).trim()
  if (!url.startsWith("https://gist.github.com/")) {
    throw new Error(`unexpected gist output: ${url}`)
  }
  const links = files
    .map((f) => `- [\`${basename(f)}\`](${url}#file-${slug(basename(f))})`)
    .join("\n")
  return `## 🤖 notes ([gist](${url}))\n\n${links}\n`
}

await new Command()
  .name("pr-notes")
  .description(
    "Upload files to a gist and copy a markdown summary clipboard, ready " +
      "to paste into a PR. Pass a directory to open a fzf picker.",
  )
  .helpOption("-h, --help", "Show help")
  .option("-i, --inline", "Use <details> blocks instead of gist")
  .option("-d, --dry-run", "Skip the gist upload")
  .arguments("<paths...:string>")
  .action(async (opts, ...paths) => {
    // A path may be a file (used as-is) or a directory (fuzzy-pick its files).
    const files: string[] = []
    for (const p of paths) {
      const stat = await Deno.stat(p).catch(() => null)
      if (!stat) throw new ValidationError(`not found: ${p}`)
      if (stat.isDirectory) files.push(...await pickFiles(p))
      else files.push(p)
    }
    if (files.length === 0) throw new ValidationError("no files selected")

    // Inline payloads embed full file contents, so preview just the file list
    // rather than dumping everything. Gist payloads are short links — show as-is.
    const payload = opts.inline
      ? inlineBlocks(files)
      : await gistBlock(files, !!opts.dryRun)
    const preview = opts.inline
      ? `## 🤖 notes (inlined as <details> blocks)\n\n` +
        files.map((f) => `- \`${basename(f)}\``).join("\n") + "\n"
      : payload
    await $`pbcopy`.stdinText(payload)
    console.log("\n" + preview)
    // Only inline payloads embed file contents and risk exceeding GitHub's limit;
    // gist payloads are just short links. Warn but still copy — paste may truncate.
    if (opts.inline && payload.length > GITHUB_MAX_CHARS) {
      console.error(
        `warning: payload is ${payload.length} chars, over GitHub's ` +
          `${GITHUB_MAX_CHARS}-char limit for PR bodies and comments; ` +
          `it will be rejected. Use gist mode (drop -i) instead.`,
      )
    }
    console.error(
      opts.dryRun ? "(copied to clipboard; gist upload skipped)" : "(copied to clipboard)",
    )
  })
  .parse()
