---
name: prose
description: "Review/edit a prose deliverable (PR body, issue body, doc) in a local browser GUI wired to this session: live GitHub-style preview, selection comments, de-LLM gesture. Use when the user wants to iterate on a chunk of prose visually instead of via chat, or says /prose."
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

4. Tell the user the page is up (one line, no walkthrough of the gestures;
   they know the tool), then end the turn. Comments wake the session as
   Monitor notifications.

## Handling events

Each event is one JSON object:

```json
{"kind": "comment" | "dellm" | "file-edit", "selection": "...", "prefix": "...",
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
- `kind: "file-edit"` — the file changed on disk since the last comment:
  the user's helix saves, or your own edits echoed back. `old`/`new` give
  one splice covering everything that changed in that window. If they match
  changes you just made, ignore the event. Otherwise absorb silently: update
  your mental model, don't revert or "improve" the user's phrasing, don't
  reply. If an Edit fails to match afterwards, re-read the file. Edit notices
  never wake the session on their own — they arrive only right before a
  comment they may be context for.
- Helix does not reload its buffer when the file changes underneath it. After
  you edit the file, the user's helix pane shows stale text until they
  `:reload` (or the buffer is otherwise refreshed), and a helix save in
  that state fails with "file modified by an external process". When the
  user says helix looks stale or can't save, that's why — tell them
  `:reload` and carry on. Their unsaved keystrokes are never overwritten by
  your edits, but a `:w!` on their side would overwrite yours; if a
  `file-edit` event shows your change reverted, reapply it.
- After editing the file, the page live-updates on its own and flashes the
  changed blocks. Reply in chat with at most one short line per comment (or
  nothing) — the user is looking at the page, not the transcript. If you
  edited beyond the selection, the flashes show where; a reply is only
  needed when the extra edits might surprise.
- Comments are also logged to `~/.local/state/prose/` (one file per draft,
  named by the draft's absolute path with slashes flattened; the server
  prints the exact path on startup). If the Monitor was armed late or the
  session restarted, check that file for unhandled comments.

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

## Wrapping up

When the user says they're done, read the final file and use it for whatever
comes next (e.g. `gh pr edit --body-file`). Stop the server task (TaskStop)
and the Monitor when the review is over. This skill composes with `write-pr`
and `write-issue`: draft with those, review with this.
