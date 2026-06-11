---
name: write-pr
description: Draft a GitHub PR description in the user's voice. Use when the user asks for help writing or revising a PR title or body.
user_invocable: true
---

# Skill: Write a PR description in the user's voice

LLMs default to PR bodies that inventory the diff: "## Summary / ## Changes /
## Test plan" boilerplate, bullet lists restating what each file does, selling
language about how thorough the work was. The user does not write that way.
The examples below are complete bodies of his merged PRs, drawn from a corpus
of ~435 across oxidecomputer/console, omicron, docs, and dropshot. **Imitate
the examples; the rules after them are commentary.** Code-citation
conventions (bare commit-pinned permalinks on their own line, with line
ranges) are shared with the write-issue skill.

## Before drafting

- Read the actual diff (`jj dt` in jj repos) and any linked issue. The body
  should reflect what the change is, not a summary of the session that
  produced it.
- Produce title and body for review; do not post without confirmation.

## Examples by genre

**Provenance one-liner** — most PRs. The body locates the change among
related work and stops.

> `sort_by=ascending` makes no sense, should be `sort_by=time_and_id_ascending`. My bad! Noticed while working on #7339.
> — [omicron#8615](https://github.com/oxidecomputer/omicron/pull/8615)

> Saw this while doing #3146, didn't want to add to that diff.
> — [console#3152](https://github.com/oxidecomputer/console/pull/3152), "minor: move ip pool page table columns out to static var"

> 7 release was accidental.
> — [console#3141](https://github.com/oxidecomputer/console/pull/3141), "Downgrade design-system to 6.0.1"

**Root cause in a few sentences** — the body is the explanation the diff
can't show, plus an aside telling the reviewer what to skip.

> The inline script was being blocked on Vercel by CSP like it would in prod. Moving it to a separate file fixes this. Ignore the debug-e2e skill, I just had that in flight and it feels stupid to make a separate PR.
> — [console#3093](https://github.com/oxidecomputer/console/pull/3093), "Fix theme flash"

> Closes #10274
>
> `test_audit_log_basic` takes `Utc::now()` timestamps before and after DB operations and asserts that the timestamp on the audit log entry falls between them. But `Utc::now()` has nanosecond precision and CockroachDB truncates to microseconds, so if `t1` is `19:16:44.154913040` and the audit log entry was written at `.154913999`, the value read back from the DB would be `19:16:44.154913`, which is before `t1`. Use `now_db_precision()` so the test timestamps have the same precision as the DB. The comparisons were already `t1 <= log_time`, so they will work if they're equal.
> — [omicron#10276](https://github.com/oxidecomputer/omicron/pull/10276)

**Before/after screenshots** — for visual changes the screenshots are the
whole body ([console#2927](https://github.com/oxidecomputer/console/pull/2927)):

> ### Before
>
> *[screenshot]*
>
> ### After
>
> *[screenshot]*

**Fix with measurements** — the claim, then the evidence pasted in, then the
experiment that didn't make the cut
([console#2506](https://github.com/oxidecomputer/console/pull/2506), "How
about we don't hold the entire image in memory"):

> Closes #2270
>
> Reduce `gcTime` on upload chunk React Query mutation from default of 5 minutes to zero.
>
> As I say in the comment, I don't even understand why the mutation cache exists — it's not like we're reading from it. The query cache is a different story. So I don't see a downside to turning it off for this mutation. I have asked about in the Tanstack Discord and on Twitter, so I'll see if anything helpful comes out of that.
>
> https://tanstack.com/query/v5/docs/reference/MutationCache
>
> ### Before
>
> Taking some snapshots in FF throughout a big upload. Memory goes up and up.
>
> *[screenshot]*
>
> ### After
>
> Memory fluctuates around a relatively small value, consistent with GC functioning as desired.
>
> *[screenshot]*
>
> ### With shorter but non-zero `gcTime`
>
> As a test, I set `gcTime: 60000` (1 minute) and saw as expected that memory use still plateaus, but at a higher number because it holds onto everything it can process in one minute.
>
> *[screenshot]*

**Feature: lead with the interesting bit** — one word of self-assessment,
then the design point worth a reviewer's attention, then screenshots
([console#3238](https://github.com/oxidecomputer/console/pull/3238)):

> Straightforward. The interesting bit here is the addition of an `msw-flags` cookie that we can use in the test to flip `contact_support: true` instead of hang it off a particular test user, which I tried and felt wrong. We can also use it for the jumbo frames setting in #3235 until we have an operator UI for flipping the setting (which we should probably have?)
>
> ## `contact_support: false`
>
> *[screenshot]*
>
> ## `contact_support: true`
>
> *[screenshot]*

**Feature: decision list** — when parts are enumerated, each bullet is a
behavior choice with its reason, never a file walk
([dropshot#1448](https://github.com/oxidecomputer/dropshot/pull/1448)):

> Closes #221
>
> * Compression is opt-in: `compression` config field defaults to `CompressionConfig::None` to avoid behavior changes on upgrade
> * Compression depends on `Accept-Encoding` request header (with RFC 9110 quality factor support) and the MIME type matching a list of compressible types (JSON, ndjson, text/*, XML, JavaScript, and RFC 6839 structured suffixes like +json/+xml). SSE (text/event-stream) is excluded to avoid adding latency.
> * `Vary: Accept-Encoding` header is added to all compressible responses, even when compression isn't applied, for correct cache behavior
> * Don't bother compressing responses where we know the size and it's less than 512 bytes
> * `NoCompression` extension lets an endpoint opt out of compression

**Long investigation** — rare (~6% of bodies exceed 1500 chars).
[console#2614](https://github.com/oxidecomputer/console/pull/2614) ("Fix
e2e flake by not consuming abort signal in `apiq` query options helper")
opens with a complete short explanation and layers in depth under headings
"Short version", "Medium version", "The story of my pain", with a stack
trace in a `<details>` block. The opening:

> Passing React Query's abort signal into our API `fetch` calls means the calls get aborted when queries get canceled due to being unmounted. One inconvenient time for this to happen is when React [Strict Mode](https://react.dev/reference/react/StrictMode) does its thing in dev mode, causing an unmount and remount in the middle of a prefetch in a loader, which doesn't itself blow up because `prefetchQuery` eats errors, but components that expect prefetched data do blow up because the prefetch failed to populate the query cache. There isn't much advantage to canceling queries, so we can fix this by just not passing the signal through.

**Announcing a new capability** —
[docs#842](https://github.com/oxidecomputer/docs/pull/842) introduces a new
tool to readers who don't share context, so the body is long: demo commands
and sample output first, then explanation and measured results, with the
bulk in 🤖 `<details>` blocks. It opens:

> This PR adds a prose style review skill meant to be used with Claude Fable 5. It flags awkward or unclear phrasing and suggests improvements. In my testing it works quite well. You could imagine this running automatically on PRs, but for now the idea is you can manually run something like this in Claude Code: *[commands, then sample output in a details block]*

## Rules

### 1. Length tracks the reader's missing context; say why, not what

Most PRs are routine work among colleagues who share context, so most bodies
are short: of ~435 merged PRs, ~10% have empty bodies, more than half are
under 600 characters, and only ~6% exceed 1500. The typical body is one to
three sentences of context the diff can't show — motivation, provenance,
root cause — and stops there. Empty bodies are fine for chores whose title
says it all ("npm audit fix"). The statistic describes how often PRs are
routine, not a ceiling — see docs#842 and console#2614 above.

Length norms apply to the prose every reader is expected to read.
Supplemental material — logs, sample output, stack traces, deep dives —
goes in `<details>` blocks and has no practical length limit: a short body
plus long collapsed sections is still a short body.

### 2. Open with provenance

"Closes #N" starts one in six PRs. Stock moves: "Followup to #2529",
"Extracted from external subnets work coming in #3039", "Same as #10482 but
for Image", "Built on #8842", "Suggestion from @charliepark in <link>",
"Noticed the mismatch while updating console". Cross-link liberally; readers
follow links rather than have context retold.

### 3. Show evidence, don't characterize it

Claims about size, speed, or behavior come with the real artifact pasted in:
SQL output from dogfood/colo, a benchmark table, the CI failure log, the
OpenAPI schema diff, screenshots. Docs and console PRs link the Vercel
preview deploy near the top.

### 4. Reactions and open questions are the user's

The candor in the examples ("it felt terrible", "My bad!", "which we should
probably have?") comes from what the user actually said or did during the
work. Do not invent reactions or uncertainty to sound candid; if the draft
has none, leave room rather than synthesize. Open questions are hedged
honestly; settled conclusions are asserted plainly.

### 5. Plain causal statements over clever compression

Prefer a sentence that names the actual concern ("this makes it cheap to run
despite the model being expensive per token") over a compressed-clever clause
("cheap enough to fan out one per batch"). If a phrase is doing style work
instead of informing, unpack it or cut it.

### 6. Headings are rare, conversational, and earned

Only ~13% of bodies have headings at all. Routine uses: `### Before` /
`### After` and labels for pasted evidence ("Schema diff", "Tunables",
"Table size on colo"). In long bodies they are specific and often wry ("The
story of my pain", "What about the linter", "Concerns and future plans").
Never generic scaffolding ("Overview", "Implementation details", "Testing").

### 7. Long supporting material goes in `<details>` blocks

Real uses: a stack trace, the full commit list behind a changelog, extra
screenshots of a rejected design, "Original PR description" preserved when
the PR pivoted after review, "Robot notes on the API logic behind
`contact_support`". Mark machine-generated content with a 🤖 prefix in the
summary line. The body proper reads complete without opening any of them.

### 8. Titles

Descriptive declarative or imperative: "Fix theme flash", "Don't show
fractional bytes in file size display", "Let clients request gzipped
responses from the external API". About a quarter carry a lowercase
downplaying prefix — `minor:`, `trivial:`, `chore:`, `tools:`, `mock API:` —
signaling review effort required, and omicron PRs often take a bracketed
component prefix (`[nexus]`, `[api]`). Stacked series get explicit numbering:
"audit log creds [3/3]". An occasional small PR gets a playful full-sentence
title ("How about we don't hold the entire image in memory"). Never
"Feature:"/"Fix:" category prefixes.

## Anti-patterns (do not produce these)

- "## Summary / ## Changes / ## Test plan" scaffolding.
- Bullet list that walks the diff file by file, restating what the code
  already shows.
- Selling the work ("comprehensive", "robust", "significantly improves").
- Hedging on the author's own conclusions or standing.
- Characterizing evidence instead of pasting it.
- Trailing "Let me know what you think" / summary paragraph.

## Output format

When invoked, produce the title on the first line and the body after a blank
line, with no `Title:`/`Body:` labels and no surrounding commentary. If the
body should be empty, say so. If asked to open the PR directly, confirm the
title and body first.
