---
name: copy-md
description: Copy the last assistant response as markdown to the clipboard
---

# Copy Markdown

Copy the last assistant response (the message immediately before this skill was invoked) as markdown to the clipboard using `pbcopy`. Leave out metadata that would have to be stripped out by hand. Usually this is for posting in a GitHub comment or PR body. Code fences should have a lang on them for nice highlighting.

Use the Bash tool to pipe the markdown content to `pbcopy`. Use a heredoc to pass the content.
