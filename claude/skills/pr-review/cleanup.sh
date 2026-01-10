#!/bin/bash
# Cleanup jj worktree after PR review
# Usage: cleanup.sh <repo_name> <pr_number>

set -euo pipefail

REPO_NAME="${1:?Usage: cleanup.sh <repo_name> <pr_number>}"
PR_NUM="${2:?Usage: cleanup.sh <repo_name> <pr_number>}"

REVIEW_DIR="$HOME/.pr-reviews/${REPO_NAME}-${PR_NUM}"

# Find repo
REPO_PATH=""
for dir in ~/oxide ~/repos; do
  if [[ -d "$dir/$REPO_NAME" ]]; then
    REPO_PATH="$dir/$REPO_NAME"
    break
  fi
done

if [[ -n "$REPO_PATH" ]]; then
  cd "$REPO_PATH"
  jj workspace forget pr-review 2>/dev/null || true
fi

rm -rf "$REVIEW_DIR"
echo "Cleaned up $REVIEW_DIR"
