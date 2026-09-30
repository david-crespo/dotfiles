#!/usr/bin/env zsh

# Live view of a tracker note (.claude/notes/*-tracker.md). glow's TUI watches
# the file itself and keeps scroll position across reloads.
#
#   tracker [file]          view file, or the newest tracker in this repo's notes
#   tracker --split [file]  open the view in a new Ghostty split above the
#                           terminal this runs in (via gpane), so an agent can
#                           pop it up next to itself

set -euo pipefail

# -D removes --split from $@, -E allows it after the file, -F rejects unknown flags
zparseopts -D -E -F -- -split=split

if (( $# )); then
  file=${1:A}
else
  root=$(jj root 2>/dev/null || git rev-parse --show-toplevel)
  # (N) makes an empty glob expand to nothing, om sorts newest first
  trackers=("$root"/.claude/notes/*-tracker.md(Nom))
  (( $#trackers )) || { echo "no *-tracker.md in $root/.claude/notes" >&2; exit 1 }
  file=$trackers[1]
fi

(( $#split )) || exec glow --tui "$file"

# 35% of the caller's pane, focus stays with the caller. Prints the new pane's id.
exec gpane split self up --size 35% -- glow --tui "$file"
