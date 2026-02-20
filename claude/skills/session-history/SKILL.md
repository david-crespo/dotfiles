---
name: session-history
description: Search and summarize Claude Code and Codex session history. Use when the user wants to look at past conversations, find sessions about a topic, or reconstruct a debugging narrative.
user_invocable: true
---

# Session History

Search and summarize conversations from Claude Code and Codex sessions.

If invoked with an argument, treat it as the search term, topic, or date to find across sessions.

## Helper script

This skill includes `claude-sessions.sh` for common operations on both Claude
Code and Codex sessions. Use it instead of writing ad hoc jq/rg pipelines. Run
it without arguments for usage. The script auto-detects session format by path.

```
claude-sessions.sh dir [path]                              # session dir for a project
claude-sessions.sh list [--all | path] [--days N]          # recent sessions
claude-sessions.sh search <term> [--all | path] [--days N] # find sessions by content
claude-sessions.sh bash <session> [filter]                  # extract Bash commands
claude-sessions.sh extract <session> <type>                 # type: user, assistant, bash, tools
claude-sessions.sh search-bash <term> [--all | path] [--days N]
                                                            # search + extract matching Bash commands
claude-sessions.sh search-extract <term> <type> [--all | path] [--days N]
                                                            # search + extract content by type
claude-sessions.sh summary [--all | path] [--days N]       # date, project, first user message
```

The script lives next to this skill file. Run it with its full path:

    ~/.claude/skills/session-history/claude-sessions.sh

## Session file locations

**Claude Code** sessions are JSONL files stored per-project:

    ~/.claude/projects/-Users-david-oxide-<repo>/*.jsonl
    ~/.claude/projects/-Users-david-repos-<repo>/*.jsonl

The directory name is the absolute project path with all `/` replaced by `-`
(including the leading one, so it starts with `-`).

**Codex** sessions are JSONL files stored by date:

    ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl

With `--all`, commands include both Claude Code and Codex sessions. Codex
sessions are distinguished by a `codex:` prefix in summary and header output.

## Process

1. **Use the helper script** for both Claude Code and Codex sessions. Only
   fall back to raw jq for unusual extraction needs.

2. **Triage efficiently.** Use `claude-sessions.sh search` to narrow down
   candidates before extracting full content.

3. **Summarize selectively.** Extract only user messages first to understand
   the arc. Only extract assistant messages for the specific sessions the user
   cares about.

4. **For multi-session narratives**, establish chronological order using file
   timestamps or `session_meta` entries, then read sessions in order to build
   the story.

5. For large session files (>256KB), always use the helper script or `jq` via
   Bash rather than the Read tool.
