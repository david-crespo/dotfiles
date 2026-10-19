#! /usr/bin/env bash
# List outdated brew packages worth acting on: formulae installed on request,
# security-sensitive libraries even when they're only dependencies, and casks.
# Everything else is collapsed into a count. --all shows the plain list.

set -euo pipefail

brew_dir="$(dirname "$(realpath "$0")")/../brew"

if [[ "${1:-}" == "--all" ]]; then
  exec brew outdated --verbose
fi

# strip comments and blank lines
read_list() { sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$1"; }

outdated_json=$(brew outdated --json=v2)

jq --raw-output \
  --argjson leaves "$(brew leaves --installed-on-request | jq --raw-input . | jq --slurp .)" \
  --argjson security "$(read_list "$brew_dir/outdated-security.txt" | jq --raw-input . | jq --slurp .)" \
  --argjson exclude "$(read_list "$brew_dir/outdated-exclude.txt" | jq --raw-input . | jq --slurp .)" \
  '
  def fmt(sep): "\(.name) (\(.installed_versions | join(", "))) \(sep) \(.current_version)";
  def short: .name | split("/") | last;
  (.formulae | map(select((short | IN($exclude[]) | not)))) as $formulae
  | ($formulae | map(select(short | IN($security[])))) as $sec
  | ($formulae | map(select((short | IN($leaves[])) and (short | IN($security[]) | not)))) as $mine
  | ($formulae | length) - ($sec | length) - ($mine | length) as $rest
  | (.casks | map(select(short | IN($exclude[]) | not))) as $casks
  | ($sec | map("\(fmt("<"))  [security]"))
    + ($mine | map(fmt("<")))
    + ($casks | map(fmt("!=")))
    + (if $rest > 0 then ["+\($rest) dependency updates (--all to list)"] else [] end)
  | .[]
  ' <<<"$outdated_json"
