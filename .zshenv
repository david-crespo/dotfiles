#!/bin/zsh

# Wrapper around LLM CLI meant for direct inline use with pipe: in helix.
#
# -m sonnet is a default that can be overridden by passing -m again
alias hxai='ai --ephemeral --raw --system "You are part of a code completion system in a text editor. You will receive some code to replace, followed by a prompt. Your output will be inserted directly into a text file, so only output code -- do not wrap it in a markdown code block and do NOT include prose commentary or explanation. If you are asked to modify only part of the code, make sure to include the unchanged parts in the output so they can be reinserted as-is in the target file. Do NOT wrap the code in a markdown code block with backticks."'

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
