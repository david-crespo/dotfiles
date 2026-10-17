#!/usr/bin/env bash
# Build a structural digest of a TypeScript repo for a context-free
# architecture review: the agent docs, optionally a CLI's help tree, and for
# every source file its size, its leading comment, its internal imports, and
# its declaration file (exported types and signatures with doc comments, no
# bodies), or with --full, its whole source. Above the files, import counts
# between top-level directories.
#
# Usage: digest.sh [--cli <command>] [--exclude <regex>] [--full <file>]... <output.md>
# Run from the repo root. Test files are listed by size only. scripts/ and
# *.config.* files are left out as build tooling.

set -euo pipefail

here=$(dirname "${BASH_SOURCE[0]}")
cli=""
exclude='^$'
full=""
while [[ $# -gt 1 ]]; do
  case "$1" in
    --cli) cli="$2"; shift 2 ;;
    --exclude) exclude="$2"; shift 2 ;;
    --full) full+="$2"$'\n'; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
out="${1:?usage: digest.sh [--cli <command>] [--exclude <regex>] [--full <file>]... <output.md>}"

if [[ -d .jj ]]; then files=$(jj file list); else files=$(git ls-files); fi
files=$(printf '%s\n' "$files" | command grep -vE '^\.claude/|(^|/)node_modules/|(^|/)dist/|^scripts/|(^|/)[^/]+\.config\.[cm]?[jt]s$' | command grep -vE "$exclude" | sort)
sources=$(printf '%s\n' "$files" | command grep -E '\.(ts|tsx|mts|mjs)$' | command grep -vE '\.test\.|\.spec\.|\.d\.ts$' || true)
tests=$(printf '%s\n' "$files" | command grep -E '\.(test|spec)\.' || true)

# An explicit template, since a bare mktemp -d ignores TMPDIR on macOS
dts=$(mktemp -d "${TMPDIR:-/tmp}/digest.XXXXXX")
trap 'rm -rf "$dts"' EXIT
# Declarations for everything tsc can see; errors in the project don't stop emit
npx --no-install tsc --declaration --emitDeclarationOnly --noEmit false \
  --outDir "$dts" --removeComments false >/dev/null 2>&1 || true
printf '%s\n' "$sources" | node "$here/imports.mjs" "$dts"

lines() { wc -l < "$1" | tr -d ' '; }
bytes() { wc -c < "$1" | tr -d ' '; }

{
  echo "# Codebase digest: $(basename "$PWD")"
  for doc in AGENTS.md CLAUDE.md README.md; do
    if [[ -f $doc && $(bytes "$doc") -lt 20000 ]]; then
      echo; echo "## $doc"; echo; cat "$doc"
    fi
  done

  if [[ -n $cli ]]; then
    echo; echo "## CLI (\`$cli --help\` and each command's subcommands)"; echo; echo '```'
    $cli --help 2>&1
    # Commander-style help: command names indented under "Commands:"
    for c in $($cli --help 2>&1 | awk '/^Commands:/ {on=1; next} on && /^  [a-z]/ {print $1}' | command grep -v '^help$'); do
      echo; echo "--- $cli $c --help"
      $cli "$c" --help 2>&1 | sed -n '/^Commands:/,$p'
    done
    echo '```'
  fi

  echo; echo "## Imports between top-level directories"; echo
  echo "How many files in one directory import files in another, counting each importing and imported file pair once. Root-level files are their own group."
  echo; echo '```'; cat "$dts/edges.txt"; echo '```'

  echo; echo "## Files"; echo
  echo "Every non-test source file, with its size, its leading comment, the repo files it imports (type-only and dynamic imports included), and its declaration file (tsc --emitDeclarationOnly: exported types and signatures with their doc comments; function bodies and unexported code are omitted). A file marked \"full source\" is shown whole instead."
  if [[ -n $tests ]]; then
    echo; printf 'Test files: '
    while read -r t; do printf '%s (%s lines), ' "$t" "$(lines "$t")"; done <<< "$tests"
    echo
  fi

  while read -r f; do
    [[ -z $f ]] && continue
    echo; echo "### $f ($(lines "$f") lines, $(bytes "$f") bytes)"
    header=$(awk 'NR==1 && /^\/\/\/ </ {next} /^\/\// {print; seen=1; next} seen || NF {exit}' "$f")
    imports=$(awk -F'\t' -v f="$f" '$1 == f {print $2}' "$dts/imports.tsv")
    if [[ -n $imports ]]; then echo; echo "Imports: $imports"; fi
    if printf '%s' "$full" | command grep -qFx "$f"; then
      echo; echo "Full source:"; echo; echo '```ts'; cat "$f"; echo '```'
      continue
    fi
    if [[ -n $header ]]; then echo; echo '```'; echo "$header"; echo '```'; fi
    # Imports are listed above; the declaration file keeps only the type ones
    d="$dts/${f%.*}.d.ts"
    if [[ -f $d ]] && [[ $(command grep -cvE '^export \{\};$|^import ' "$d") -gt 0 ]]; then
      echo; echo '```ts'; command grep -vE '^export \{\};$|^import ' "$d"; echo '```'
    fi
  done <<< "$sources"
} > "$out"

# Files with exports in the source but no declarations in the digest
missing=0
while read -r f; do
  [[ -z $f ]] && continue
  if command grep -qE '^export ' "$f" && [[ ! -f "$dts/${f%.*}.d.ts" ]]; then
    echo "no declarations for $f" >&2
    missing=$((missing + 1))
  fi
done <<< "$sources"
echo "$out: $(bytes "$out") bytes, $(printf '%s\n' "$sources" | command grep -c .) files, $missing missing declarations" >&2
