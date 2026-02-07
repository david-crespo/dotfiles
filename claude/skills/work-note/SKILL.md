---
name: work-note
description: Write a work note based on the recent conversation to ~/obsidian/Base files/Bot notes/
user_invocable: true
---

# Work Note

Write a note summarizing the recent conversation to `~/obsidian/Base files/Bot notes/`.

## On invocation

1. Review the last several messages in the conversation to identify the substantive topic.
2. Pick a short, lowercase, descriptive filename (e.g., `jj workspace tool.md`). Match the style of existing notes in the directory.
3. Write the note and save it.

If invoked with an argument, treat it as instructions on what to include in the note (topic, scope, emphasis). The filename should always just be a good short representative title regardless of the argument.

## Note format

The key principle: **the note should be very close to verbatim what was said in the conversation.** If you gave a good explanation in the chat, copy it nearly verbatim into the note. Do not rewrite, reorganize, or "summarize" something that was already well-written. The conversation is the primary source — the note preserves it, lightly edited at most.

- **Use the conversation's Q&A structure directly.** The user's questions become blockquotes (`>`), your answers follow. If the user asked a follow-up question that drove the conversation forward, include it as a blockquote transition between sections — this is more authentic and clearer than invented section headings.
- **When quoting, quote.** Blockquotes (`>`) must use the user's actual words. It's fine to paraphrase or summarize the user, but not inside a blockquote — that's a quote.
- **Copy your responses nearly verbatim.** Light editing for flow is fine (removing "Let me look at..." transitions), but preserve the structure, tone, and level of detail. If the response used prose paragraphs, keep prose paragraphs. Don't break flowing text into bullet points or add headings that weren't there.
- **Include concrete details.** Links, file paths with line numbers, code snippets, command examples — the kind of thing that's hard to reconstruct later.
- **Omit filler.** No preamble, no "here's what we discussed," no meta-commentary about the note itself.

## Before writing

Check existing notes in the directory to avoid duplicating a topic. If a closely related note already exists, ask whether to append or create a new one.
