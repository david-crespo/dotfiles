#!/bin/zsh

# Used by helix blame shortcut to get the most recent commit that will not 404
# on GitHub. Solves the problem of trying to open a blame on a commit that's not
# pushed yet.
function latest_pushed_commit() {
  local current_branch=$(git rev-parse --abbrev-ref HEAD)
  local current_commit=$(git rev-parse HEAD)
  local remote_commit=$(git ls-remote origin $current_branch | cut -f1)
  local main_commit=$(git ls-remote origin main | cut -f1)

  if [ "$current_commit" = "$remote_commit" ]; then
    echo $current_commit
  elif [ -n "$remote_commit" ]; then
    echo $remote_commit
  else
    echo $main_commit
  fi
}

function stag() {
  echo "<xxx>"
  cat
  echo "</xxx>"
}

alias format_sql='cockroach sqlfmt --print-width 80 --use-spaces'

# this is here for nushell
export XDG_CONFIG_HOME="$HOME/.config"

function oxfmt-stdin() {
  local ext="${1:-ts}"
  local temp_file="$(mktemp /tmp/oxfmt.${ext})"
 
  cat > "$temp_file"
  bunx oxfmt "$temp_file" > /dev/null
  cat "$temp_file"
  rm "$temp_file"
}
