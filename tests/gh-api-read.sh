#!/usr/bin/env bash
# Tests for gh-api-read. Verifies that write operations are blocked
# and read operations pass through.

set -uo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
GH_API_READ="$script_dir/../bin/gh-api-read.ts"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$tmp_dir/bin"
stub_ran="$tmp_dir/stub-ran"
stub_args_file="$tmp_dir/stub-args"
stub_exit=7

cat >"$tmp_dir/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1-}" != "api" ]]; then
  echo "unexpected subcommand: ${1-}" >&2
  exit 2
fi

if [[ "${GH_HOST-}" != "github.com" ]]; then
  echo "expected GH_HOST=github.com, got: ${GH_HOST-<unset>}" >&2
  exit 3
fi

touch "${GH_API_READ_TEST_STUB_RAN:?}"
printf '%s\n' "$@" > "${GH_API_READ_TEST_STUB_ARGS_FILE:?}"
exit "${GH_API_READ_TEST_STUB_EXIT:?}"
EOF
chmod +x "$tmp_dir/bin/gh"
GH_API_READ_TEST_STUB_RAN="$stub_ran"
GH_API_READ_TEST_STUB_ARGS_FILE="$stub_args_file"
GH_API_READ_TEST_STUB_EXIT="$stub_exit"
export GH_API_READ_TEST_STUB_RAN GH_API_READ_TEST_STUB_ARGS_FILE GH_API_READ_TEST_STUB_EXIT
PATH="$tmp_dir/bin:$PATH"

passed=0
failed=0

# Assert that a command exits non-zero (should be blocked)
expect_blocked() {
  local desc="$1"
  shift
  rm -f "$stub_ran"
  rm -f "$stub_args_file"
  if "$GH_API_READ" "$@" >/dev/null 2>&1; then
    echo "FAIL: $desc (expected block, got success)"
    ((failed++))
  elif [[ -e "$stub_ran" ]]; then
    echo "FAIL: $desc (expected block, stub ran)"
    ((failed++))
  else
    echo "ok: $desc"
    ((passed++))
  fi
}

# Assert that a command passes through to gh (should be allowed)
expect_allowed() {
  local desc="$1"
  shift
  rm -f "$stub_ran"
  rm -f "$stub_args_file"
  "$GH_API_READ" "$@" >/dev/null 2>&1
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "FAIL: $desc (expected stub exit $stub_exit, got success)"
    ((failed++))
  elif [[ ! -e "$stub_ran" ]]; then
    echo "FAIL: $desc (expected stub run, got wrapper block)"
    ((failed++))
  elif [[ $rc -ne "$stub_exit" ]]; then
    echo "FAIL: $desc (expected exit $stub_exit, got $rc)"
    ((failed++))
  else
    echo "ok: $desc"
    ((passed++))
  fi
}

# Assert that a command passes through and contains a given arg substring
expect_allowed_with_args() {
  local desc="$1"
  local needle="$2"
  shift 2
  rm -f "$stub_ran"
  rm -f "$stub_args_file"
  "$GH_API_READ" "$@" >/dev/null 2>&1
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "FAIL: $desc (expected stub exit $stub_exit, got success)"
    ((failed++))
  elif [[ ! -e "$stub_ran" ]]; then
    echo "FAIL: $desc (expected stub run, got wrapper block)"
    ((failed++))
  elif [[ $rc -ne "$stub_exit" ]]; then
    echo "FAIL: $desc (expected exit $stub_exit, got $rc)"
    ((failed++))
  elif ! rg -n --fixed-strings "$needle" "$stub_args_file" >/dev/null 2>&1; then
    echo "FAIL: $desc (expected args to include: $needle)"
    echo "args:"
    sed -n '1,120p' "$stub_args_file"
    ((failed++))
  else
    echo "ok: $desc"
    ((passed++))
  fi
}

expect_allowed_graphql_stdin() {
  local desc="$1"
  local query="$2"
  rm -f "$stub_ran"
  rm -f "$stub_args_file"
  printf '%s' "$query" | "$GH_API_READ" graphql >/dev/null 2>&1
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "FAIL: $desc (expected stub exit $stub_exit, got success)"
    ((failed++))
  elif [[ ! -e "$stub_ran" ]]; then
    echo "FAIL: $desc (expected stub run, got wrapper block)"
    ((failed++))
  elif [[ $rc -ne "$stub_exit" ]]; then
    echo "FAIL: $desc (expected exit $stub_exit, got $rc)"
    ((failed++))
  else
    echo "ok: $desc"
    ((passed++))
  fi
}

expect_blocked_graphql_stdin() {
  local desc="$1"
  local query="$2"
  rm -f "$stub_ran"
  rm -f "$stub_args_file"
  if printf '%s' "$query" | "$GH_API_READ" graphql >/dev/null 2>&1; then
    echo "FAIL: $desc (expected block, got success)"
    ((failed++))
  elif [[ -e "$stub_ran" ]]; then
    echo "FAIL: $desc (expected block, stub ran)"
    ((failed++))
  else
    echo "ok: $desc"
    ((passed++))
  fi
}

# -- Blocked: --method / -X variants --
expect_blocked "--method POST"          --method POST repos/foo
expect_blocked "--method=POST"          --method=POST repos/foo
expect_blocked "-X POST"               -X POST repos/foo
expect_blocked "-XPOST"                -XPOST repos/foo
expect_blocked "--method DELETE"        --method DELETE repos/foo
expect_blocked "--method PATCH"         --method PATCH repos/foo
expect_blocked "--method PUT"           --method PUT repos/foo

# -- Blocked: field flags --
expect_blocked "-f key=val"             -f key=val repos/foo
expect_blocked "-fkey=val"              -fkey=val repos/foo
expect_blocked "--raw-field key=val"    --raw-field key=val repos/foo
expect_blocked "--raw-field=key=val"    --raw-field=key=val repos/foo
expect_blocked "-F key=val"             -F key=val repos/foo
expect_blocked "-Fkey=val"              -Fkey=val repos/foo
expect_blocked "--field key=val"        --field key=val repos/foo
expect_blocked "--field=key=val"        --field=key=val repos/foo

# -- Blocked: --input --
expect_blocked "--input file.json"      --input file.json repos/foo
expect_blocked "--input=file.json"      --input=file.json repos/foo
expect_blocked "--input -"              --input - repos/foo

# -- Blocked: host / URL escape hatches --
expect_blocked "--hostname github.com"  --hostname github.com repos/foo
expect_blocked "--hostname=github.com"  --hostname=github.com repos/foo
expect_blocked "absolute URL endpoint"  https://evil.example/foo

# -- Blocked: headers (no headers allowed, eliminates method override surface) --
expect_blocked "-H header"              -H 'Accept: application/json' repos/foo
expect_blocked "--header"               --header='Accept: application/json' repos/foo

# -- Blocked: unknown flags --
expect_blocked "unknown flag"           --definitely-not-a-flag repos/foo
expect_blocked "--graphql-query-file"   graphql --graphql-query-file query.graphql

# -- Allowed: read-only operations --
# --help is handled by cliffy directly (shows wrapper's own help, exits 0)
if "$GH_API_READ" --help >/dev/null 2>&1; then
  echo "ok: --help (exits 0)"
  ((passed++))
else
  echo "FAIL: --help (expected exit 0)"
  ((failed++))
fi
expect_allowed "simple GET"             repos/anthropics/claude-code/releases --jq '.[0].tag_name'
expect_allowed "GET with --paginate"    repos/anthropics/claude-code/releases --paginate --jq '.[0].tag_name'
expect_allowed "GET with -q"            repos/anthropics/claude-code/releases -q '.[0].tag_name'

# -- Allowed: graphql reads --
expect_allowed_with_args "graphql with --graphql-query" "graphql" graphql \
  --graphql-query 'query { viewer { login } }'
expect_allowed_with_args "/graphql with --graphql-query" "graphql" /graphql \
  --graphql-query 'query { viewer { login } }'
expect_allowed_with_args "graphql query uses -f query=" "query=query { viewer { login } }" graphql \
  --graphql-query 'query { viewer { login } }'
expect_allowed_graphql_stdin "graphql from stdin" 'query { viewer { login } }'

# -- Blocked: graphql mutations --
expect_blocked "graphql leading comment (--graphql-query)" graphql \
  --graphql-query $'# hello\nquery { viewer { login } }'
expect_blocked "graphql mutation (--graphql-query)" graphql \
  --graphql-query 'mutation { updateUserStatus(input: { emoji: \":\" }) { status { emoji } } }'
expect_blocked "graphql mutation after comment (--graphql-query)" graphql \
  --graphql-query $'# hello\nmutation { updateUserStatus(input: { emoji: \":\" }) { status { emoji } } }'
expect_blocked_graphql_stdin "graphql mutation (stdin)" \
  'mutation { updateUserStatus(input: { emoji: \":\" }) { status { emoji } } }'
expect_blocked_graphql_stdin "graphql mutation after comment (stdin)" \
  $'# hello\nmutation { updateUserStatus(input: { emoji: \":\" }) { status { emoji } } }'

echo ""
echo "$((passed + failed)) tests: $passed passed, $failed failed"
exit $((failed > 0 ? 1 : 0))
