---
name: prose
description: "Review/edit a prose deliverable (PR body, issue body, doc) in a local browser GUI wired to this session: live GitHub-style preview, selection comments, de-LLM gesture. Use when the user wants to iterate on a chunk of prose visually instead of via chat, or says /prose."
---

# Prose GUI

Iterate on a markdown draft through a local browser page instead of chat
round-trips. The `prose` server (dotfiles `bin/prose.ts`) serves
a live GitHub-style preview of a file plus a collapsible raw-markdown editing
pane; the user highlights text and comments, and each comment reaches this
session as a Monitor event. The user can also edit the draft directly in the
GUI — the server keeps the file on disk up to date with those edits, so the
file remains the single source of truth. Keep editing it normally with Edit;
the page picks up file changes live and flashes what changed.

## Setup

1. Write the draft to a markdown file if it isn't in one already. Default
   location: `.claude/notes/<YYYY-MM-DD>-<slug>.md` in the repo being worked
   on. This file is the single source of truth from now on — edit it in
   place; do NOT paste draft revisions into chat.
2. Start the server (background). It must run OUTSIDE the Bash sandbox — the
   sandbox blocks binding ports:

   ```
   prose <path-to-draft.md>
   ```

   Options: `--port <n>` (default 4917, pick another if taken), `--no-open`
   (by default it opens the user's browser). Run it with `run_in_background`.
3. Arm the comment feed (persistent, survives until session end):

   ```
   Monitor({
     ws: { url: "ws://localhost:<port>/claude" },
     description: "prose review comments for <file>",
     persistent: true,
   })
   ```

4. Tell the user the page is up and how the gestures work (see below), then
   end the turn. Comments wake the session as Monitor notifications.

## Handling events

Each event is one JSON object:

```json
{"kind": "comment" | "dellm" | "user-edit", "selection": "...", "prefix": "...",
 "suffix": "...", "text": "...", "file": "...", "ts": "..."}
```

- Locate the anchor: `selection` is the highlighted text as rendered;
  `prefix`/`suffix` are up to 60 chars of surrounding rendered text to
  disambiguate repeats. Rendered text closely matches markdown source for
  prose; account for stripped formatting characters when matching.
- `kind: "comment"` — `text` is the user's instruction about the selected
  passage. Apply it by editing the file. The selection is an anchor, not
  the boundary of the request: work out what the comment is trying to
  accomplish and use your judgment about how far it reaches — the selection
  itself, a larger section, or the whole document. Don't turn a local note
  into a general rewrite.
- A comment phrased as a question reports that the text confused a reader.
  The deliverable is an edit that makes the question unnecessary — usually
  the smallest one that does. Answer in chat only when the answer is needed
  to decide the fix; don't answer and then offer to edit.
- When you can't tell what the user means, ask in chat and hold off on
  editing; they'd rather clarify than untangle a wrong guess.
- `kind: "dellm"` — `text` is optional extra guidance. Rewrite the selection
  to sound like a person:
  plain, concrete, flowing prose. Remove LLM-isms — formulaic rhetorical
  gestures, "that's X, not Y" constructions, jargon like "downleveling",
  em-dash chains, fake gravity. Match the register of the surrounding text.
  Keep the meaning; don't pad. As with comments, if the identical tic
  recurs elsewhere in the document, fix it there too.
- `kind: "user-edit"` — the user edited the draft in the GUI; the server has
  already written their changes to the file. `old`/`new` (or a coarse `note`
  when edits interleaved) describe the change. Absorb silently: update your
  mental model, don't revert or "improve" their phrasing, don't reply. If an
  Edit fails to match afterwards, re-read the file. Edit notices never wake
  the session on their own — they arrive only right before a comment they
  may be context for.
- `kind: "file-edit"` — the file changed on disk: the user saving from an
  external editor (the terminal workflow), or your own edits echoed back —
  same delivery as user-edit, right before a comment. If `old`/`new` match
  changes you just made, ignore the event. Otherwise treat it exactly like
  a user edit: absorb silently. A `note` instead of `old`/`new` means the
  window mixed sources — re-read the file before your next edit.
- After editing the file, the page live-updates on its own and flashes the
  changed blocks. Reply in chat with at most one short line per comment (or
  nothing) — the user is looking at the page, not the transcript. If you
  edited beyond the selection, the flashes show where; a reply is only
  needed when the extra edits might surprise.
- Comments are also logged to `~/.local/state/prose/` (one file per draft,
  named by the draft's absolute path with slashes flattened; the server
  prints the exact path on startup). If the Monitor was armed late or the
  session restarted, check that file for unhandled comments.

## User-facing gestures (explain on setup)

- Select text → popover → type comment → ⌘⏎ or Send
- The popover's de-LLM button sends "make this passage sound human" — no
  typing needed; typed text rides along as extra guidance
- ⌘E (or the ✎ button, top right) toggles a raw-markdown editing pane for
  typo-grade fixes where typing beats describing; edits are saved to the
  file automatically
- When the editor is open, its mode selector switches between Standard and
  Vim keybindings and remembers the choice in the browser. Vim mode moves
  `j`/`k` by wrapped display lines
- The page live-updates whenever the file changes on disk, flashing what
  changed

## Wrapping up

When the user says they're done, read the final file and use it for whatever
comes next (e.g. `gh pr edit --body-file`). Stop the server task (TaskStop)
and the Monitor when the review is over. This skill composes with `write-pr`
and `write-issue`: draft with those, review with this.
