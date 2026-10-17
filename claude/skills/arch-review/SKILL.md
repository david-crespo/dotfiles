---
name: arch-review
description: "Get a context-free architecture review of a TypeScript codebase: build a digest of every file's size, leading comment and exported declarations, give it to a bare Opus `claude -p` with no tools and no project or planning context, then check its findings against the code before reporting. Use when the user wants a fresh or outside read on a codebase's architecture or data model, for example after a big refactor."
---

# Context-free architecture review

The reviewer sees only the code's structure: what each file is called, how
big it is, what its header comment says it does, what it imports, and what
it exports. It
gets no tools, no plans, no notes and no history, so it judges the code as
it reads to a newcomer. That makes it good at finding where the types, names
and comments describe a different system from the one that runs. It can't
see function bodies, so verify its claims before relaying them.

## 1. Build the digest

From the repo root:

```
~/.claude/skills/arch-review/digest.sh [--cli <command>] [--exclude <regex>] [--full <file>]... <scratchpad>/digest.md
```

- `--cli` adds the command's `--help` and each subcommand's (Commander-style
  help). Pass it when the repo is a CLI, since the command tree is part of
  the model.
- `--exclude` drops paths matching a regex, such as generated code or
  helper scripts outside the app. `scripts/` and `*.config.*` files are
  already left out.
- `--full` (repeatable) shows a file's whole source instead of its
  declarations. Use it for the few files the focus question is about,
  such as the composition root or the class that owns the model, so the
  reviewer reads their bodies rather than guessing at them. The whole
  non-test source of a ~10k line repo is around 360 KB, so a handful of
  full files costs little.
- Each file lists the repo files it imports (found by a text scan in
  `imports.mjs`, including type-only and dynamic imports), and a section
  above the files counts imports between top-level directories, so the
  reviewer can see which way dependencies run.
- It includes AGENTS.md, CLAUDE.md and README.md when they're under 20 KB.
  It leaves out `.claude/`, which is where planning notes live.
- It prints the digest's size and any file with exports but no
  declarations. Fix those gaps before sending: the reviewer will say it
  couldn't see them, and its findings about them will be guesses. A ~10k
  line repo comes to about 105 KB, which fits easily.

Skim the digest before sending it.

## 2. Write the prompt

Fill in `prompt.md` from this skill's directory and write it to the
scratchpad with the digest appended:

- `{{name}}`, `{{size}}`: the repo name and its line count (`tokei`).
- `{{context}}`: only facts a newcomer would need to judge it fairly, such
  as "It's a personal tool with one user, in a private repo." Leave out
  your own conclusions, the plan, and what was just changed. The point is
  a read without them.
- `{{cli_line}}`: "the CLI's help text, " when you passed `--cli`; empty
  otherwise.
- `{{focus}}`: what the user wants judged most, for example "the data
  model: the types in core/model.ts and how the rest of the code is
  organized around them".

Drop the CLI question when there's no CLI. Add questions the user asks for,
but keep the instructions to number the findings, say what's inferred, and
skip nits.

## 3. Run it

Run it from an empty directory, so no project CLAUDE.md loads. Use the
Bash tool with `allowed_domains: ["api.anthropic.com"]` and
`run_in_background: true`. It takes a few minutes.

```bash
cd "$(mktemp -d)" && claude -p --model opus --tools "" \
  --system-prompt "You are a senior software engineer reviewing the architecture of a codebase from a structural digest. You have no other context about the project or its history." \
  --setting-sources "" --strict-mcp-config < <scratchpad>/review-prompt.txt > <scratchpad>/review.md
```

## 4. Verify, then report

Check each finding against the code before passing it on. In the first run,
most findings held, and the misses followed patterns:

- **Stale wording in the code misleads it.** The reviewer will take
  comments and names at their word. When a finding rests on a comment
  that's out of date (a model comment still describing an operation by
  its old name), the user may tell you the finding is wrong. The real fix
  is then the comment or name, so the next reader isn't misled either.
- **"Could cause a bug" claims are guesses about bodies.** It flagged two
  workspace-root helpers that could disagree. One turned out to be used
  only for an error hint. Find the call sites before repeating a claim
  like that.
- **Gaps in the digest show up as inferred findings.** If it says a file
  had no declarations, fix the digest and consider running it again.

Report findings in the reviewer's order, numbered, each marked confirmed,
partly right or wrong, with the file reference. Then give your own view on
what to do first. Save the review next to the repo's notes
(`.claude/notes/<YYYY-MM-DD>-arch-review.md`) with the digest command used,
so a later run can be compared against it. The review has more than a
couple of numbered findings, so offer to put them in a tracker (the tracker
skill).
