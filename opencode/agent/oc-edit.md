---
description: Code-editing subagent. Reads, searches, and edits files but cannot run shell commands.
mode: primary
model: opencode/kimi-k2.6
permission: { read: allow, grep: allow, glob: allow, edit: allow, webfetch: allow, bash: deny, task: deny }
---
