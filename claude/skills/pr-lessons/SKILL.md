---
name: pr-lessons
description: Analyze merged PR review comments to extract coding conventions and distill new CLAUDE.md guidelines. Use when you want to mine recent PRs for patterns not yet documented.
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Task, WebFetch
---

# Skill: Extract CLAUDE.md guidelines from PR review comments

Analyze merged PRs for review comments requesting changes, then distill new
guidelines for CLAUDE.md that aren't already covered. Start with enough PRs
(~30-50 in a monorepo) to find 3-5 with relevant review comments, then expand
until the signal thins out or enough patterns have been collected. In a monorepo,
most PRs will be dependency bumps or touch unrelated components, so the initial
pool needs to be larger than the number of PRs you actually want to analyze.

Expect a hit rate of ~15-20% of comment threads yielding generalizable
conventions. This is normal — most threads are discussions, questions, or
praise that don't produce CLAUDE.md guidelines.

## Procedure

### 1. Identify PRs with relevant review comments

List recent merged PRs, then check each for review comments and file relevance
in a single pass. This avoids redundant API calls.

```sh
# List recent merged PRs (adjust --limit as needed)
gh pr list --state merged --limit 50 --json number,title

# Combined check: has review comments AND touches relevant files.
# In a monorepo, filter by subdirectory (e.g., nexus/, common/).
for pr in <numbers>; do
  count=$(gh-api-read "repos/<owner>/<repo>/pulls/$pr/comments" | jq 'length')
  [ "$count" -eq 0 ] && continue
  relevant=$(gh-api-read "repos/<owner>/<repo>/pulls/$pr/files?per_page=100" \
    | jq -r '.[].filename' \
    | grep -cE '^<subdir>/' || true)
  [ "$relevant" -eq 0 ] && continue
  echo "PR #$pr: $count comments, $relevant relevant files"
done
```

Skip PRs that don't touch the target area — their review comments won't produce
useful guidelines for the local CLAUDE.md.

### 2. Fetch threaded review comments

For each relevant PR, fetch threaded review comments. Truncate diff_hunks to
~10 lines to control payload size — the hunks can be very large (60+ lines of
endpoint definitions, schema changes, etc.) but usually only the first few lines
provide enough context to understand the comment.

```sh
gh-api-read "repos/<owner>/<repo>/pulls/$pr/comments?per_page=100" \
  | jq 'group_by(.in_reply_to_id // .id)
        | map({
            path: .[0].path,
            diff_hunk: (.[0].diff_hunk | split("\n") | .[:10] | join("\n")),
            messages: [.[] | {user: .user.login, body: .body}]
          })'
```

This groups comments into conversation threads. The `diff_hunk` on the first
message gives the code context where the comment was placed.

**If the diff_hunk isn't enough context** (fallback, rarely needed), fetch the
full diff filtered to only the commented files:

```sh
commented_files=$(gh-api-read "repos/<owner>/<repo>/pulls/$pr/comments" \
  | jq -r '[.[].path] | unique[]')

gh pr diff $pr --repo <owner>/<repo> \
  | awk -v files="$commented_files" '
    BEGIN { split(files, arr, "\n"); for (i in arr) wanted[arr[i]]=1 }
    /^diff --git/ { found=0; for (f in wanted) if (index($0, f)) found=1 }
    found { print }'
```

### 3. Use the local repo for richer context (fallback)

If the diff_hunk and comment text aren't sufficient, use the local clone to see
more surrounding code. This is rarely needed — the threaded comments plus
truncated hunks are usually enough.

```sh
# See what the file looked like at the PR's base vs head
jj file show <path> -r <base-commit>
jj file show <path> -r <head-commit>

# Or use git if not using jj:
git show <commit>:<path>

# Browse the commit history of the PR branch
jj log -r '<base>::<head>'
```

This is useful when:

- The diff_hunk doesn't show enough surrounding code
- You need to understand whether a file was deleted entirely
- The change spans multiple hunks in the same file

### 4. Classify comment threads

For each thread, classify it:

- **Change request**: Reviewer asks for a specific code change (most valuable)
- **Question**: Reviewer asks for clarification (sometimes reveals conventions)
- **Praise/acknowledgment**: "nice", "LGTM", etc. (skip)
- **Discussion**: Broader design/tooling discussion (occasionally useful)
- **Self-review**: PR author comments on their own code to explain or self-correct
  (e.g., "fixing this, ew"). These are efficient to process since the convention
  is stated directly by the author.

Focus on change requests and questions that reveal conventions.

### 5. Analyze patterns

For each actionable comment:

1. Read the comment body to understand what the reviewer wanted
2. Find the relevant section of the PR diff to see what changed
3. Note the pattern: "When X, do Y instead of Z"

### 6. Deduplicate and distill

Group similar feedback across PRs into themes. Compare against existing
CLAUDE.md to filter out:

- Already-documented conventions
- Things enforced by linters (these don't need to be in CLAUDE.md)
- Patterns too specific to one situation to generalize

Write new guidelines that are:

- Specific enough to be actionable
- General enough to apply beyond one instance
- Supported by multiple PR examples when possible

### 7. Review proposed changes with a fresh-context subagent

Before finalizing, spawn a subagent (via the Task tool) to critically evaluate
the proposed guidelines. The subagent should receive only:

- The full text of the existing CLAUDE.md
- The proposed new guidelines (with their supporting PR examples)

The subagent's job is to flag guidelines that should be dropped or reworked:

- **Already covered**: the existing CLAUDE.md already says this, even if worded
  differently
- **Too obvious**: any competent developer or LLM would do this without being
  told (e.g., "use descriptive variable names", "handle errors")
- **Too vague**: the guideline doesn't give enough concrete direction to change
  behavior
- **Linter-enforced**: a formatter or linter already catches this, so documenting
  it adds noise

The subagent should return a filtered list: which guidelines to keep (and why
they add value), which to cut, and any suggested rewording. Use its output to
produce the final set of guidelines.

For small batches where the operator is reviewing the output manually, this step
can be skipped.

## Token budget considerations

The full diff of a PR can be very large. Strategies to manage:

- Pre-filter: only fetch PRs that have review comments AND touch relevant files
- Truncate diff_hunks to ~10 lines in the jq query — full hunks are rarely needed
- For initial triage, use just the threaded comments (smaller payload)
- Only fetch the full diff (filtered to commented files) as a fallback when
  the truncated hunk isn't enough context
- Fan out analysis to parallel subagents in batches of 5-7 PRs each
- Start with one PR to refine the procedure, then batch the rest
