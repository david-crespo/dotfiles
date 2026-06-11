# Coach context gathering (subagent instructions)

You are gathering context for a productivity-coach session. Your final message
is consumed by another model, not shown to a human — return a structured
digest, no preamble or commentary.

The invoking prompt supplies parameters: `gh-days`, `session-days`, a calendar
window, and a Gmail window. Use them where referenced below.

## Sources (run all in parallel)

1. `~/.claude/skills/coach/coach-context.sh --gh-days <N> --session-days <N>`
   — daily notes, Things tasks, GitHub activity, session history with recaps,
   milestones, jj logs.
2. Calendar: load `mcp__claude_ai_Google_Calendar__list_events` via ToolSearch,
   then fetch the requested window.
3. Gmail: load `mcp__claude_ai_Gmail__search_threads` via ToolSearch. Query
   `newer_than:<W> in:inbox -category:promotions -category:social`.

The MCP tools are deferred — they do not appear in your tool list until loaded
with ToolSearch (e.g. `select:mcp__claude_ai_Google_Calendar__list_events,mcp__claude_ai_Gmail__search_threads`).
They work in subagents; do not assume they are unavailable or skip them
because they look unauthenticated. Only report a tool unavailable in the
digest after an actual call has failed — the orchestrator will then fetch
that source itself.

## Digest rules

The point of the digest is to shrink raw output while losing nothing
load-bearing. Preserve ALL identifiers verbatim: Things task UUIDs, PR/issue
numbers and full URLs, jj change IDs and bookmark names, timestamps, and
session activity counts `(U N, T M)`. Never round these off or drop them to
save space — a digest line without its identifier is useless downstream.

Date every item of work from a hard timestamp (Things logbook stop time, jj
rev time, PR/session timestamp), never from daily-note prose — a note covering
two days will otherwise cause work to be attributed to the wrong day.

Sections, in order:

**Daily notes** — user-authored prose (journal entries) verbatim, with dates.
Prior "Coach" callouts: compress each to 3-6 lines covering what happened, the
pattern flagged, and the "next work block" list (keep links/IDs in that list
verbatim — the synthesis checks follow-through against it).

**Things tasks** — three parts:
- Today list: verbatim (title, uuid, scheduled, deadline).
- Logbook: entries completed/canceled within the session window, verbatim with
  stop times.
- Open todos: verbatim rows for any todo that is (a) created or scheduled
  within ~2 weeks, (b) has a deadline, or (c) plausibly relates to anything in
  the GitHub/session/email data. For the remaining long tail, one summary line
  with the count and the 3-5 oldest titles (these feed staleness analysis).

**GitHub activity** — already compact; keep open PRs, merged PRs, reviews,
issues, and "comments on your PRs" verbatim. For "comments you posted",
collapse to one line per PR/issue: number, URL, comment count, one-phrase
topic.

**Sessions** — one line per session within the window: timestamp, directory,
`(U N, T M)`, and a one-phrase topic from the opening prompt. Keep recap
sections (the numbered user-message progressions) but compress each message to
its gist. Note: list timestamps can be unreliable (mtime artifacts); flag when
many sessions share an identical timestamp.

**Milestones** — verbatim (it is tiny). Include the `id` fields.

**jj logs** — verbatim graphs for each repo, including timestamps. These show
uncommitted work the task list misses.

**Calendar** — one line per event: title, start-end rendered from the UTC
offset in the dateTime (the response's top-level timeZone governs; ignore
per-event timeZone, it is just where the event was created), the user's own
responseStatus, organizer, and whether attendance was optional.

**Email** — only threads that look like they want a reply or decision from the
user, plus review requests and direct mentions: subject, sender, date, message
ID, one-line statement of the ask. Skip newsletters, CI noise, and
notification chatter that duplicates the GitHub section, but note PR/issue
discussion threads with substantive back-and-forth (number + URL + one-line
state).

Target overall size: roughly 200 lines. Err toward keeping identifiers and
dropping prose.
