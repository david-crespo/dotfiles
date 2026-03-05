---
name: codex-review
description: Get a Codex second opinion on your changes. Claude sends the diff to Codex for review, discusses the feedback, and synthesizes actionable results.
---

# Codex Review

Use Codex as a second pair of eyes on the current changes. Claude sends the
diff to Codex, reads the response, and can go back and forth with Codex to
clarify or push back on feedback before presenting a synthesis to the user.

## Input

The user may provide:
- A description of what to have Codex review (defaults to the current diff)
- A specific revision or range to diff (defaults to fork point from trunk)
- How many rounds of back-and-forth to allow (defaults to up to 2)

## How to call Codex

Use `{baseDir}/codex-call.ts` for all Codex interactions. It wraps
`codex exec` with the right model (`gpt-5.4`), reasoning effort (`xhigh`),
JSON extraction, and cost calculation.

On new sessions, the script automatically prepends a preamble to the prompt
that tells Codex:
- It's being called by Claude Code to review a change
- It's in a read-only sandbox (can read files, can't run tests or write)
- If it wants to test a hypothesis, it should describe the test and Claude
  will run it
- It should focus on substantive issues, not style

On `--resume` calls the prompt is sent as-is since Codex already has context.

**Important:** Codex calls can take several minutes. Always set a 10 minute
timeout (600000ms) on Bash calls to `codex-call.ts`.

**Starting a session:**

```bash
RESULT=$({baseDir}/codex-call.ts "The diff is in /tmp/codex-review-diff.patch — read it and provide your review.")
THREAD_ID=$(echo "$RESULT" | jq -r '.thread_id')
RESPONSE=$(echo "$RESULT" | jq -r '.response')
```

**Continuing a session:**

```bash
RESULT=$({baseDir}/codex-call.ts --resume "$THREAD_ID" "follow-up prompt")
```

Output format:

```json
{
  "thread_id": "019c...",
  "response": "review text here",
  "input_tokens": 9725,
  "cached_tokens": 0,
  "output_tokens": 40,
  "cost_usd": 0.03
}
```

## Process

### 1. Get the diff

When the user says "this change" or doesn't specify, diff the current change
against its fork point from trunk:

```bash
jj diff -r 'fork_point(trunk() | @)..@'
```

If the user specifies a revision, use that instead. For large diffs, use
`--stat` first to understand scope, then get the full diff.

### 2. Send to Codex for review

Write the diff to a temp file and ask Codex to review it.

```bash
jj diff -r 'fork_point(trunk() | @)..@' > /tmp/codex-review-diff.patch
RESULT=$({baseDir}/codex-call.ts "The diff is in /tmp/codex-review-diff.patch — read it and provide your review.")
```

Save the thread ID and response from the JSON output.

### 3. Evaluate the response

Read Codex's review. For each point raised:
- If it's clearly valid, note it
- If it's unclear or seems wrong, formulate a follow-up question
- If it's noise (style nits, theoretical concerns), skip it
- If Codex proposes a test to verify a concern, run it locally and report
  the result back via `--resume`

### 4. Follow up if needed (up to 2 rounds)

If there are points worth discussing, send a follow-up using `--resume`:

```bash
RESULT=$({baseDir}/codex-call.ts --resume "$THREAD_ID" "your follow-up")
```

This might be:
- Pushing back on a point with additional context
- Asking Codex to elaborate on a vague concern
- Reporting test results from running Codex's suggested verification
- Asking it to read specific files to check a claim

Each round uses the same thread ID, so Codex has full context.

Do not do more rounds than necessary. If the first response is clear and
actionable, skip follow-ups. The max is there for cases where clarification
genuinely helps.

### 5. Synthesize for the user

Present a summary that includes:
- Issues worth addressing, with file locations and suggested fixes
- Points raised by Codex that were investigated and dismissed (briefly, with reasoning)
- Any disagreements between your analysis and Codex's

If there's nothing substantive, say so. Don't inflate minor points.

Sum up `cost_usd` across all calls and include total usage at the end:

> **Codex usage:** 15,230 input tokens (8,400 cached), 1,204 output tokens across 2 turns — ~$0.03

## Notes

- Codex runs read-only in the default sandbox. It can read files and run
  read-only commands (cat, rg, etc.) to verify its claims.
- If Codex proposes a test to verify a concern, run it locally in this
  Claude session rather than asking Codex to execute it. Report the result
  back to Codex via `--resume` if needed.
- If Codex seems to be hallucinating about file contents, ask it to `cat` the
  file in a follow-up rather than trusting its memory.
- Model, preamble, and pricing are configured in `codex-call.ts`.
