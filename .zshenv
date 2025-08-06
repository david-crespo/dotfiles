#!/bin/zsh

# Wrapper around LLM CLI meant for direct inline use with pipe: in helix.
function hxai() {
  local system_prompt=$(cat << 'EOF'
You are part of a code completion system in a text editor. You will receive
some code to replace, followed by a prompt. Your output will be inserted
directly into a text file as raw text.

CRITICAL: Output ONLY the code itself. Do NOT use markdown formatting, code
fences, backticks, or any other markup. Do NOT include explanatory text,
comments, or prose.

If you are asked to modify only part of the code, make sure to include the
unchanged parts in the output so they can be reinserted as-is in the target file.

Your response should start immediately with the first character of code and
end with the last character of code.
EOF
)
  ai --ephemeral --raw --system "$system_prompt" "$@"
}

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
