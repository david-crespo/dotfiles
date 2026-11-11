---
name: bot-note
description: Write a note in Obsidian based on the recent conversation
user_invocable: true
---

# Bot Note

Write a note summarizing the recent conversation. Bot notes are plain markdown files in `~/obsidian/Bot notes/`, one per note, named `<name>.md`. Read and write them as files; Obsidian picks up changes on disk and doesn't need to be running. The folder is writable from the sandbox. Stay inside it: the rest of the vault is not for this skill.

## On invocation

1. Review the last several messages in the conversation to identify the substantive topic.
2. Pick a short, lowercase, descriptive name (e.g., `jj workspace tool`), with no `/` or `:`. Match the style of existing notes (`ls ~/obsidian/"Bot notes"`).
3. Write the note to `~/obsidian/Bot notes/<name>.md` with the Write tool.

If invoked with an argument, treat it as instructions on what to include in the note (topic, scope, emphasis). The filename should always just be a good short representative title regardless of the argument.

## Note format

The filename is the note title. Do not add a leading Markdown heading like `# title` inside the note body.

A new note starts with frontmatter holding when it was made, in local time (`date +%Y-%m-%dT%H:%M`), then the body:

```
---
created: 2026-11-10T21:30
---
First paragraph of the note.
```

The key principle: **the note should be very close to verbatim what was said in the conversation.** If you gave a good explanation in the chat, copy it nearly verbatim into the note. Do not rewrite, reorganize, or "summarize" something that was already well-written. The conversation is the primary source — the note preserves it, lightly edited at most.

- **Use the conversation's Q&A structure directly.** The user's questions become blockquotes (`>`), your answers follow. If the user asked a follow-up question that drove the conversation forward, include it as a blockquote transition between sections — this is more authentic and clearer than invented section headings.
- **When quoting, quote.** Blockquotes (`>`) must use the user's actual words. It's fine to paraphrase or summarize the user, but not inside a blockquote — that's a quote.
- **Copy your responses nearly verbatim.** Light editing for flow is fine (removing "Let me look at..." transitions), but preserve the structure, tone, and level of detail. If the response used prose paragraphs, keep prose paragraphs. Don't break flowing text into bullet points or add headings that weren't there.
- **Include concrete details.** Links, file paths with line numbers, code snippets, command examples — the kind of thing that's hard to reconstruct later.
- **Never hard-wrap.** Each paragraph, list item, or table row is one long line. Obsidian joins single newlines, but a wrap inside a `code span` or a link breaks its rendering. If the source material is a hard-wrapped markdown file (e.g. a `.claude/notes` report), unwrap it before writing the note.
- **Omit filler.** No preamble, no "here's what we discussed," no meta-commentary about the note itself.

## Before writing

List the folder to check existing notes and avoid duplicating a topic. If a closely related note already exists, ask whether to append or create a new one. To append or edit, read the file and use the Edit tool; leave its `created` line alone. Don't overwrite an existing note with Write.

## After writing

End with a single line of the form `Note created at [<name>](<url>)` (or `Note updated at ...` for appends/edits) where `<name>` is just the note filename without the `Bot notes/` prefix or `.md` extension, and `<url>` is `obsidian://open?vault=obsidian&file=<url-encoded-name>`. The link must be clickable, so URL-encode spaces as `%20`.
