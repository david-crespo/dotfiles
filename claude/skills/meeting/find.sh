#!/usr/bin/env bash
set -euo pipefail

# Find four-star entries for a given date, optionally filtered by title substring.
# Handles auth preflight (four-star list silently returns empty on 401) and
# widens the date window by one day on each side to catch meetings near
# midnight UTC.

usage() {
  cat <<'EOF'
Usage: find.sh <YYYY-MM-DD> [title-substring] [--widen N]

Lists four-star recordings created within ±N days of the given date
(default N=1), optionally filtered by a case-insensitive title substring.

Output: JSON array of matches with fields name, created_at, recording_id,
transcript_external_id (or null), drive link.
EOF
  exit 1
}

[[ $# -lt 1 ]] && usage
case "$1" in -h|--help) usage ;; esac

date="$1"; shift
title=""
widen=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --widen) widen="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) title="$1"; shift ;;
  esac
done

# Preflight: four-star list returns empty + exit 0 on 401, so probe explicitly.
if ! four-star self >/dev/null 2>&1; then
  echo "four-star auth failed. Run 'four-star auth login google' in your terminal." >&2
  exit 2
fi

newer=$(date -j -v-"${widen}"d -f '%Y-%m-%d' "$date" '+%Y-%m-%d')
older=$(date -j -v+"${widen}"d -f '%Y-%m-%d' "$date" '+%Y-%m-%d')

four-star -f json list --newer "$newer" --older "$older" --limit 100 \
  | jq -s --arg t "$title" '
      [ .[]
        | select($t == "" or (.name | test($t; "i")))
        | { name, created_at, recording_id,
            transcript_external_id: (.transcript_external_id // null),
            drive: .links.drive }
      ]
    '
