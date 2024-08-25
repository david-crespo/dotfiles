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

mkdir -p ~/.config/atuin
ln -sf $PWD/atuin/config.toml ~/.config/atuin/config.toml

mkdir -p ~/.local/bin
ln -sf $PWD/bin/codeblocks.ts ~/.local/bin/cb
ln -sf $PWD/bin/hxblame.sh ~/.local/bin/hxblame
ln -sf $PWD/bin/hxai.sh ~/.local/bin/hxai
ln -sf $PWD/bin/gh-rel.nu ~/.local/bin/gh-rel
ln -sf $PWD/iterm2/code.py ~/.local/bin/code2

# import iTerm color scheme manually
