---
name: write-issue
description: Draft a GitHub issue in the user's voice. Use when the user asks for help writing or filing an issue.
user_invocable: true
---

# Skill: Write a GitHub issue in the user's voice

LLMs default to issue bodies that are simultaneously too long and too thin:
"## Description / ## Steps to reproduce / ## Expected / ## Actual /
## Acceptance criteria" boilerplate with one sentence per heading. The user
does not write that way. The rules below describe how he does write, with
examples drawn from his issue history. Match this style when drafting.

## Before drafting

- If the target repo has `.github/ISSUE_TEMPLATE/`, read it and follow it.
  External projects often require structured templates; fill in the fields,
  but write the prose inside each field in the voice described below. If no
  template applies, do not invent one.
- If a repo path is given, prefer reading the relevant code locally and
  pasting commit-pinned permalinks rather than retelling what the code does.
- Ask for the target repo or issue substance only when it cannot be inferred
  from the user's prompt or local context. Do not file the issue — produce the
  title and body for review.

## Core rules

### 1. Length matches the problem; no padding

Body is as long as the substance demands and no longer. Single-sentence asks
stay single sentences. Empty bodies are fine when the title is enough.
Headings appear only when there are multiple distinct threads that need
navigation (roughly 600+ chars and ≥2 sub-topics) — never as scaffolding.

- Title-only / empty body: clear ask whose body would just restate the
  title. Example: [console#322 — Enter key should submit forms](https://github.com/oxidecomputer/console/issues/322).
- One short paragraph (≤300 chars): typical for small bugs and small
  feature asks with a single observation. Example: [omicron#5436 — OxQL: want single most recent data point from a time range](https://github.com/oxidecomputer/omicron/issues/5436).
- Multi-section with headings: design questions with options, knowledge
  dumps, large bug investigations. Example: [console#1703 — Ensure correct loader prefetches for each page](https://github.com/oxidecomputer/console/issues/1703).

### 2. Titles are descriptive declaratives, not categorized labels

- Statement of fact for bugs: "No way to tell which is the boot disk",
  "Image upload is a lot slower than it should be".
- Imperative for feature requests: "Allow failed instances to be stopped",
  "Disallow submitting empty target or host".
- Topic + qualifier for polish/tracking: "Light mode polish", "Tracking:
  local disks UI".
- Bracketed component prefix when it adds clarity: "[nexus] List allocated
  IPs in a VPC subnet".

Never prefix with "Bug:", "Feature:", "FR:", "Question:". The category is
implicit in the grammar.

### 3. Open with the situation, not throat-clearing

The first sentence states what is happening or what is wanted. No "This
issue tracks…", no "I'm filing this because…", no restatement of the title.

> Right now the SNAT IP always comes from the default pool for the current
> silo, even when the user has specified they want an external IP from a
> different pool.
> — [omicron#5043](https://github.com/oxidecomputer/omicron/issues/5043)

> In the console we currently rely on the order of disks to mark out the
> boot disk for an instance.
> — [omicron#1417](https://github.com/oxidecomputer/omicron/issues/1417)

### 4. Ground claims in code via bare permalinks on their own line

When citing code, paste a commit-pinned GitHub permalink **as a bare URL on
its own paragraph**, with a `#L<a>-L<b>` line range. Two reasons:

1. GitHub auto-expands a bare same-repo permalink into an embedded code
   viewer with syntax highlighting and a file/line header. A
   `[text](url)` markdown link does not get that treatment.
2. Line *ranges* almost always beat single-line links — the surrounding
   context comes for free. Pin to the smallest self-contained excerpt
   (function header through closing brace, or 5–15 relevant lines).

Shape (note the blank lines and lack of link text):

```
However, `userLoader` is common to all authenticated routes, …

https://github.com/oxidecomputer/console/blob/<sha>/app/routes.tsx#L91-L99

This is a problem because of React Query's concept of `cacheTime` …
```

Inline code blocks are reserved for things not already in a file: generated
output, small synthetic examples, command output (e.g., a `rg` result),
error messages.

To build a permalink from a local repo, derive the owner/repo from the GitHub
remote, use the current commit SHA, and choose the smallest line range that is
self-contained enough for a reader to understand the point. Prefer reading the
code locally and linking the exact range over paraphrasing the implementation.

### 5. Hedge openly

Bodies routinely signal genuine uncertainty rather than packaging a plan as
a fait accompli. The hedges are an invitation to discuss.

> I'm tempted to make it optional, since a) any existing tokens will need
> to be given one, and b) you might not want to bother giving a name. On
> the other hand… Will have to think about it.
> — [omicron#8148](https://github.com/oxidecomputer/omicron/issues/8148)

> I don't have a strong opinion on how important it is to say which disk is
> the boot disk — if it's not that important, it would be a lot easier not
> to bother making the distinction in the UI…
> — [omicron#1417](https://github.com/oxidecomputer/omicron/issues/1417)

### 6. When listing options, give each a quick honest assessment

Options sections are a recurring shape: bullet per option, each with a
short pro/con. Do not list options without commentary. Do not pretend
they are equivalent if they are not — flag the leaning.

From [dropshot#199](https://github.com/oxidecomputer/dropshot/issues/199):

> - Order of route registration
>   - Simple to implement … and to understand
>   - Too easy to accidentally mess up the logic by moving routes around
> - Specificity of matching
>   - Request to `/abc/def` goes to the exact match because it ranks
>     higher than a wildcard match
>   - … less error-prone than changing it by shuffling things around.
>     However, it has the similar problem that deleting a more specific
>     route can cause a wildcard to start matching requests it didn't
>     match before.

From [omicron#430](https://github.com/oxidecomputer/omicron/issues/430):

> This is the solution @zephraph and I lean toward, though to make it
> really clean we would want…

### 7. State priority and scope plainly, including when low

Open low-priority issues without overselling. Never inject manufactured
urgency ("this is critical", "high priority", "we really need").

> **TL;DR:** this is not very high priority because the upshot of the
> below discussion is that things are already working basically the way
> they're going to work.
> — [console#1034](https://github.com/oxidecomputer/console/issues/1034)

> This is the lowest-priority part of the token work collected in #8138.
> It is not load-bearing.
> — [omicron#8148](https://github.com/oxidecomputer/omicron/issues/8148)

### 8. Cross-link related issues and PRs liberally

A typical body pulls in 1–4 cross-references to related issues, PRs, or PR
comments. The user expects readers to follow them rather than retelling the
context. Bare `#NNNN` references for same-repo issues, full URLs across
repos.

### 9. Bug reports: situation + hypothesis + evidence

Shape: one-paragraph statement of what is wrong, then a permalink or
screenshot/video, then optionally a brief hypothesis about root cause and
what was already ruled out. Do not impose a "Steps to reproduce / Expected
/ Actual" structure — the prose just says what is happening.

Examples: [console#1469](https://github.com/oxidecomputer/console/issues/1469),
[console#2096](https://github.com/oxidecomputer/console/issues/2096),
[omicron#6406](https://github.com/oxidecomputer/omicron/issues/6406).

### 10. Punch-list and tracking issues are their own genre

When the issue *is* a checklist (`Tracking: …`, `… polish`), the body is
just the checklist. Each item is short and links to the originating PR
comment, screenshot, or sub-issue. No descriptive prose around it.

Examples: [console#3087 — Light mode polish](https://github.com/oxidecomputer/console/issues/3087),
[console#2968 — Tracking: local disks UI](https://github.com/oxidecomputer/console/issues/2968).

### 11. Quote source material verbatim for discussion summaries

When the issue summarizes a chat or meeting, embed blockquoted excerpts
with attribution rather than paraphrasing, and link the original
discussion (matrix.to, RFD URL, PR comment URL).

### 12. Voice: first-person, conversational, dry

Sentences feel like a colleague talking to a colleague. Em-dashes,
parentheticals, contractions, "I think", "maybe", "eh". No exclamation
points, no all-caps, no adversarial framing of the bug or the system.
Slight self-deprecation is fine when warranted. Questions are framed as
joint problem-solving.

## External-repo adjustments

When filing on a repo outside oxidecomputer:

- Follow the project's `ISSUE_TEMPLATE` if one exists. Fill the fields, but
  keep the prose in the voice above. Do not generate template headings the
  project does not already require.
- A short, sincere friendly opener is appropriate on a first interaction
  with a project ("excited about this project", brief praise for the tool
  before getting into the bug). Skip on internal issues.
- Offer to PR when the fix is small and the cause is identified.
- For library bugs, lean hard on minimal standalone repros (Stackblitz,
  CodeSandbox, Tailwind playground). Repro effort scales with how much
  action is wanted from a stranger.
- Include a short "Real-world impact" paragraph when the bug needs
  prioritization context — concrete downstream breakage, not vague pleas.

## Anti-patterns (do not produce these)

- Fixed section template: "## Description / ## Steps to reproduce /
  ## Expected behavior / ## Actual behavior / ## Acceptance criteria".
- "## Background" that just restates the title in three sentences.
- "## Acceptance criteria" bullet list tacked on at the end.
- "## Tasks" with `[ ]` checkboxes, except on tracking/punch-list issues
  where the checklist *is* the issue.
- Restating the title in the body's opening line.
- Manufactured urgency or selling language.
- Headings on a 200-char ask.
- Pasting large blocks of code instead of permalinks.
- A full design proposal when the issue's job is to surface a question —
  naming the question and a leaning is usually enough.
- Trailing summary or "Let me know what you think" filler.

## Output format

When invoked, produce the title on the first line. If there is a body, put it
after a blank line. Do not add labels like `Title:` or `Body:` for ordinary
non-empty issues. Do not wrap the draft in explanatory commentary like "Here's
a draft"; output the issue text itself.

If the issue should have no body, output:

```
<title>

Body: empty
```

If asked to file directly via `gh issue create`, ask the user to confirm
the title and body first.
