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

If invoked with an argument, use it as the topic or filename hint.

## Note format

Work notes capture ideas, decisions, and research from a conversation. They are not transcripts. The note should read like something useful to return to later.

Structure is flexible, but follow these conventions from existing notes:

- **Open with the user's own words.** Start with a blockquote (`>`) containing the original question or prompt that kicked off the conversation, lightly edited for clarity if needed. This preserves intent and context.
- **Follow with a synthesis of what was discussed.** Summarize findings, decisions, trade-offs, and conclusions in the user's voice or neutral prose. Use headings and code blocks where they help, but don't over-structure. Put the summary at the top rather than at the end.
- **Include concrete details.** Links, command examples, code snippets, names of tools or libraries — the kind of thing that's hard to reconstruct later.
- **Omit filler.** No preamble, no "here's what we discussed," no meta-commentary about the note itself.

## Before writing

Check existing notes in the directory to avoid duplicating a topic. If a closely related note already exists, ask whether to append or create a new one.
