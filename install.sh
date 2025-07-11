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

ln -sf "$PWD/zed/keymap.json" ~/.config/zed/keymap.json
ln -sf "$PWD/zed/settings.json" ~/.config/zed/settings.json

mkdir -p ~/.config/jj
ln -sf "$PWD/jj/config.toml" ~/.config/jj/config.toml

mkdir -p ~/.config/atuin
ln -sf "$PWD/atuin/config.toml" ~/.config/atuin/config.toml

mkdir -p ~/.config/ghostty
ln -sf "$PWD/ghostty/config" ~/.config/ghostty/config

mkdir -p ~/.local/bin
ln -sf "$PWD/bin/codeblocks.ts" ~/.local/bin/cb
ln -sf "$PWD/bin/gh-rel.nu" ~/.local/bin/gh-rel
ln -sf "$PWD/bin/dq.ts" ~/.local/bin/dq
ln -sf "$PWD/bin/jprc.ts" ~/.local/bin/jprc
ln -sf "$PWD/bin/aipr.ts" ~/.local/bin/aipr
ln -sf "$PWD/bin/edit-cmd.sh" ~/.local/bin/ecmd

ln -sf "$PWD/brew/outdated-exclude.txt" ~/.local/share/brew-outdated-exclude.txt
