#!/usr/bin/env zsh

# Usage:
#
#   echo $(edit-cmd)
#
# to get an editor that lets you edit that string and outputs it on exit. Handy
# for commands expecting code in a particular language because you can give it
# file extension and get syntax highlighting in the editor:
#
#   cat package.json | dq $(edit-cmd ts)

EXT=${1:-txt} # Get the file ext from args or default to txt
EXT=${EXT#.}  # Remove leading dot if present

TMPFILE=$(mktemp "/tmp/edit-cmd.EXT")

EDITOR=${EDITOR:-vim}
$EDITOR $TMPFILE

# Check editor's exit status
EDITOR_STATUS=$?
if [ $EDITOR_STATUS -ne 0 ]; then
  echo "Editor exited with error code $EDITOR_STATUS" >&2
  rm "$TMPFILE"
  exit $EDITOR_STATUS
fi

cat $TMPFILE
rm $TMPFILE
