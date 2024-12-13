#! /usr/bin/env bash

for f in gitconfig githelpers jjconfig.toml tmux.conf vimrc zprofile zshrc zshenv; do
  ln -sf $PWD/$f ~/.$f
done

mkdir -p ~/.config/nvim
ln -sf $PWD/init.vim ~/.config/nvim/init.vim

vim +PlugInstall +PlugUpdate +qall
nvim +PlugInstall +PlugUpdate +qall

mkdir -p ~/.config/wezterm
ln -sf $PWD/wezterm.lua ~/.config/wezterm/wezterm.lua

# HELIX
mkdir -p ~/.config/helix/themes
ln -sf $PWD/helix/config.toml ~/.config/helix/config.toml
ln -sf $PWD/helix/languages.toml ~/.config/helix/languages.toml
ln -sf $PWD/helix/themes/ayu_evolve2.toml ~/.config/helix/themes/ayu_evolve2.toml

# ZED
ln -sf $PWD/zed/keymap.json ~/.config/zed/keymap.json
ln -sf $PWD/zed/settings.json ~/.config/zed/settings.json

mkdir -p ~/.config/atuin
ln -sf $PWD/atuin/config.toml ~/.config/atuin/config.toml

mkdir -p ~/.config/ghostty
ln -sf $PWD/ghostty/config ~/.config/ghostty/config

mkdir -p ~/.local/bin
ln -sf $PWD/bin/codeblocks.ts ~/.local/bin/cb
ln -sf $PWD/bin/gh-rel.nu ~/.local/bin/gh-rel
ln -sf $PWD/iterm2/code.py ~/.local/bin/code2
ln -sf $PWD/bin/dq.ts ~/.local/bin/dq

ln -sf $PWD/brew/outdated-exclude.txt ~/.local/share/brew-outdated-exclude.txt

# import iTerm color scheme manually
