#!/usr/bin/env bash
# Called by Claude Code WorktreeRemove hook.
# Reads JSON from stdin with worktree_path and cwd fields.
set -euo pipefail

INPUT=$(cat)
WS_PATH=$(printf '%s' "$INPUT" | jq -r '.worktree_path')
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd')
WS_NAME=$(basename "$WS_PATH")

# forget must run from the original repo, not the worktree
cd "$CWD"
jj workspace forget "$WS_NAME" 2>/dev/null || true
rm -rf "$WS_PATH"
