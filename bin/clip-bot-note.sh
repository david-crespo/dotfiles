#!/usr/bin/env bash
# Write clipboard contents (or stdin, if piped) to an Obsidian bot note, a
# plain file in the vault's Bot notes folder.
#
# Usage: clip-bot-note <name>
#
# Appends if the note already exists, creates it otherwise. Prints an
# obsidian:// link.
set -euo pipefail

vault=obsidian
dir="$HOME/$vault/Bot notes"

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: clip-bot-note <name>" >&2
  exit 1
fi
name="$1"

# The name is a file name in the folder, never a path out of it
case "$name" in
  */* | .*)
    echo "clip-bot-note: name can't contain / or start with ." >&2
    exit 1
    ;;
esac

if [ -t 0 ]; then
  content=$(pbpaste)
else
  content=$(cat)
fi

if [ -z "${content//[$'\n\t ']/}" ]; then
  echo "clip-bot-note: no content" >&2
  exit 1
fi

path="$dir/$name.md"
if [ -f "$path" ]; then
  verb="updated"
  printf '\n\n%s\n' "$content" >>"$path"
else
  verb="created"
  printf -- '---\ncreated: %s\n---\n%s\n' "$(date +%Y-%m-%dT%H:%M)" "$content" >"$path"
fi

name_enc=$(jq --raw-output --null-input --arg s "$name" '$s|@uri')
echo "Note $verb at [$name](obsidian://open?vault=$vault&file=$name_enc)"
