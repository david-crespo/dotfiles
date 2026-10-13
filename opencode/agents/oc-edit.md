---
description: Code-editing agent. Reads, searches, and edits files but cannot run shell commands or spawn subagents.
mode: primary
permissions:
  - action: shell
    resource: "*"
    effect: deny
  - action: subagent
    resource: "*"
    effect: deny
---
