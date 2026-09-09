---
name: prose
description: "Review/edit a markdown draft in a local browser connected to this session: live preview, selection comments, general conversation, and agent activity. Use when the user wants to iterate on prose visually, or says /prose."
---

# Prose GUI

Iterate on a markdown draft through a local browser page instead of chat
round-trips. The `prose` server (dotfiles `bin/prose.ts`) serves a live
GitHub-style preview of a file plus a collapsible pane running real helix on
that file (hx in a pty, rendered by xterm.js); the user highlights text and
comments, and each comment reaches this session as a Monitor event. The file
on disk is the single source of truth: helix auto-saves shortly after typing
stops, and the page picks up every disk change live, flashing what changed.
Keep editing the file normally with Edit.

## Setup

1. Write the draft to a markdown file if it isn't in one already. Default
   location: `.claude/notes/<YYYY-MM-DD>-<slug>.md` in the repo being worked
   on. For a PR description, end the slug with `-pr` and put the title on
   line 1 as a `#` heading: `jprc --body` finds the newest `*-pr*.md` there
   and uses that line as the PR title. This file is the single source of
   truth from now on — edit it in place; do NOT paste draft revisions into
   chat.
2. Start the server and arm the comment feed in the same turn: the server
   binds its port immediately, so the Monitor can connect without waiting
   for confirmation output. Don't sleep, tail the output file, or poll
   `/activity` first. If the Monitor fails to connect, the server didn't
   start; read its output then.

   The server must run OUTSIDE the Bash sandbox — the sandbox blocks binding
   ports, and it also blocks connecting to localhost, so the `curl` calls to
   `/activity` below need the same treatment:

   ```
   prose <path-to-draft.md>
   ```

   Options: `--port <n>` (default 4917, pick another if taken), `--no-open`
   (by default it opens the user's browser). Run it with `run_in_background`.

   The Monitor (persistent, survives until session end):

   This connection is for a harness with a persistent Monitor tool. If that
   tool is unavailable, the editor still works and messages are saved, but
   they cannot wake this session automatically. Report that limitation; do
   not leave a dummy socket connected and imply an agent is listening.

   On connect, the server replays every request still in `waiting` state, so
   comments typed before the Monitor was armed arrive as normal events. A
   replayed event for a request you have already started is a reconnect
   echo; ignore it. Requests left `interrupted` by a previous session are
   not replayed: when attaching to an existing draft, read `GET /activity`,
   check those against the current file, and resume or finish them with a
   fresh `start`. Completed requests must not be processed again.

   ```
   Monitor({
     ws: { url: "ws://localhost:<port>/claude" },
     description: "prose review comments for <file>",
     persistent: true,
   })
   ```

3. Tell the user the page is up (one line, no walkthrough of the gestures;
   they know the tool), then end the turn. Comments wake the session as
   Monitor notifications.

## Handling events

Each event is one JSON object:

```json
{"id": "...", "kind": "message" | "comment" | "dellm" | "file-edit",
 "selection": "...", "prefix": "...", "suffix": "...", "text": "...",
 "replyTo": "optional earlier request id", "file": "...", "ts": "..."}
```

- Before handling a request, post `start`; when finished, post your answer or
  edit summary with `done`. See **Replies and activity** below. File-edit
  notices alone do not start work or need replies. For quick work (a short
  answer, a one-line edit), do `start`, the edit, and `done` in one Bash
  call rather than three turns; the spinner is for work that takes a while.
- `kind: "message"` is general conversation, with no selection. Answer a
  question in the page's conversation without changing the document. Edit
  only when the message requests an edit. Use ordinary intent; there is no
  Ask/Edit mode switch. A `replyTo` identifies an earlier request whose
  clarification the user is answering: include both unfinished request IDs
  when starting and completing that work.
- Locate the anchor: `selection` is the highlighted text as rendered;
  `prefix`/`suffix` are up to 60 chars of surrounding rendered text to
  disambiguate repeats. Rendered text closely matches markdown source for
  prose; account for stripped formatting characters when matching.
- `kind: "comment"` — `text` is the user's note about the selected passage.
  If it's an instruction, apply it by editing the file; if it's a question,
  see the next bullet. The selection is an anchor, not
  the boundary of the request: work out what the comment is trying to
  accomplish and use your judgment about how far it reaches — the selection
  itself, a larger section, or the whole document. Don't turn a local note
  into a general rewrite.
- Questions are questions, not edit requests. A comment phrased as a
  question ("why is this here?", "is this still true?", "what does X mean?")
  wants an answer in the page, with the selection as context. Answer it and
  leave the document alone. Edits come from imperatives ("cut this",
  "tighten", "make this match the intro"). If the answer reveals the text is
  wrong, say so in the reply and offer the fix, but don't apply it unasked.
- When you can't tell what the user means, ask in the page and hold off on
  editing; they'd rather clarify than untangle a wrong guess.
- `kind: "dellm"` — `text` is optional extra guidance. Rewrite the selection
  to sound like a person:
  plain, concrete, flowing prose. Remove LLM-isms — formulaic rhetorical
  gestures, "that's X, not Y" constructions, jargon like "downleveling",
  em-dash chains, fake gravity. Match the register of the surrounding text.
  Keep the meaning; don't pad. As with comments, if the identical tic
  recurs elsewhere in the document, fix it there too.
- `kind: "file-edit"` — the file changed on disk since the last comment:
  the user's helix saves, or your own edits echoed back. `old`/`new` give
  one splice covering everything that changed in that window. If they match
  changes you just made, ignore the event. Otherwise absorb silently: update
  your mental model, don't revert or "improve" the user's phrasing, don't
  reply. If an Edit fails to match afterwards, re-read the file. Edit notices
  never wake the session on their own — they arrive only right before a
  comment they may be context for.
- Prose configures the local Helix fork to auto-reload external edits and
  merge them with unsaved text. If a pane remains stale, `:reload` is the
  manual fallback. Do not force-write over the user's unsaved changes.
- After editing the file, the page live-updates on its own and flashes the
  changed blocks. Post a short completion summary to the page. General
  answers can be longer and use Markdown. Keep prose-related replies in the
  page rather than requiring the user to switch back to the TUI.
- Comments are also logged to `~/.local/state/prose/` (one file per draft,
  named by the draft's absolute path with slashes flattened; the server
  prints the exact path on startup). If the Monitor was armed late or the
  session restarted, check that file for unhandled comments.

## Replies and activity

Post JSON to `http://localhost:<port>/activity`. The page displays replies
as toasts and retains them in expandable history. `GET /activity` returns
the history and request states. Agent activity is never echoed to Monitor.

Choose a fresh `workId` for each work attempt, and use the incoming request
IDs in `requestIds`. A batch may cover several requests. Start before editing
or answering; finish only the requests that were actually handled. These
examples use `r1` and `w1`; replace them with the request ID and your work ID.

```sh
curl --fail-with-body --silent --show-error \
  --header 'Content-Type: application/json' \
  --data-binary @- http://localhost:<port>/activity <<'JSON'
{"phase":"start","requestIds":["r1"],"workId":"w1"}
JSON
```

Then edit the file or prepare the answer and post the result:

```sh
curl --fail-with-body --silent --show-error \
  --header 'Content-Type: application/json' \
  --data-binary @- http://localhost:<port>/activity <<'JSON'
{"phase":"done","requestIds":["r1"],"workId":"w1","text":"Updated both callers to use the same lower bound."}
JSON
```

Use `progress` with optional text for a meaningful intermediate update,
`needs-reply` with a question when waiting for the user, or `error` with an
explanation when work cannot continue. All take the same `workId` and
`requestIds`. A `reply` with text can be posted during work without ending
it, or with `requestIds: []` for a standalone prose-related message.

The spinner starts only on `start`; `done`, `needs-reply`, or `error` clears
that work. Long silent runs show "No recent update" after two minutes, so
post progress during longer work. Restarted work needs a fresh `start`.
There is no token-level streaming or automatic mirroring of TUI messages.

If a completion POST fails, retry delivery rather than repeating edits. After
a session restart, inspect the file and request state before resuming an
interrupted request. Compose JSON with a serializer for long replies; avoid
manual escaping of arbitrary message text.

## Embeds

The preview expands the same bare URLs GitHub does in issue and PR bodies:

- A blob permalink with a line range on its own line
  (`https://github.com/o/r/blob/<sha>/path#L10-L20`) renders as a code
  snippet with line numbers and highlighting. Use full commit shas: contents
  are cached forever under `~/.cache/prose/blobs/` since a sha is immutable.
  Branch refs work but are refetched on every render.
- A `github.com/user-attachments/assets/<id>` URL on its own line renders as
  an image or video. Only public-repo assets load; private ones are gated on
  a browser session, so the preview shows the error and the bare link.
- Images and videos referenced by local path (`![](shot.png)`,
  `<img src="shot.png" width="600">`) are served from disk, relative to the
  draft's directory or absolute, for checking layout before uploading.
  GitHub has no API for issue attachments, so at filing time the user drags
  each file into the GitHub editor in place of its path. When wrapping up,
  point out any local paths still in the body.

A selection inside an embed carries an extra `embed` field with the URL that
produced it, alongside the selected rendered text in `selection`. That text
isn't in the markdown, so use judgment about what the comment is about: the
embed itself ("show lines 300-320", "link the whole function"), the prose
around it, or the code it points at ("this is wrong, we should fix it in the
PR" is a request to change the source, not the draft).

## User-facing gestures (for reference, not to recite)

- Select text → popover → type comment → ⌘⏎ or Send
- Bottom-right button opens conversation history and a general-message input.
  It spins while the agent is working. Collapsing hides the input and keeps
  unsent text; incoming replies appear as toasts without stealing focus.
- The popover's de-LLM button sends "make this passage sound human" — no
  typing needed; typed text rides along as extra guidance
- ⌘E (or the ✎ button, top right) toggles the helix pane: real `hx` with the
  user's normal config and Steel setup, plus auto-save (650ms after typing
  stops, and on focus lost). It starts on first show and keeps running while
  hidden. Browser ⌘-chords don't reach helix (the browser owns them), so
  Cmd-key helix bindings don't work there; everything else does.
- The page live-updates whenever the file changes on disk, flashing what
  changed
- `prose-tab <file>` is the all-terminal alternative: a Ghostty tab with
  helix on the left and the preview (served with `?preview`, no embedded
  editor) rendered by terminal-browser on the right. Same server, same
  comment feed.

## Restarting the server

When iterating on prose's own client code, the server reads its CSS and
bundle once at startup, so a restart is needed. Do it in two turns: one
TaskStop call for the server task and one for the Monitor together, then the
server launch and a new Monitor together. Restarts mark in-flight work
`interrupted`, so finish it with a fresh `start` after reconnecting.

## Wrapping up

When the user says they're done, read the final file and use it for whatever
comes next (e.g. `gh pr edit --body-file`). Stop the server task (TaskStop)
and the Monitor when the review is over. This skill composes with `write-gh`
(if installed): draft with that, review with this.
