---
name: session-history
description: Search and summarize Claude Code and Codex session history. Use when the user wants to look at past conversations, find sessions about a topic, or reconstruct a debugging narrative.
user_invocable: true
---

# Session History

Search and summarize conversations from Claude Code and Codex sessions.

If invoked with an argument, treat it as the search term, topic, or date to find across sessions.

## Session file locations

**Claude Code** sessions are JSONL files stored per-project:

    ~/.claude/projects/-Users-david-oxide-<repo>/*.jsonl
    ~/.claude/projects/-Users-david-repos-<repo>/*.jsonl

The directory name is the absolute project path with `/` replaced by `-`.

**Codex** sessions are JSONL files stored by date:

    ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl

## Finding sessions

List Claude Code sessions for the current repo, most recent first:

```bash
project_dir=$(echo "$PWD" | tr '/' '-')
ls -1 ~/.claude/projects/"$project_dir"/*.jsonl | while read f; do echo "$(stat -f '%m' "$f") $(basename "$f")"; done | sort -rn | head -20
```

List today's Codex sessions:

```bash
ls ~/.codex/sessions/$(date +%Y/%m/%d)/
```

Search for a term across all sessions in both tools:

```bash
# Claude Code (current repo)
project_dir=$(echo "$PWD" | tr '/' '-')
rg -l "search_term" ~/.claude/projects/"$project_dir"/*.jsonl

# Codex (specific date)
rg -l "search_term" ~/.codex/sessions/2026/02/16/*.jsonl
```

## Extracting messages

For large session files (>256KB), always use `jq` via Bash rather than the Read tool.

### Claude Code JSONL structure

Each line is a JSON object with `type` ("user", "assistant", "tool_use", "tool_result", etc.) and `message` containing `role` and `content`.

```bash
# User messages (content is string or array of objects)
jq -r 'select(.type == "user") | .message.content | if type == "string" then . elif type == "array" then map(select(.type == "text") | .text) | join("\n") else empty end' "$session"

# Assistant text (excluding tool calls)
jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text' "$session"
```

### Codex JSONL structure

Each line has `type` ("session_meta", "event_msg", "response_item", "turn_context") and `payload`.

```bash
# User messages
jq -r 'select(.type == "event_msg") | .payload | select(.type == "user_message") | .message' "$session"

# Assistant text
jq -r 'select(.type == "response_item") | .payload | select(.type == "message" and .role == "assistant") | .content[]? | select(.type == "output_text") | .text' "$session"

# Session metadata (cwd, model)
jq -r 'select(.type == "turn_context") | .payload | "\(.cwd) | \(.model)"' "$session" | head -1
```

## Process

1. **Find relevant sessions.** List sessions by date, then extract the first user message from each to identify the topic. Use `head -c 2000` or `jq` with `limit(1; ...)` to avoid reading entire large files for triage.

2. **Triage efficiently.** If looking for a specific topic, use `rg -l` to narrow down candidates before extracting full messages.

3. **Summarize selectively.** Extract only user messages first to understand the arc. Only extract assistant messages for the specific sessions the user cares about.

4. **For multi-session narratives**, establish chronological order using file timestamps or `session_meta` entries, then read sessions in order to build the story.
