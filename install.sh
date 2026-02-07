#! /usr/bin/env bash

for f in .gitconfig .gitconfig-oxide .githelpers .gitignore .lesskey .tmux.conf .vimrc .zprofile .zshrc .zshenv; do
  ln -sf "$PWD/$f" ~/$f
done

mkdir -p ~/.config/nvim
ln -sf "$PWD/init.vim" ~/.config/nvim/init.vim

# vim +PlugInstall +PlugUpdate +qall
# nvim +PlugInstall +PlugUpdate +qall

mkdir -p ~/.config/wezterm
ln -sf "$PWD/wezterm.lua" ~/.config/wezterm/wezterm.lua

mkdir -p ~/.config/helix/themes
ln -sf "$HOME/repos/helix/runtime" ~/.config/helix/runtime
ln -sf "$PWD/helix/config.toml" ~/.config/helix/config.toml
ln -sf "$PWD/helix/languages.toml" ~/.config/helix/languages.toml
ln -sf "$PWD/helix/themes/ayu_evolve2.toml" ~/.config/helix/themes/ayu_evolve2.toml
ln -sf "$PWD/helix/helix.scm" ~/.config/helix/helix.scm
ln -sf "$PWD/helix/init.scm" ~/.config/helix/init.scm

ln -sf "$PWD/zed/keymap.json" ~/.config/zed/keymap.json
ln -sf "$PWD/zed/settings.json" ~/.config/zed/settings.json

mkdir -p ~/.config/jj
ln -sf "$PWD/jj/config.toml" ~/.config/jj/config.toml

mkdir -p ~/.config/jjui
ln -sf "$PWD/jjui/config.toml" ~/.config/jjui/config.toml

mkdir -p ~/.config/atuin
ln -sf "$PWD/atuin/config.toml" ~/.config/atuin/config.toml

mkdir -p ~/.config/ghostty
ln -sf "$PWD/ghostty/config" ~/.config/ghostty/config

mkdir -p ~/.config/nushell
ln -sf "$PWD/nushell/env.nu" ~/.config/nushell/env.nu
ln -sf "$PWD/nushell/config.nu" ~/.config/nushell/config.nu
ln -sf "$PWD/nushell/zsh-functions.nu" ~/.config/nushell/zsh-functions.nu

mkdir -p ~/.local/bin
# Deno searches for config from symlink location, not target, so we need this here
ln -sf "$PWD/deno.jsonc" ~/.local/bin/deno.jsonc
ln -sf "$PWD/bin/codeblocks.ts" ~/.local/bin/cb
ln -sf "$PWD/bin/ghrel.nu" ~/.local/bin/ghrel
ln -sf "$PWD/bin/dq.ts" ~/.local/bin/dq
ln -sf "$PWD/bin/jprc.ts" ~/.local/bin/jprc
ln -sf "$PWD/bin/aipr.ts" ~/.local/bin/aipr
ln -sf "$PWD/bin/hxai.ts" ~/.local/bin/hxai
ln -sf "$PWD/bin/edit-cmd.sh" ~/.local/bin/ecmd
ln -sf "$PWD/bin/cancel-ci.ts" ~/.local/bin/cancel-ci
ln -sf "$PWD/bin/jjw.ts" ~/.local/bin/jjw-cmd
ln -sf "$PWD/bin/gh-api-read.ts" ~/.local/bin/gh-api-read

ln -sf "$PWD/brew/outdated-exclude.txt" ~/.local/share/brew-outdated-exclude.txt

mkdir -p ~/.claude/skills ~/.config/opencode/skills ~/.codex/skills
ln -sf "$PWD/claude/CLAUDE.md" ~/.claude/CLAUDE.md
ln -sf "$PWD/claude/CLAUDE.md" ~/.config/opencode/AGENTS.md
ln -sf "$PWD/claude/CLAUDE.md" ~/.codex/AGENTS.md

ln -sf "$PWD/claude/settings.json" ~/.claude/settings.json
ln -sf "$PWD/claude/statusline.ts" ~/.claude/statusline.ts
ln -sf "$PWD/claude/commands" ~/.claude

# symlink public skills individually so private skills can live alongside them
for skill in "$PWD/claude/skills"/*/; do
  ln -sf "$skill" ~/.claude/skills/
  ln -sf "$skill" ~/.config/opencode/skills/
  ln -sf "$skill" ~/.codex/skills/
done
