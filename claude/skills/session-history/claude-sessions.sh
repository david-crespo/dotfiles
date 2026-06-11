#!/usr/bin/env bash
set -euo pipefail

# Common operations on Claude Code, Codex, and opencode session history.
# Claude Code sessions: JSONL in ~/.claude/projects/<mangled-path>/*.jsonl
# Codex sessions: JSONL in ~/.codex/sessions/YYYY/MM/DD/*.jsonl
# opencode sessions: rows in a SQLite DB (~/.local/share/opencode/opencode.db).
#   These have no per-session file, so they are referenced by a synthetic
#   identifier "opencode:<session_id>" that flows through the same pipeline as
#   Claude/Codex file paths. is_opencode() recognizes it and the oc_* helpers
#   answer queries against the DB.

SESSIONS_ROOT="$HOME/.claude/projects"
CODEX_ROOT="$HOME/.codex/sessions"
OPENCODE_DB="$HOME/.local/share/opencode/opencode.db"

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

# opencode sessions live in a SQLite DB, referenced by a synthetic
# "opencode:<id>" identifier that flows through the pipeline like a file path.
# Like Codex, they are only surfaced with --all, not by project path.
is_opencode() { [[ "$1" == opencode:* ]]; }
oc_id() { echo "${1#opencode:}"; }   # strip the prefix
oc_esc() { printf '%s' "$1" | sed "s/'/''/g"; }   # escape for a SQL literal
ocq() { [[ -f "$OPENCODE_DB" ]] && sqlite3 "$OPENCODE_DB" "$1"; }

# Text parts of a given role for a session, in order (one row per part).
# Shared by the user/assistant/recap/summary/count paths.
oc_text() {
  ocq "select json_extract(p.data,'\$.text')
       from part p join message m on p.message_id=m.id
       where p.session_id='$(oc_esc "$1")'
         and json_extract(m.data,'\$.role')='$2'
         and json_extract(p.data,'\$.type')='text'
         and json_extract(p.data,'\$.text') is not null
       order by p.time_created;"
}

# Emit "<epoch_seconds> opencode:<id>" for top-level sessions, newest first.
# Subagent/child sessions (parent_id set) are excluded. Optional days cap.
# Note: SQLite binds || tighter than /, so (time_updated/1000) needs parens.
oc_list_rows() {
  local cap="${1:-}" conds="parent_id is null"
  [[ -n "$cap" ]] && conds="$conds and time_updated/1000 >= cast(strftime('%s','now','-${cap} days') as integer)"
  ocq "select (time_updated/1000) || ' opencode:' || id from session where $conds order by time_updated desc;"
}

# Emit "opencode:<id>" for sessions whose parts or title match a term.
oc_search_rows() {
  local esc; esc=$(oc_esc "$1")
  ocq "select 'opencode:' || id from session
       where parent_id is null
         and (id in (select session_id from part where data like '%$esc%') or title like '%$esc%')
       order by time_updated desc;"
}

# Convert an absolute path to the Claude session directory name
session_dir() {
  local project_path="${1:-$PWD}"
  local mangled
  mangled=$(echo "$project_path" | tr '/' '-')
  echo "$SESSIONS_ROOT/$mangled"
}

# Filter session identifiers on stdin to those modified within N days.
# Handles both file paths (stat mtime) and opencode ids (DB time_updated).
filter_by_days() {
  local days="${1:?days required}"
  local cutoff
  cutoff=$(date -v-"${days}"d '+%Y%m%d')
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    local d
    if is_opencode "$f"; then
      d=$(ocq "select strftime('%Y%m%d', time_updated/1000, 'unixepoch', 'localtime') from session where id='$(oc_esc "$(oc_id "$f")")';")
    else
      d=$(stat -f '%Sm' -t '%Y%m%d' "$f")
    fi
    [[ -n "$d" && "$d" -ge "$cutoff" ]] && echo "$f"
  done
  return 0  # the read loop exits non-zero on EOF; don't let pipefail propagate it
}

# Format a session path as "project (date)"
format_session_header() {
  local session="$1"
  local project date
  if is_opencode "$session"; then
    local id; id=$(oc_esc "$(oc_id "$session")")
    project=$(ocq "select directory from session where id='$id';" | sed "s|$HOME/||")
    date=$(ocq "select date(time_updated/1000, 'unixepoch', 'localtime') from session where id='$id';")
    echo "=== opencode: ${project:-unknown} ($date) ==="
    return
  fi
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
      oc_list_rows 30
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
      oc_search_rows "$term"
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
  if is_opencode "$session"; then
    local cmds
    cmds=$(ocq "select json_extract(data,'\$.state.input.command') from part
                where session_id='$(oc_esc "$(oc_id "$session")")'
                  and json_extract(data,'\$.tool')='bash'
                  and json_extract(data,'\$.state.input.command') is not null
                order by time_created;")
    [[ -n "$filter" ]] && { echo "$cmds" | grep -F -- "$filter" || true; } || echo "$cmds"
    return
  fi
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
  if is_opencode "$session"; then
    _extract_opencode "$session" "$type"
  elif is_codex "$session"; then
    _extract_codex "$session" "$type"
  else
    _extract_cc "$session" "$type"
  fi
}

_extract_opencode() {
  local session="$1" type="$2"
  case "$type" in
    user|assistant) oc_text "$(oc_id "$session")" "$type" ;;
    bash)           cmd_bash "$session" ;;
    tools)          # "<tool>: <input json, truncated>" per tool part
      ocq "select json_extract(data,'\$.tool') || ': ' || substr(json_extract(data,'\$.state.input'), 1, 120)
           from part where session_id='$(oc_esc "$(oc_id "$session")")' and json_extract(data,'\$.type')='tool'
           order by time_created;" ;;
    *) echo "Unknown type: $type (expected: user, assistant, bash, tools)" >&2; exit 1 ;;
  esac
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
    # tolerate per-session extraction failures (e.g. jq choking on bad escapes)
    # so one bad session doesn't abort the whole sweep under set -e
    cmds=$(cmd_bash "$session" "$term" 2>/dev/null) || true
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
    content=$(cmd_extract "$session" "$type" 2>/dev/null) || true
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
  if is_opencode "$session"; then
    local id turns tools
    id=$(oc_esc "$(oc_id "$session")")
    # U = user messages carrying at least one text part (genuine user turns)
    turns=$(ocq "select count(distinct m.id) from message m join part p on p.message_id=m.id
                 where m.session_id='$id' and json_extract(m.data,'\$.role')='user' and json_extract(p.data,'\$.type')='text';")
    tools=$(ocq "select count(*) from part where session_id='$id' and json_extract(data,'\$.type')='tool';")
    echo "(U ${turns:-0}, T ${tools:-0})"
    return
  fi
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
    # date must be reset each iteration: only the opencode branch assigns it,
    # so a stale value from a prior session would suppress the stat fallback
    local project first_msg msg_count
    local date=""
    if is_opencode "$session"; then
      local id; id=$(oc_id "$session")
      project="opencode: $(ocq "select directory from session where id='$(oc_esc "$id")';" | sed "s|$HOME/||")"
      first_msg=$(oc_text "$id" user | grep -v '^<' | head -1 | cut -c1-120) || true
      date=$(ocq "select strftime('%Y-%m-%d %H:%M', time_created/1000, 'unixepoch', 'localtime') from session where id='$(oc_esc "$id")';")
    elif is_codex "$session"; then
      project=$(jq -r 'select(.type == "turn_context") | .payload.cwd' "$session" 2>/dev/null | head -1 | sed "s|$HOME/||")
      project="codex: ${project:-unknown}"
      first_msg=$(jq -rn '
        first(inputs | select(.type == "event_msg") | .payload |
          select(.type == "user_message") | .message |
          select(startswith("<") | not)
        ) | gsub("\\s+"; " ") | .[:120]
      ' "$session" 2>/dev/null || true)
    else
      project=$(echo "$session" | sed 's|.*/projects/-Users-david-||; s|/[^/]*$||; s|-|/|g')
      first_msg=$(jq -rn '
        first(inputs | select(.type == "user") | .message.content |
          if type == "string" then select(startswith("<") | not)
          elif type == "array" then [.[] | select(.type == "text") | .text | select(startswith("<") | not)] | first // empty
          else empty end
        ) | gsub("\\s+"; " ") | .[:120]
      ' "$session" 2>/dev/null || true)
    fi
    activity=$(count_session_activity "$session" 2>/dev/null) || true
    [[ -z "${date:-}" ]] && date=$(stat -f '%SB' -t '%Y-%m-%d %H:%M' "$session")
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
  if is_codex "$session" || is_opencode "$session"; then
    echo "tools-audit is Claude Code only (permissionMode doesn't exist in Codex/opencode sessions)" >&2
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
  if is_opencode "$session"; then
    oc_text "$(oc_id "$session")" user | grep -v '^<' | cut -c1-150 | nl -ba
    return
  fi
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
