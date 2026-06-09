#!/usr/bin/env bash
set -uo pipefail

# Gather all deterministic /coach context in one parallel pass: daily notes,
# Things tasks, GitHub activity, session history (with auto-recaps of
# substantial sessions), milestones, and jj logs. Calendar and Gmail are
# MCP-only and not covered here.
#
# Sources run concurrently; output is emitted in a fixed section order.
# A failing source reports its stderr in place instead of killing the report.

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SESSIONS_SH="$SKILL_DIR/../session-history/claude-sessions.sh"

GH_DAYS=7
SESSION_DAYS=3
RECAP_MIN=20
JJ_LIMIT=15
# tviz is a zsh alias (see .zprofile), not on PATH — call the script directly
TVIZ="$HOME/repos/things-viz/main.ts"
MILESTONE_REPOS=(oxidecomputer/console oxidecomputer/omicron)
JJ_REPOS=("$HOME/oxide/omicron" "$HOME/oxide/console" "$HOME/repos/dotfiles")

usage() {
  cat <<'EOF'
Usage: coach-context.sh [--gh-days N] [--session-days N] [--recap-min N]

Gather /coach context from all local/CLI sources in one parallel pass.

  --gh-days N        Window for GitHub activity (default: 7)
  --session-days N   Window for session history (default: 3)
  --recap-min N      Min user messages for a session to get a full recap
                     (default: 20)
  --jj-limit N       Max revs shown per repo in jj logs (default: 15)
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gh-days) GH_DAYS="$2"; shift 2 ;;
    --session-days) SESSION_DAYS="$2"; shift 2 ;;
    --recap-min) RECAP_MIN="$2"; shift 2 ;;
    --jj-limit) JJ_LIMIT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Run a section in the background, capturing stdout/stderr for ordered emit.
run() {
  local name="$1"
  shift
  { "$@" >"$tmp/$name.out" 2>"$tmp/$name.err"; } &
}

# Serial within the job: avoid hitting Things with three concurrent queries.
section_things() {
  echo "### Today"
  "$TVIZ" today -f tsv
  echo
  echo "### Logbook (last 30 completions)"
  "$TVIZ" logbook -n 30
  echo
  echo "### Open Oxide todos"
  "$TVIZ" todos -a Oxide -f tsv
}

# Recap output is a header line plus one numbered line per user message, so
# (line count - 1) = user message count.
section_recaps() {
  local session out lines
  while IFS= read -r session; do
    [[ -z "$session" || "$session" == */subagents/* ]] && continue
    out=$("$SESSIONS_SH" recap "$session" 2>/dev/null) || continue
    lines=$(echo "$out" | wc -l)
    if (( lines - 1 >= RECAP_MIN )); then
      echo "--- $session"
      echo "$out"
      echo
    fi
  done < <("$SESSIONS_SH" list --all --days "$SESSION_DAYS" 2>/dev/null)
}

section_milestones() {
  local repo
  for repo in "${MILESTONE_REPOS[@]}"; do
    echo "### $repo"
    gh-api-read "/repos/$repo/milestones" \
      --jq '.[] | {id: .number, title, due_on, open_issues, closed_issues}' \
      || echo "(error fetching milestones)"
  done
}

section_jj() {
  local repo
  for repo in "${JJ_REPOS[@]}"; do
    [[ -d "$repo" ]] || continue
    echo "### ${repo/#$HOME/\~}"
    # one line per rev, capped: enough to spot in-progress work without
    # dumping a whole stack's history. Dig further with jj log -R.
    jj log -R "$repo" -n "$JJ_LIMIT" -T builtin_log_oneline --no-pager --color never 2>&1
    echo "(latest $JJ_LIMIT revs; for more: jj log -R ${repo/#$HOME/\~})"
    echo
  done
}

run daily obsidian-notes daily:recent
run things section_things
run gh "$SKILL_DIR/gh-activity.sh" "$GH_DAYS"
run sessions "$SESSIONS_SH" summary --all --days "$SESSION_DAYS"
run recaps section_recaps
run milestones section_milestones
run jj section_jj
wait

# Top-level sections use h1 so embedded headers (gh-activity emits ##) nest.
emit() {
  local name="$1" title="$2"
  echo "# $title"
  if [[ -s "$tmp/$name.out" ]]; then
    cat "$tmp/$name.out"
  else
    echo "(none)"
  fi
  if [[ -s "$tmp/$name.err" ]]; then
    echo "[stderr]"
    sed 's/^/  /' "$tmp/$name.err"
  fi
  echo
}

emit daily "Daily notes"
emit things "Things tasks"
emit gh "GitHub activity (last $GH_DAYS days)"
emit sessions "Sessions (last $SESSION_DAYS days)"
emit recaps "Session recaps (>= $RECAP_MIN user messages)"
emit milestones "Milestones"
emit jj "jj log (in-progress work)"
