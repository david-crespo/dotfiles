#!/bin/zsh

function prompt_pwd() {
  local pwd=$PWD

  # replace leading $HOME/repos/ with empty string
  pwd=${pwd/#$HOME\/repos\//}
  # replace leading $HOME/oxide/ with empty string
  pwd=${pwd/#$HOME\/oxide\//}
  # replace leading $HOME/ with ~
  pwd=${pwd/#$HOME/\~}

  echo "$pwd"
}

# jj prompt logic based on https://github.com/jj-vcs/jj/wiki/Shell-Prompt
# but heavily modified

function is_jj_or_git() {
  local dir=$PWD
  while [[ $dir != "/" ]]; do
    [[ -d $dir/.jj ]] && echo jj && return
    [[ -d $dir/.git ]] && echo git && return
    dir=${dir:h} # remove last segment, i.e., move up a dir
  done
}

function jjgit_prompt() {
  local vcs="$(is_jj_or_git)" # jj, git, or ""
  if [[ $vcs = jj ]]; then
    # --ignore-working-copy means don't look at files and update jj state
    jj log -r @ --ignore-working-copy --no-pager --no-graph --color=always \
      -T 'zsh_prompt_summary(self, bookmarks)' 2>/dev/null
  elif [[ $vcs = git ]]; then
    local gitprompt=$(git --no-pager log -1 --pretty='%D' 2>/dev/null)
    gitprompt="${gitprompt/HEAD -> /}"
    [[ $gitprompt == "HEAD" ]] && gitprompt="detached: $(git log -1 --color=always --oneline)"
    echo "[$gitprompt]"
  fi
}

function ps1_jjgit_prompt() {
  local jgp=$(jjgit_prompt)
  local pwd=$(prompt_pwd)
  PROMPT="%K{green}%F{black} ${pwd} %f%k %{${jgp}%}
\$ "
}

precmd_functions+=(ps1_jjgit_prompt)

# ctrl-xe to edit command in $EDITOR
autoload -U edit-command-line
# # Emacs style shortcuts
zle -N edit-command-line
bindkey '^xe' edit-command-line
bindkey '^x^e' edit-command-line
# needed to make cmd+backspace esc:w work in ghostty
bindkey '\ew' backward-kill-line

export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

export HOMEBREW_NO_ENV_HINTS=1
export EDITOR=hx
export HISTSIZE=10000

source <(fzf --zsh)

export DENO_INSTALL="/Users/david/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"

# bun completions
[ -s "/Users/david/.bun/_bun" ] && source "/Users/david/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

eval "$(atuin init zsh --disable-up-arrow)"

autoload -U compinit
compinit
eval "$(zoxide init zsh)"

source <(COMPLETE=zsh jj)
