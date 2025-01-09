#!/bin/zsh

# modify the prompt to display the path and place the shell indicator ($) in a new line.
setopt prompt_subst
export PROMPT='%K{green}%F{black} %~ %f%k
\$ '

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
