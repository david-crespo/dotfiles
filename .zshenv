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

# used in helix, see config
function copy_path() {
  local buffer_name="$1"
  echo -n $buffer_name | pbcopy
  echo "Copied '${buffer_name}' to system clipboard"
}

alias format_sql='cockroach sqlfmt --print-width 80 --use-spaces'
