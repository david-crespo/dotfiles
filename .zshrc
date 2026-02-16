#!/bin/zsh

# zellij panes are non-login shells, so source .zprofile for aliases and PATH
[[ -n $ZELLIJ ]] && source ~/.zprofile

function prompt_pwd() {
  local pwd=$PWD

  # replace leading $HOME/repos/ with empty string
  pwd=${pwd/#$HOME\/repos\//}
  # replace leading $HOME/oxide/ with empty string
  pwd=${pwd/#$HOME\/oxide\//}
  # replace leading $HOME/jj-workspaces/ with empty string
  pwd=${pwd/#$HOME\/jj-workspaces\//}
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
    local prompt=$(jj log -r @ --ignore-working-copy --no-pager --no-graph --color=always \
      -T 'zsh_prompt_summary(self, bookmarks)' 2>/dev/null)

    # Find nearest ancestor bookmark and distance to it.
    # The revset selects the nearest bookmarked ancestor and all commits from
    # there to @. With --reversed, the bookmark commit comes first.
    # Template outputs "B:name" for the bookmark commit, "." for others.
    # Use local_bookmarks() to avoid duplicates from remote tracking bookmarks.
    local raw=$(jj log -r 'heads(::@ & bookmarks())::@' \
      --ignore-working-copy --no-pager --no-graph --reversed \
      -T 'if(self.local_bookmarks().len() > 0, "B:" ++ self.local_bookmarks().map(|b| b.name()).join(" "), ".") ++ "\n"' 2>/dev/null)

    if [[ -n $raw ]]; then
      # Take first bookmark only (space-separated), truncate with ellipsis
      local bookmark=$(echo "$raw" | grep '^B:' | head -1 | cut -c3- | cut -d' ' -f1)
      if [[ ${#bookmark} -gt 14 ]]; then
        bookmark="${bookmark:0:14}…"
      fi
      # distance = number of commits after bookmark (the "." lines)
      local distance=$(echo "$raw" | grep -c '^\.$')

      if [[ -n $bookmark ]]; then
        if [[ $distance -gt 0 ]]; then
          # gray the +N suffix to match jj's dimmed chars
          prompt=$'\e[38;5;5m'"${bookmark}"$'\e[38;5;8m'"+${distance}"$'\e[0m'" ${prompt}"
        else
          prompt=$'\e[38;5;5m'"${bookmark}"$'\e[0m'" ${prompt}"
        fi
      fi
    fi

    echo "$prompt"
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

# we're also going to set the title to the abbreviated thing when we open a new shell
function set_title() {
  echo -ne "\033]0;$1\007"
}

# zsh hook to update title on directory change
function chpwd() {
  set_title "$(prompt_pwd)"
}

set_title "$(prompt_pwd)"

# ctrl-xe to edit command in $EDITOR
autoload -U edit-command-line
# # Emacs style shortcuts
zle -N edit-command-line
bindkey '^xe' edit-command-line
bindkey '^x^e' edit-command-line
# needed to make cmd+backspace esc:w work in ghostty
bindkey '\ew' backward-kill-line

# ctrl-z toggles between shell and a suspended process (e.g., helix)
fancy-ctrl-z () {
  if [[ $#BUFFER -eq 0 ]]; then
    BUFFER="fg"
    zle accept-line
  else
    zle push-input
    zle clear-screen
  fi
}
zle -N fancy-ctrl-z
bindkey '^Z' fancy-ctrl-z

# disable history expansion so I can type ! in commit messages with impunity
setopt NO_BANG_HIST

export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
export PATH="$HOME/go/bin:$PATH"

export HOMEBREW_NO_ENV_HINTS=1
export EDITOR=hx
export HISTSIZE=10000

source <(fzf --zsh)
# works to exclude a lot but means you can't look inside node_modules
export FZF_CTRL_T_COMMAND='fd --type f --hidden --follow --exclude .git --exclude .jj'

export DENO_INSTALL="/Users/david/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"

# bun completions
[ -s "/Users/david/.bun/_bun" ] && source "/Users/david/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

eval "$(atuin init zsh --disable-up-arrow)"

fpath=(~/.zsh/completion $fpath)
autoload -U compinit
compinit
eval "$(zoxide init zsh)"

source <(COMPLETE=zsh jj)
. "/Users/david/.deno/env"

# Added by LM Studio CLI (lms)
export PATH="$PATH:/Users/david/.lmstudio/bin"
# End of LM Studio CLI section

# opencode
export PATH=/Users/david/.opencode/bin:$PATH


# BEGIN opam configuration
# This is useful if you're using opam as it adds:
#   - the correct directories to the PATH
#   - auto-completion for the opam binary
# This section can be safely removed at any time if needed.
[[ ! -r '/Users/david/.opam/opam-init/init.zsh' ]] || source '/Users/david/.opam/opam-init/init.zsh' > /dev/null 2> /dev/null
# END opam configuration
