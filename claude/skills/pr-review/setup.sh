#!/bin/bash
# Setup a jj worktree for PR review
# Usage: setup.sh <repo_name> <pr_number>

set -euo pipefail

REPO_NAME="${1:?Usage: setup.sh <repo_name> <pr_number>}"
PR_NUM="${2:?Usage: setup.sh <repo_name> <pr_number>}"
OWNER="${3:-oxidecomputer}"

# Find repo
REPO_PATH=""
for dir in ~/oxide ~/repos; do
  if [[ -d "$dir/$REPO_NAME" ]]; then
    REPO_PATH="$dir/$REPO_NAME"
    break
  fi
done

if [[ -z "$REPO_PATH" ]]; then
  echo "Error: Repo '$REPO_NAME' not found in ~/oxide or ~/repos" >&2
  exit 1
fi

# Setup review directory
mkdir -p "$HOME/.pr-reviews"
REVIEW_DIR="$HOME/.pr-reviews/${REPO_NAME}-${PR_NUM}"

# Check if review directory already exists
if [[ -d "$REVIEW_DIR" ]]; then
  echo "Review directory already exists: $REVIEW_DIR" >&2
  echo "Run 'cleanup.sh $REPO_NAME $PR_NUM' first to remove it, or pass --force to overwrite" >&2
  if [[ "${4:-}" != "--force" ]]; then
    exit 1
  fi
  echo "Forcing overwrite..." >&2
fi

# Get PR branch
BRANCH=$(gh pr view "$PR_NUM" -R "$OWNER/$REPO_NAME" --json headRefName --jq '.headRefName')

# Clean up any existing worktree
cd "$REPO_PATH"
jj workspace forget pr-review 2>/dev/null || true
rm -rf "$REVIEW_DIR"

# Create worktree and checkout PR branch
jj workspace add --name pr-review "$REVIEW_DIR"
cd "$REVIEW_DIR"
jj git fetch
jj new "$BRANCH"

# Install dependencies if needed
if [[ -f package.json ]]; then
  echo "Installing npm dependencies..."
  npm install --silent
fi

echo "REPO_PATH=$REPO_PATH"
echo "REVIEW_DIR=$REVIEW_DIR"
echo "BRANCH=$BRANCH"
