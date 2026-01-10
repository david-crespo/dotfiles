---
name: pr-review
description: Agentic code review of a GitHub pull request. Explores the codebase, tests hypotheses, and produces findings with high confidence.
---

# Agentic PR Review

Review a pull request by exploring the codebase, understanding context, and testing hypotheses. Unlike one-shot diff reviews, this approach minimizes false positives by verifying concerns against the actual code.

## Input

The user provides:
- **PR number**: e.g., `123`
- **Repo name**: e.g., `omicron` or `console`

If not provided, ask for both. The repo owner is assumed to be `oxidecomputer` unless specified otherwise.

## Setup

Run the setup script to create an isolated worktree:

```bash
{baseDir}/setup.sh <repo_name> <pr_number>
```

This outputs `REPO_PATH` and `REVIEW_DIR`. All subsequent work should happen in `REVIEW_DIR`.

Check for `AGENTS.md` or `CLAUDE.md` in the repo root—these often contain repo-specific guidance on testing, patterns, and pitfalls relevant to review.

## Review Process

### 1. Gather PR metadata and existing discussion

```bash
{baseDir}/pr-info.sh <repo_name> <pr_number>
```

This fetches:
- PR title, body, commits, and changed files
- Linked issues (issues that will be closed by the PR)
- Existing reviews and review comments from other reviewers

Note which files changed and the nature of the change (new feature, bugfix, refactor, etc.). Pay attention to existing review comments—don't repeat issues that have already been raised unless you have additional insight.

### 2. Understand the change in context

Read the modified files in full, not just the diff hunks. Understand:
- What the code does before and after
- How it fits into the broader system
- What invariants or contracts exist

For each changed file, consider reading:
- Other files in the same directory
- Files that import or are imported by the changed files
- Tests for the changed code
- Related types, interfaces, or schemas

**Using subagents for parallel exploration:** For large PRs, use the Task tool with `subagent_type=Explore` to gather context in parallel. Spawn multiple agents to find callers of modified functions, locate related test files, or search for similar patterns.

### 3. Identify potential concerns

Look for issues CI won't catch:
- Logic errors and edge cases
- Race conditions or concurrency issues
- Security concerns (injection, auth bypass, data exposure)
- API contract violations
- Performance regressions in hot paths
- Backwards compatibility breaks
- Missing error handling for realistic failure modes
- Incorrect assumptions about external systems
- Pre-existing issues not introduced by this PR: if you notice a bug, we want to know!

Do NOT flag:
- Style issues (assume formatters/linters run in CI)
- Missing tests (unless a specific untested edge case is concerning)
- Theoretical concerns unlikely to occur in practice

### 4. Test hypotheses

When uncertain about a potential issue, verify it by running tests or type checkers. Check `package.json`, `Cargo.toml`, or similar for available commands.

**Write a small test to demonstrate a concern:**
If you suspect an edge case bug, write a test that exercises it. If the test fails, the concern is valid. If it passes, you may have misunderstood. Propose the test be included in the PR if it covers a real gap.

**Trace call paths:**
Find callers of modified functions to understand impact:
```bash
rg "function_name\(" --type ts
ast-grep --pattern 'function_name($$$)'
```

**Query GitHub for more context:**
Use the GH CLI to fetch additional information when needed:
```bash
# View PR comments
gh api repos/oxidecomputer/<repo>/pulls/<pr>/comments

# View issue comments on a linked issue
gh api repos/oxidecomputer/<repo>/issues/<issue>/comments

# View PR review comments
gh api repos/oxidecomputer/<repo>/pulls/<pr>/reviews
```

### 5. Produce findings

For each confirmed issue, provide:
- **Severity**: Blocker (must fix) or Suggestion (consider fixing)
- **Location**: File path and line range
- **Problem**: What's wrong and why it matters
- **Evidence**: How you verified this (test output, code trace, etc.)
- **Fix**: Concrete suggestion or alternative approach

If no substantive issues are found, say so briefly. Don't manufacture concerns.

## Cleanup

When finished:

```bash
{baseDir}/cleanup.sh <repo_name> <pr_number>
```

## Output

Write the review to `/tmp/pr-review-<repo>-<pr>-<timestamp>.md` and tell the user the path.

### Review Format

```markdown
## Review of oxidecomputer/<repo>#<pr>: PR Title

### Summary
[1-2 sentences on what the PR does and overall assessment]

### Findings

#### [Blocker/Suggestion] Brief description
**File:** `src/foo/bar.ts:45-52`
[Explanation with evidence]
**Suggested fix:** [Concrete code or approach]

---

### Context Manifest
Files to include (in order of relevance):
1. pr_diff - the full PR diff
2. src/foo/bar.ts - primary file modified
3. src/foo/bar.test.ts:50-120 - relevant tests

Additional context:
- PR description and linked issues
- Key findings from exploration
```

## Repo-Specific Guidance

Repos can add a `## Code Review` or `## PR Review` section to their `AGENTS.md` or `CLAUDE.md` with:
- Test commands (`npm run tsc`, `cargo nextest`, etc.)
- Key architectural patterns
- Common pitfalls to watch for
- Important files that often need checking together

This skill will read those files during setup and follow repo-specific guidance.

## Distribution

To share this skill with colleagues, they copy the `pr-review/` directory to their own `~/.claude/skills/`. Each repo's existing `AGENTS.md`/`CLAUDE.md` provides the customization.

---

Now begin the review based on the user's input.
