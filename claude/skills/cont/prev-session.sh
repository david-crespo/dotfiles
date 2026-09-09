#!/usr/bin/env bash
# Locate the Claude Code session to continue and print a compact digest of it.
#
# Selection (first match wins): an explicit session id or transcript path given
# as a positional argument; --topic <term> (most recent transcript in this
# project containing the term); otherwise the most recent transcript in this
# project. The current session ($CLAUDE_CODE_SESSION_ID) and sessions with no
# real user messages (e.g. a bare /clear) are skipped.
#
# Output: header, recap (every user message, first line, truncated), then the
# last few user messages and assistant replies with per-message boundaries.
set -euo pipefail

SESSIONS=~/.claude/skills/session-history/claude-sessions.sh
project_dir=$("$SESSIONS" dir "$PWD")

candidates() {
  case "${1:-}" in
    --topic) "$SESSIONS" search "$2" | xargs -r /bin/ls -t ;;
    "")      "$SESSIONS" list ;;
    *)       if [[ -f "$1" ]]; then echo "$1"; else echo "$project_dir/${1%.jsonl}.jsonl"; fi ;;
  esac
}

chosen=""
while read -r path; do
  [[ -f "$path" ]] || continue
  [[ "$(basename "$path" .jsonl)" == "${CLAUDE_CODE_SESSION_ID:-}" ]] && continue
  [[ -n "$("$SESSIONS" extract "$path" user | head -c 1)" ]] || continue
  chosen="$path"
  break
done < <(candidates "$@")

if [[ -z "$chosen" ]]; then
  echo "No previous session found in $project_dir" >&2
  exit 1
fi

id=$(basename "$chosen" .jsonl)
echo "Session: $id"
echo "Transcript: $chosen"
echo "Last message: $(date -r "$chosen" '+%a %-m/%-d %-I:%M %p')"
echo "Full-context resume (pays the uncached reprice): claude --resume $id"
echo
echo "## Recap (all user messages, first line, truncated)"
"$SESSIONS" recap "$chosen" | tail -n +2
echo
echo "## Tail: last 3 user messages"
"$SESSIONS" tail "$chosen" user 3
echo
echo "## Tail: last 2 assistant replies"
"$SESSIONS" tail "$chosen" assistant 2
