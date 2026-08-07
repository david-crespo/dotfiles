---
name: meeting
description: Locate a meeting recording or transcript given a description of it (title, approximate time, attendees). Resolves the calendar event via the Google Calendar MCP, finds the matching entry in four-star, and fetches the transcript Doc via the Google Drive MCP. When a meeting has no transcript, hands the user a download link for the recording and transcribes it locally with MacWhisper's mw CLI.
---

# meeting

`four-star` indexes Oxide meeting recordings and transcripts
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

   **If the calendar has no such event, keep going.** Recordings exist for
   meetings the user skipped or was never invited to, which is often exactly
   why they are asking. Fall through to step 2 with their literal phrasing,
   and say in your answer that the event wasn't on their calendar so the match
   is by title alone.

2. **Find the four-star entry.** Run `find.sh <YYYY-MM-DD> [title-substring]
   [--widen N]` (next to this SKILL.md), passing a distinctive substring of the
   *resolved* title from step 1. Always pass a substring — without one it dumps
   every recording in the window, which is dozens of JSON objects. `--widen`
   may go before or after the substring. It lists recordings in a ±1-day window
   around the date
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

   A `search_files` miss returns a bare `{}`, not an empty `files` array —
   that's a clean negative, not an error. Before concluding no transcript
   exists, re-run with a looser `title contains 'Foo - 2026/04/24'`: exact-title
   match fails identically whether the Doc is absent or its title differs by one
   character, and only the looser query distinguishes the two.

   Fallback if no Drive MCP is available: `search --q "<distinctive phrase>"`
   returns `transcript_matches.blocks[].lines[]` with `speaker`/`line` fields
   around the query hit. Matched terms are wrapped with `__fstr_S__` /
   `__fstr_E__` markers — strip before display.

4. **No transcript anywhere → transcribe locally.** Only after step 3's Drive
   title search comes up empty. A null `transcript_external_id` is *not*
   sufficient evidence — the Doc often exists unindexed, and the title search
   finds it. Local transcription is the last resort. See below.

## Local transcription

The download needs one human click (see "Why" below), so drive it as a
conversation rather than trying to automate it:

1. Get the download link and the filename Chrome will save it as:

   ```bash
   four-star -f json get --id <recording_id> \
     | jq -r --arg dir "$HOME/Downloads" \
         '.links.download,
          ($dir + "/" + (.name | gsub("[/:]"; "_")) + ".mp4"),
          .recording_external_id,
          "downloadable=\(.downloadable) shared=\(.shared)"'
   ```

   Check `downloadable` and `shared` before handing over a link — those are the
   access signal for the recording, and unlike a transcript Doc the user may
   well not have attended.

2. Give the user the link as a clickable markdown link and tell them to click
   **Download anyway** on the virus-scan page. Warn about the size if it's
   large: pass `recording_external_id` as the fileId to `get_file_metadata`.

3. **End the turn there.** Do not poll and do not run anything in the
   background — the wait is unbounded and entirely up to the user. They will
   say when the download is done.

4. Transcribe with MacWhisper's `mw` CLI, then read the `.txt`:

   ```bash
   f="<path from step 1>"
   mw transcribe --persist --speakers --overwrite --output "${f%.*}.txt" "$f"
   ```

   `--persist` also saves it to MacWhisper's history, so it can be opened in
   the mw UI. Transcription is fast — a fraction of the meeting's length.

If the path from step 1 doesn't exist after they confirm, look for the newest
`.mp4` in `~/Downloads` before giving up; Chrome may have altered the name to
avoid a collision.

Speakers are diarized but unnamed — output is labeled `Speaker 1`, `Speaker 2`.
Leave those labels as they are. Do not map them onto attendees from the
calendar invite: diarization splits on voice, not identity, and a confident
misattribution of a technical claim to a named colleague is worse than an
unlabeled quote. Only name a speaker when the audio itself identifies them
(an introduction, someone addressed by name), and attribute it to that.

### Why the download needs a human

Drive download links (`Meeting.links.download`) require a Google session, and
recordings run 500 MB–2 GB, past the 100 MB threshold where Drive interposes a
"can't scan for viruses" page with a confirm button. Neither part is
automatable from here:

- `curl` without a session 302s to `accounts.google.com`.
- The Drive MCP's `download_file_content` returns the file as base64 **in the
  tool result**, i.e. into the context window. Fine for a Doc or a chat log,
  hopeless for a 650 MB video. There is no output-path parameter.
- Clicking the confirm button needs a channel into the user's Chrome window.
  AppleScript `execute javascript` is disabled by default, System Events UI
  scripting needs Accessibility permission, and DevTools-protocol tools
  (Playwright, chrome-devtools MCP) launch a fresh profile that is not signed
  in. `&confirm=t` no longer bypasses the page.

A Drive-scoped OAuth token would sidestep all of this — `GET
/drive/v3/files/{id}?alt=media` has no interstitial — but there is no
first-party CLI to mint one (`gcloud` is GCP-only; Drive is a Workspace API),
so it means rclone or a hand-rolled OAuth client. Deliberately not done: one
click per meeting is the accepted tradeoff.

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
  This is the normal case, not an error; fall through to local transcription.

## Source

Source lives at `~/oxide/four-star`. OpenAPI spec at
`~/oxide/four-star/meeting-api-spec.json` is the reference for API shapes.
Available endpoints: `/meeting`, `/meeting/{id}`, `/search`. Nothing else
exposes transcripts.
