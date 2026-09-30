#!/usr/bin/env zsh

# Live view of a tracker note (.claude/notes/*-tracker.md). glow's TUI watches
# the file itself and keeps scroll position across reloads.
#
#   tracker [file]          view file, or the newest tracker in this repo's notes
#   tracker --split [file]  open the view in a new Ghostty split above the
#                           terminal this runs in (found by its TTY), so an
#                           agent can pop it up next to itself

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

# GHOSTTY_TERMINAL_TTY is exported by .zshrc. Agents run commands without a
# controlling terminal, so `tty` doesn't work there, but they inherit the env.
tty=${GHOSTTY_TERMINAL_TTY:?not in a Ghostty terminal}

# Splits come out 50/50. To leave the tracker 35% of the pane, read the pane's
# height in backing pixels (TIOCGWINSZ ws_ypixel) and move the divider up by
# 15% of it. resize_split counts in points, hence the backingScaleFactor.
height=$(python3 -c '
import fcntl, os, struct, sys, termios
fd = os.open(sys.argv[1], os.O_RDONLY | os.O_NOCTTY)
print(struct.unpack("HHHH", fcntl.ioctl(fd, termios.TIOCGWINSZ, bytes(8)))[3])
' "$tty")

osascript - "$tty" "exec glow --tui ${(q)file}"$'\n' "$height" <<'EOF'
use framework "AppKit"

on run argv
  set targetTty to item 1 of argv
  set cmd to item 2 of argv
  set scale to (current application's NSScreen's mainScreen()'s backingScaleFactor()) as real
  set shrink to ((item 3 of argv as integer) * 0.15 / scale) div 1
  tell application "Ghostty"
    repeat with targetWindow in windows
      repeat with targetTab in tabs of targetWindow
        repeat with targetTerminal in terminals of targetTab
          if (tty of targetTerminal as text) is targetTty then
            set cfg to new surface configuration
            set initial input of cfg to cmd
            set trackerTerminal to split targetTerminal direction up with configuration cfg
            perform action ("resize_split:up," & shrink) on trackerTerminal
            focus targetTerminal
            return
          end if
        end repeat
      end repeat
    end repeat
  end tell
  error "no Ghostty terminal with tty " & targetTty
end run
EOF
