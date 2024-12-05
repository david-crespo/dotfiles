#!/bin/zsh

autoload -Uz vcs_info
precmd_vcs_info() { vcs_info }
precmd_functions+=( precmd_vcs_info )
setopt prompt_subst
RPROMPT=''  # clear the right-side prompt
zstyle ':vcs_info:git:*' formats '%F{250}[%b]%f'  # add brackets around the git branch
zstyle ':vcs_info:*' enable git

# modify the prompt to display the path, git branch and place the shell indicator ($) in a new line.
export PROMPT='%K{green}%F{black} %~ %f%k ${vcs_info_msg_0_}
\$ '

# ctrl-xe to edit command in $EDITOR. doesn't work in VS code terminal
autoload -U edit-command-line
# Emacs style shortcuts
zle -N edit-command-line
bindkey '^xe' edit-command-line
bindkey '^x^e' edit-command-line

export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

export HOMEBREW_NO_ENV_HINTS=1
export EDITOR=hx
export HISTSIZE=10000

bindkey -e # zshell emacs mode, which makes opt+left/right work!

source <(fzf --zsh)

export DENO_INSTALL="/Users/david/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"

test -e "${HOME}/.iterm2_shell_integration.zsh" && source "${HOME}/.iterm2_shell_integration.zsh"

# bun completions
[ -s "/Users/david/.bun/_bun" ] && source "/Users/david/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

eval "$(atuin init zsh --disable-up-arrow)"

autoload -U compinit
compinit
eval "$(zoxide init zsh)"

source <(jj util completion zsh)
