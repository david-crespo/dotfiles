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
claude-sessions.sh summary [--all | path] [--days N]       # per-session user-msg & tool-call counts, first user message
claude-sessions.sh tools-audit <session> [--mode M] [--summary|--json|--truncate N]
                                                            # per-tool-call audit with permissionMode & outcome (Claude Code only)
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

   For counting questions ("how many user messages today?", "how active
   was I in this repo?"), `summary` already emits `(U N, T M)` per session —
   sum those columns rather than writing ad hoc jq. The `U` count excludes
   tool-result messages; naive `type == "user"` filters conflate the two.

4. **For multi-session narratives**, establish chronological order using file
   timestamps or `session_meta` entries, then read sessions in order to build
   the story.

5. For large session files (>256KB), always use the helper script or `jq` via
   Bash rather than the Read tool.

## Auditing tool calls by permission mode

When asked to audit auto-mode (or acceptEdits / bypassPermissions) tool calls —
typically "what got approved under auto mode recently?" or "which commands did
auto mode reject?" — use `tools-audit`.

Transcripts record `permissionMode` on user-message entries and on
`permission-mode` events, so the script can tag every tool call with the mode
in effect at that moment. Outcomes come from the matching `tool_result`:
`denied-user` is an interactive rejection, `denied-rule` is a sandbox/allowlist
block, `error` is a tool-level failure, `ok` is anything that ran cleanly.
Caveat: within a mode the transcript does not distinguish "allowed by rule" from
"user clicked approve" — only that the call wasn't denied.

Typical recipe for "audit yesterday's auto-mode calls in repo X":

```bash
DIR=$(claude-sessions.sh dir ~/oxide/X)
> /tmp/audit.jsonl
for f in "$DIR"/*.jsonl; do
  d=$(stat -f '%Sm' -t '%Y-%m-%d' "$f")
  [[ "$d" != "YYYY-MM-DD" ]] && continue
  claude-sessions.sh tools-audit "$f" --mode auto --json >> /tmp/audit.jsonl
done

# Rejections and errors first:
jq -c 'select(.outcome != "ok")' /tmp/audit.jsonl

# Then audit the Bash stream for dubiousness:
jq -r 'select(.outcome == "ok" and .tool == "Bash") | .input.command' /tmp/audit.jsonl \
  | rg 'rm -rf|git push|--force|--no-verify|gh pr (create|edit|merge|close)|gh issue (create|edit|close)|npm publish|curl .*-X (POST|PUT|DELETE|PATCH)|sudo|chmod|chown|jj (abandon|squash|rebase)|killall|pkill'

# And Writes/Edits outside the project:
jq -r 'select(.outcome == "ok" and (.tool == "Write" or .tool == "Edit")) | [.tool, .input.file_path] | @tsv' /tmp/audit.jsonl \
  | rg -v 'oxide/X'
```

Always use `--json` when piping to another tool — the default TSV double-escapes
backslashes in the input column (it's meant for human reading), so downstream
`jq` on the input field will fail. Read the current CLAUDE.md and memory for
user-specific preferences (e.g. rules against plain `git`, squashing unprompted,
browsing neighboring repos speculatively) and call those out as soft violations
in addition to the hard-destructive patterns above.
