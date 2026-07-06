#!/usr/bin/env bash
# Write clipboard contents (or stdin, if piped) to an Obsidian bot note.
#
# Usage: clip-bot-note <name>
#
# Appends if the note already exists, creates it otherwise. Prints an
# obsidian:// link.
set -euo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: clip-bot-note <name>" >&2
  exit 1
fi
name="$1"

if [ -t 0 ]; then
  content=$(pbpaste)
else
  content=$(cat)
fi

if [ -z "${content//[$'\n\t ']/}" ]; then
  echo "clip-bot-note: no content" >&2
  exit 1
fi

path=$(obsidian-notes bot:path "$name")
if [ -f "$path" ]; then verb="updated"; else verb="created"; fi

printf '%s' "$content" | obsidian-notes bot:append "$name"

# path is <vault>/Base files/Bot notes/<name>.md; the vault name is the
# basename three levels up
vault=$(basename "$(dirname "$(dirname "$(dirname "$path")")")")
vault_enc=$(jq --raw-output --null-input --arg s "$vault" '$s|@uri')
name_enc=$(jq --raw-output --null-input --arg s "$name" '$s|@uri')
echo "Note $verb at [$name](obsidian://open?vault=$vault_enc&file=$name_enc)"
