#!/usr/bin/env bash
set -euo pipefail

# Common operations on Claude Code and Codex session history files.
# Claude Code sessions: JSONL in ~/.claude/projects/<mangled-path>/*.jsonl
# Codex sessions: JSONL in ~/.codex/sessions/YYYY/MM/DD/*.jsonl

SESSIONS_ROOT="$HOME/.claude/projects"
CODEX_ROOT="$HOME/.codex/sessions"

usage() {
  cat <<'EOF'
Usage: claude-sessions <command> [args]

Commands:
  dir [path]                        Print session directory for a project path (default: $PWD)
  list [--all | path] [--days N]    List recent sessions, most recent first
  search <term> [--all | path] [--days N]
                                    Search sessions for a term (uses rg)
  bash <session> [filter]           Extract Bash/shell commands from a session
  extract <session> <type>          Extract content: user, assistant, bash, tools
  search-bash <term> [--all | path] [--days N]
                                    Search sessions and show matching Bash commands
  search-extract <term> <type> [--all | path] [--days N]
                                    Search sessions and extract content by type
  summary [--all | path] [--days N] List sessions with date, project, activity (U/T = user msgs/tools), first user message
  recap <session>                   Compact digest: all user messages (truncated) showing work progression
  tools-audit <session> [--mode M] [--summary|--json|--truncate N]
                                    Audit tool_use events. Default output is TSV columns:
                                    timestamp, permissionMode, outcome, tool, input (compact JSON).
                                    Outcome is ok | denied-user | denied-rule | error | no-result.
                                    --mode filters to a single permissionMode.
                                    --summary prints counts grouped by mode x outcome x tool.
                                    --json emits JSONL (tool.input is a real JSON value — use
                                      this when downstream code needs to reparse the input).
                                    --truncate N trims the TSV input column for readability.

With --all, commands include both Claude Code and Codex sessions.
Session source is shown in summary output (codex: prefix for Codex sessions).
EOF
  exit 1
}

# Check if a session file is from Codex (by path)
is_codex() {
  [[ "$1" == "$CODEX_ROOT"* ]]
}

# Convert an absolute path to the Claude session directory name
session_dir() {
  local project_path="${1:-$PWD}"
  local mangled
  mangled=$(echo "$project_path" | tr '/' '-')
  echo "$SESSIONS_ROOT/$mangled"
}

# Filter file paths on stdin to those modified within N days
filter_by_days() {
  local days="${1:?days required}"
  local cutoff
  cutoff=$(date -v-"${days}"d '+%Y%m%d')
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ $(stat -f '%Sm' -t '%Y%m%d' "$f") -ge "$cutoff" ]]; then
      echo "$f"
    fi
  done
}

# Format a session path as "project (date)"
format_session_header() {
  local session="$1"
  local project date
  if is_codex "$session"; then
    project=$(jq -r 'select(.type == "turn_context") | .payload.cwd' "$session" 2>/dev/null | head -1 | sed "s|$HOME/||")
    project="codex: ${project:-unknown}"
  else
    project=$(echo "$session" | sed 's|.*/projects/-Users-david-||; s|/[^/]*$||; s|-|/|g')
  fi
  date=$(stat -f '%Sm' -t '%Y-%m-%d' "$session")
  echo "=== $project ($date) ==="
}

# Parse --days N from args, returning remaining args via REPLY_ARGS and days via REPLY_DAYS
parse_days_opt() {
  REPLY_DAYS=""
  REPLY_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --days) REPLY_DAYS="$2"; shift 2 ;;
      *) REPLY_ARGS+=("$1"); shift ;;
    esac
  done
}

# Apply --days filter if set, otherwise pass through
maybe_filter_days() {
  if [[ -n "${REPLY_DAYS:-}" ]]; then
    filter_by_days "$REPLY_DAYS"
  else
    cat
  fi
}

# List sessions sorted by modification time, most recent first
cmd_list() {
  parse_days_opt "$@"
  set -- "${REPLY_ARGS[@]+"${REPLY_ARGS[@]}"}"
  local dir
  if [[ "${1:-}" == "--all" ]]; then
    {
      fd --extension jsonl --changed-within 30d . "$SESSIONS_ROOT" --exec stat -f '%m %N' {}
      if [[ -d "$CODEX_ROOT" ]]; then
        fd --extension jsonl --changed-within 30d . "$CODEX_ROOT" --exec stat -f '%m %N' {}
      fi
    } | sort -rn | awk '{print $2}' \
      | maybe_filter_days
    return
  fi
  dir=$(session_dir "${1:-$PWD}")
  if [[ ! -d "$dir" ]]; then
    echo "No sessions found in $dir" >&2
    exit 1
  fi
  stat -f '%m %N' "$dir"/*.jsonl 2>/dev/null | sort -rn | awk 'NR<=20 {print $2}' \
    | maybe_filter_days
}

# Search for a term across sessions
cmd_search() {
  local term="${1:?search term required}"
  shift
  parse_days_opt "$@"
  set -- "${REPLY_ARGS[@]+"${REPLY_ARGS[@]}"}"
  if [[ "${1:-}" == "--all" ]]; then
    {
      rg --files-with-matches "$term" "$SESSIONS_ROOT"/*/*.jsonl 2>/dev/null || true
      if [[ -d "$CODEX_ROOT" ]]; then
        rg --files-with-matches --glob '*.jsonl' "$term" "$CODEX_ROOT" 2>/dev/null || true
      fi
    } | maybe_filter_days
  else
    local dir
    dir=$(session_dir "${1:-$PWD}")
    rg --files-with-matches "$term" "$dir"/*.jsonl 2>/dev/null | maybe_filter_days || true
  fi
}

# Extract Bash/shell commands from a session, optionally filtering
cmd_bash() {
  local session="${1:?session file required}"
  local filter="${2:-}"
  if is_codex "$session"; then
    if [[ -n "$filter" ]]; then
      jq -r --arg f "$filter" '
        select(.type == "response_item") | .payload |
        select(.type == "function_call" and .name == "exec_command") |
        (.arguments | fromjson? | .cmd) // empty |
        select(contains($f))
      ' "$session" 2>/dev/null || true
    else
      jq -r '
        select(.type == "response_item") | .payload |
        select(.type == "function_call" and .name == "exec_command") |
        (.arguments | fromjson? | .cmd) // empty
      ' "$session" 2>/dev/null || true
    fi
  else
    if [[ -n "$filter" ]]; then
      jq -r --arg f "$filter" 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Bash") | .input.command | select(contains($f))' "$session"
    else
      jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "Bash") | .input.command' "$session"
    fi
  fi
}

# Extract different content types from a session
cmd_extract() {
  local session="${1:?session file required}"
  local type="${2:?type required: user, assistant, bash, tools}"
  if is_codex "$session"; then
    _extract_codex "$session" "$type"
  else
    _extract_cc "$session" "$type"
  fi
}

_extract_cc() {
  local session="$1" type="$2"
  case "$type" in
    user)
      jq -r 'select(.type == "user") | .message.content | if type == "string" then . elif type == "array" then map(select(.type == "text") | .text) | join("\n") else empty end' "$session"
      ;;
    assistant)
      jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text' "$session"
      ;;
    bash)
      cmd_bash "$session"
      ;;
    tools)
      jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | "\(.name): \(.input | tostring[:120])"' "$session"
      ;;
    *)
      echo "Unknown type: $type (expected: user, assistant, bash, tools)" >&2
      exit 1
      ;;
  esac
}

_extract_codex() {
  local session="$1" type="$2"
  case "$type" in
    user)
      jq -r 'select(.type == "event_msg") | .payload | select(.type == "user_message") | .message' "$session"
      ;;
    assistant)
      jq -r 'select(.type == "response_item") | .payload | select(.type == "message" and .role == "assistant") | .content[]? | select(.type == "output_text") | .text' "$session"
      ;;
    bash)
      cmd_bash "$session"
      ;;
    tools)
      jq -r 'select(.type == "response_item") | .payload | select(.type == "function_call") | "\(.name): \(.arguments[:120])"' "$session"
      ;;
    *)
      echo "Unknown type: $type (expected: user, assistant, bash, tools)" >&2
      exit 1
      ;;
  esac
}

# Search sessions and extract matching Bash commands from all of them
cmd_search_bash() {
  local term="${1:?search term required}"
  shift
  local sessions
  sessions=$(cmd_search "$term" "$@")
  [[ -z "$sessions" ]] && return 0
  while IFS= read -r session; do
    [[ -z "$session" ]] && continue
    local cmds
    cmds=$(cmd_bash "$session" "$term")
    if [[ -n "$cmds" ]]; then
      format_session_header "$session"
      echo "$cmds"
      echo
    fi
  done <<< "$sessions"
}

# Search sessions and extract content by type from all of them
cmd_search_extract() {
  local term="${1:?search term required}"
  local type="${2:?type required: user, assistant, bash, tools}"
  shift 2
  local sessions
  sessions=$(cmd_search "$term" "$@")
  [[ -z "$sessions" ]] && return 0
  while IFS= read -r session; do
    [[ -z "$session" ]] && continue
    local content
    content=$(cmd_extract "$session" "$type")
    if [[ -n "$content" ]]; then
      format_session_header "$session"
      echo "$content"
      echo
    fi
  done <<< "$sessions"
}

# Count user turns and tool executions in a session.
# Output: "(U N, T M)" where N = user messages (excludes tool_result messages),
# M = tool calls by assistant.
count_session_activity() {
  local session="$1"
  if is_codex "$session"; then
    local turns
    turns=$(jq -s '[.[] | select(.type == "event_msg") | .payload | select(.type == "user_message")] | length' "$session" 2>/dev/null)
    local tools
    tools=$(jq -s '[.[] | select(.type == "response_item") | .payload | select(.type == "function_call")] | length' "$session" 2>/dev/null)
    echo "(U ${turns}, T ${tools})"
  else
    jq -rs '
      ([.[] | select(.type == "user") | .message.content |
        if type == "string" then true
        elif type == "array" then any(.[]; .type == "text")
        else false end | select(.)
      ] | length) as $turns |
      ([.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")] | length) as $tools |
      "(U \($turns), T \($tools))"
    ' "$session" 2>/dev/null
  fi
}

# List sessions with date, project, message count, and first user message
cmd_summary() {
  local sessions
  sessions=$(cmd_list "$@")
  [[ -z "$sessions" ]] && return 0
  while IFS= read -r session; do
    [[ -z "$session" ]] && continue
    [[ "$session" == */subagents/* ]] && continue
    local project date first_msg msg_count
    if is_codex "$session"; then
      project=$(jq -r 'select(.type == "turn_context") | .payload.cwd' "$session" 2>/dev/null | head -1 | sed "s|$HOME/||")
      project="codex: ${project:-unknown}"
      first_msg=$(jq -rn '
        first(inputs | select(.type == "event_msg") | .payload |
          select(.type == "user_message") | .message |
          select(startswith("<") | not)
        ) | .[:120]
      ' "$session" 2>/dev/null || true)
    else
      project=$(echo "$session" | sed 's|.*/projects/-Users-david-||; s|/[^/]*$||; s|-|/|g')
      first_msg=$(jq -rn '
        first(inputs | select(.type == "user") | .message.content |
          if type == "string" then select(startswith("<") | not)
          elif type == "array" then [.[] | select(.type == "text") | .text | select(startswith("<") | not)] | first // empty
          else empty end
        ) | .[:120]
      ' "$session" 2>/dev/null || true)
    fi
    activity=$(count_session_activity "$session")
    date=$(stat -f '%SB' -t '%Y-%m-%d %H:%M' "$session")
    echo "$date | $project | $activity | $first_msg"
  done <<< "$sessions"
}

# Audit tool calls in a session: map each tool_use to the permissionMode in
# effect and the outcome (ok / denied-user / denied-rule / error). Useful for
# reviewing what was auto-approved under acceptEdits / auto / bypassPermissions
# vs. what required interactive approval. Claude Code sessions only.
cmd_tools_audit() {
  local session="${1:?session file required}"
  shift || true
  local mode_filter=""
  local do_summary=0
  local do_json=0
  local truncate_n=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode) mode_filter="$2"; shift 2 ;;
      --summary) do_summary=1; shift ;;
      --json) do_json=1; shift ;;
      --truncate) truncate_n="$2"; shift 2 ;;
      *) echo "unknown flag: $1" >&2; exit 1 ;;
    esac
  done
  if is_codex "$session"; then
    echo "tools-audit is Claude Code only (permissionMode doesn't exist in Codex sessions)" >&2
    exit 1
  fi

  # Slurp the session, build an outcome map from tool_result entries keyed by
  # tool_use_id, then walk in order tracking the running permissionMode and
  # emit one record per tool_use. Mode starts at "default" and updates on any
  # entry carrying permissionMode (user messages and permission-mode events).
  # Emit JSONL first (tool.input is a real JSON value — safe to reparse) and
  # let callers pick a display format via --summary / --truncate, or consume
  # the JSONL directly with --json.
  local records
  records=$(jq -cs '
    def outcome_map:
      [ .[] | select(.type == "user") as $u
        | $u.message.content[]? | select(.type == "tool_result")
        | { key: .tool_use_id,
            value: (if $u.toolUseResult == "User rejected tool use" then "denied-user"
                    elif (.content | tostring | test("Permission for this action has been denied")) then "denied-rule"
                    elif .is_error == true then "error"
                    else "ok" end) } ] | from_entries;

    . as $all
    | ($all | outcome_map) as $o
    | reduce $all[] as $e ({mode:"default", rows:[]};
        if $e.permissionMode then .mode = $e.permissionMode
        elif $e.type == "assistant" then
          reduce ($e.message.content[]? | select(.type == "tool_use")) as $tu (.;
            .rows += [{ts: $e.timestamp, mode: .mode,
                       outcome: ($o[$tu.id] // "no-result"),
                       tool: $tu.name, input: $tu.input}])
        else . end)
    | .rows[]
  ' "$session")

  if [[ -n "$mode_filter" ]]; then
    records=$(echo "$records" | jq -c --arg m "$mode_filter" 'select(.mode == $m)')
  fi

  if [[ "$do_summary" -eq 1 ]]; then
    echo "$records" | jq -r '[.mode, .outcome, .tool] | @tsv' \
      | sort | uniq -c | sort -rn
  elif [[ "$do_json" -eq 1 ]]; then
    echo "$records"
  else
    # TSV for terminal readability: tool input is compact JSON, optionally
    # truncated. The input column IS escaped by @tsv (backslashes doubled,
    # real tabs/newlines escaped) so it is safe to display but not trivially
    # reparseable as JSON — use --json when you need to reparse.
    echo "$records" \
      | jq -r --argjson n "$truncate_n" '
          (.input | tostring) as $raw
          | (if $n > 0 and ($raw | length) > $n then ($raw[0:$n] + "…") else $raw end) as $inp
          | [.ts, .mode, .outcome, .tool, $inp] | @tsv'
  fi
}

# Compact digest of a session: all user messages truncated, showing work progression
cmd_recap() {
  local session="${1:?session file required}"
  format_session_header "$session"
  if is_codex "$session"; then
    jq -r '
      select(.type == "event_msg") | .payload |
      select(.type == "user_message") | .message |
      select(startswith("<") | not) |
      .[0:150]
    ' "$session" 2>/dev/null | nl -ba
  else
    jq -r '
      select(.type == "user") | .message.content |
      if type == "string" then select(startswith("<") | not)
      elif type == "array" then [.[] | select(.type == "text") | .text | select(startswith("<") | not)] | first // empty
      else empty end |
      .[0:150]
    ' "$session" 2>/dev/null | nl -ba
  fi
}

[[ $# -eq 0 ]] && usage

command="$1"
shift

case "$command" in
  dir)            session_dir "$@" ;;
  list)           cmd_list "$@" ;;
  search)         cmd_search "$@" ;;
  bash)           cmd_bash "$@" ;;
  extract)        cmd_extract "$@" ;;
  search-bash)    cmd_search_bash "$@" ;;
  search-extract) cmd_search_extract "$@" ;;
  summary)        cmd_summary "$@" ;;
  recap)          cmd_recap "$@" ;;
  tools-audit)    cmd_tools_audit "$@" ;;
  *)              usage ;;
esac
