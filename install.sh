#! /usr/bin/env bash

# HELIX
mkdir -p ~/.config/helix/themes
ln -sf $PWD/helix/config.toml ~/.config/helix/config.toml
ln -sf $PWD/helix/languages.toml ~/.config/helix/languages.toml
ln -sf $PWD/helix/themes/ayu_evolve2.toml ~/.config/helix/themes/ayu_evolve2.toml

# import iTerm color scheme manually
