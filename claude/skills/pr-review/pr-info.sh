#!/bin/bash
# Fetch PR metadata, comments, and linked issues
# Usage: pr-info.sh <repo_name> <pr_number>

set -euo pipefail

REPO_NAME="${1:?Usage: pr-info.sh <repo_name> <pr_number>}"
PR_NUM="${2:?Usage: pr-info.sh <repo_name> <pr_number>}"
OWNER="${3:-oxidecomputer}"

echo "=== PR Metadata ==="
gh pr view "$PR_NUM" -R "$OWNER/$REPO_NAME" --json title,body,commits,files,additions,deletions

echo ""
echo "=== Linked Issues ==="
gh api graphql -f owner="$OWNER" -f repo="$REPO_NAME" -F pr_number="$PR_NUM" -f query='
  query($owner: String!, $repo: String!, $pr_number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr_number) {
        closingIssuesReferences(first: 50) {
          nodes { repository { name }, number, title, body }
        }
      }
    }
  }
'

echo ""
echo "=== Reviews and Comments ==="
gh api graphql -f owner="$OWNER" -f repo="$REPO_NAME" -F pr_number="$PR_NUM" -f query='
  query($owner: String!, $repo: String!, $pr_number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr_number) {
        reviews(first: 100) {
          nodes {
            author { login }
            body
            submittedAt
          }
        }
        reviewThreads(first: 100) {
          nodes {
            isCollapsed
            comments(first: 100) {
              nodes {
                body
                isMinimized
                outdated
                path
                line
                originalLine
                diffHunk
                author { login }
                createdAt
              }
            }
          }
        }
      }
    }
  }
'

echo ""
echo "=== PR Diff ==="
gh pr diff "$PR_NUM" -R "$OWNER/$REPO_NAME"
