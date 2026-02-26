#!/usr/bin/env bash
set -euo pipefail

# Summarize recent GitHub activity for the authenticated user.
# Combines gh search (for PRs/issues with titles) and the events API
# (for comments and reviews) into a compact overview.

DAYS="${1:-7}"
USERNAME=$(gh-api-read /user | jq -r .login 2>/dev/null)

usage() {
  cat <<'EOF'
Usage: gh-activity [days]

Summarize recent GitHub activity (default: 7 days).

Output sections:
  Open PRs       - PRs you authored that are still open
  Merged PRs     - PRs you authored, recently merged
  Reviews        - PRs by others that you reviewed
  Issues         - Issues you opened recently
  Comments       - Recent issue/PR comments (from events API)
EOF
  exit 0
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage

DATE_SINCE=$(date -v-"${DAYS}"d '+%Y-%m-%d')

# --- Open PRs I authored ---
echo "## Open PRs"
gh search prs --author="$USERNAME" --state=open --sort=updated --limit=20 \
  --json repository,title,number,updatedAt,url \
  | jq -r --arg since "$DATE_SINCE" '
    [.[] | select(.updatedAt >= $since)] |
    if length == 0 then "  (none)\n"
    else .[] | "  \(.repository.nameWithOwner)#\(.number): \(.title)\n    \(.url)"
    end
  '
echo

# --- Recently merged PRs ---
echo "## Merged PRs"
gh search prs --author="$USERNAME" --merged --sort=updated --limit=20 \
  --json repository,title,number,updatedAt,url \
  | jq -r --arg since "$DATE_SINCE" '
    [.[] | select(.updatedAt >= $since)] |
    if length == 0 then "  (none)\n"
    else .[] | "  \(.repository.nameWithOwner)#\(.number): \(.title)\n    \(.url)"
    end
  '
echo

# --- PRs I reviewed ---
echo "## Reviews"
gh search prs --reviewed-by="$USERNAME" --sort=updated --limit=20 \
  --json repository,title,number,state,updatedAt,url \
  | jq -r --arg since "$DATE_SINCE" --arg me "$USERNAME" '
    [.[] | select(.updatedAt >= $since)] |
    if length == 0 then "  (none)\n"
    else .[] | "  \(.repository.nameWithOwner)#\(.number) [\(.state)]: \(.title)\n    \(.url)"
    end
  '
echo

# --- Issues I opened ---
echo "## Issues opened"
gh search issues --author="$USERNAME" --sort=created --limit=20 \
  --json repository,title,number,state,createdAt,url \
  | jq -r --arg since "$DATE_SINCE" '
    [.[] | select(.createdAt >= $since)] |
    if length == 0 then "  (none)\n"
    else .[] | "  \(.repository.nameWithOwner)#\(.number) [\(.state)]: \(.title)\n    \(.url)"
    end
  '
echo

# --- Recent comments from events API ---
echo "## Recent comments"
gh-api-read "/users/$USERNAME/events?per_page=100" \
  | jq -r --arg since "$DATE_SINCE" '
    [.[] |
     select(.created_at >= $since) |
     select(.type | IN("IssueCommentEvent", "PullRequestReviewCommentEvent")) |
     {
       repo: .repo.name,
       type: (if .type == "IssueCommentEvent" then "comment"
              else "review comment" end),
       body: (.payload.comment.body | split("\n")[0] | .[:100]),
       number: (.payload.comment.issue_url // .payload.comment.pull_request_url
                | split("/") | last),
       api_path: (.payload.comment.url | ltrimstr("https://api.github.com")),
       html_url: .payload.comment.html_url,
       created_at: .created_at
     }
    ] |
    if length == 0 then "  (none)\n"
    else .[] | "  \(.repo)#\(.number) (\(.type)): \(.body)\n    api: \(.api_path)  \(.html_url)"
    end
  '
