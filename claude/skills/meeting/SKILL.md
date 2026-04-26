---
name: meeting
description: Locate a meeting recording or transcript given a description of it (title, approximate time, attendees). Resolves the calendar event via the Google Calendar MCP, finds the matching entry in four-star, and fetches the transcript Doc via the Google Drive MCP.
---

# meeting

`four-star` (binary: `star`) indexes Oxide meeting recordings and transcripts
from Google Drive. Typical ask: "look at the transcript of my meeting with
Peter earlier" or "find the recording of last week's product eng sync."

four-star locates the recording/transcript metadata; full transcript content
is pulled from Google Drive via the Drive MCP (four-star itself doesn't
expose transcript text).

The CLI and API have several rough edges (see "Known issues" below). Note them
in-line when they affect the answer, but do not try to work around them beyond
what this skill documents and do not open PRs against
`~/oxide/four-star`.

## Workflow

1. **Resolve the meeting via Calendar MCP — always.** Never assume the user's
   phrasing is a substring of the recording title. Use Google Calendar MCP
   tools to find the event from whatever the user gave (title keywords, rough
   time, attendees, topic) and extract the canonical title and UTC start date.
   This step is mandatory even when the description looks like a title — the
   user might say "the product meeting" for an event titled "Product
   Roundtable," or "my meeting with Curtis" for an event with no useful title
   keyword at all. Without resolving first, title-substring matching against
   four-star is unreliable.

2. **Find the four-star entry.** Run `find.sh <YYYY-MM-DD> [title-substring]`
   (next to this SKILL.md), passing a distinctive substring of the *resolved*
   title from step 1. It lists recordings in a ±1-day window around the date
   (widen with `--widen N` if needed), filters by title substring, and prints
   a JSON array with `name`, `created_at`, `recording_id`,
   `transcript_external_id`, and the drive link. Auth failures surface as
   four-star's own "Not authenticated" stderr message with a non-zero exit;
   `transcript_external_id` is null when not indexed.

3. **Fetch transcript text.** four-star itself exposes no endpoint for full
   transcript retrieval — only cropped `transcript_matches` snippets via
   `/search`. Instead, take the `transcript_external_id` from step 2 and pass
   it to the Google Drive MCP `read_file_content` tool. Transcript docs are
   Google Docs; the MCP returns speaker-tagged text directly. Access works as
   long as the user's Google account can open the Doc (typically the case for
   meetings they attended).

   When `transcript_external_id` is null, the recording's `name` still pins
   down the transcript Doc precisely. Meet names paired Docs identically
   except for the trailing word: replace `- Recording` with `- Transcript`
   and search Drive by that exact title (e.g. `title = 'Foo - 2026/04/24
   09:58 PDT - Transcript'`). The recording's timestamp prefix makes this
   unique even for recurring meetings, so prefer it over re-deriving a title
   from the calendar event.

   Fallback if no Drive MCP is available: `search --q "<distinctive phrase>"`
   returns `transcript_matches.blocks[].lines[]` with `speaker`/`line` fields
   around the query hit. Matched terms are wrapped with `__fstr_S__` /
   `__fstr_E__` markers — strip before display.

## Commands cheatsheet

Run `four-star <cmd> --help` for full options.

```bash
four-star self                                   # auth preflight
four-star -f json list --newer D --older D --limit N
four-star -f json get --id <recording_id>        # single meeting
four-star -f json search --q "<text>" --limit N  # full-text across chat + transcript
```

Output format flag (`-f json` or `-f tab`) must come *before* the subcommand.
`--limit` goes after.

## JSON shapes

Meeting (from `list` / `get`):

```
name, recording_id, recording_external_id, recording_owner_id,
created_at, external_modified, downloadable, shared, links
links: {download, drive, embed, thumbnail}
```

Optional, only present when populated:
```
chat_id, chat_external_id, chat_owner_id,
transcript_id, transcript_external_id, transcript_owner_id,
clean_name, indexed, recording_target_id
```

Search result (`search`):
```
name, date, attendees[], links
transcript_matches?: { blocks: [{ offset, lines: [{ speaker, line }] }] }
chat_matches?: ...
```

## Known issues (do not fix)

- **`list --name <str>` returns nothing.** Name filter is broken; `find.sh`
  pulls JSON by date range and filters client-side.
- **`search` sorts ascending by date with no reverse option and no date
  filter.** Top hits for common titles are always from the earliest indexed
  year. Use `list` (or `find.sh`) with date bounds for "latest X" queries;
  use `search` only when you need transcript/chat content matches.
- **No four-star endpoint returns full transcript text.** Only per-query
  snippets via `search`'s `transcript_matches`. `Meeting.links` exposes the
  recording video, not the transcript document. Work around this by pulling
  the transcript Doc directly via the Google Drive MCP (see step 3).
- **Drive download links in `Meeting.links` require a Google session**, not
  the four-star token. They 302 to `accounts.google.com`. Use the Drive MCP
  instead of fetching these URLs with curl.
- **JSON output omits null optional fields.** Absence of `transcript_external_id`
  in the output means "no transcript indexed for this meeting," which is
  common — only a small fraction of recent meetings have indexed transcripts.

## Source

Source lives at `~/oxide/four-star`. OpenAPI spec at
`~/oxide/four-star/meeting-api-spec.json` is the reference for API shapes.
Available endpoints: `/meeting`, `/meeting/{id}`, `/search`. Nothing else
exposes transcripts.
