---
description: Read-only research/analysis agent. Reads, searches, and browses but cannot modify files, run shell commands, or spawn subagents.
mode: primary
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
---
