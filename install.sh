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

mkdir -p ~/.config/zed/themes
ln -sf "$PWD/zed/keymap.json" ~/.config/zed/keymap.json
ln -sf "$PWD/zed/settings.json" ~/.config/zed/settings.json
ln -sf "$PWD/zed/themes/ayu-evolve.json" ~/.config/zed/themes/ayu-evolve.json

mkdir -p ~/.config/jj
ln -sf "$PWD/jj/config.toml" ~/.config/jj/config.toml

mkdir -p ~/.config/jjui
ln -sf "$PWD/jjui/config.toml" ~/.config/jjui/config.toml

mkdir -p ~/.config/atuin
ln -sf "$PWD/atuin/config.toml" ~/.config/atuin/config.toml

mkdir -p ~/.config/ghostty
ln -sf "$PWD/ghostty/config" ~/.config/ghostty/config

mkdir -p ~/.config/zellij
ln -sf "$PWD/zellij/config.kdl" ~/.config/zellij/config.kdl

mkdir -p ~/.config/cmux
ln -sf "$PWD/cmux/settings.json" ~/.config/cmux/settings.json
# cmux 0.63.2's readConfigFile rejects symbolic links, so ~/.config/ghostty/config
# (symlinked) never loads. Copy the ghostty config into cmux's bundle Application
# Support dir as a regular file. Rerun install.sh after editing ghostty/config
# to keep it in sync.
#
# Fixed on cmux main in 8eb74560. Once that lands in a release, cmux will read
# the symlinked ~/.config/ghostty/config directly — then delete this block AND
# the copy at ~/Library/Application Support/com.cmuxterm.app/config, otherwise
# the stale copy will keep overriding the real config.
mkdir -p ~/Library/Application\ Support/com.cmuxterm.app
rm -f ~/Library/Application\ Support/com.cmuxterm.app/config
cp "$PWD/ghostty/config" ~/Library/Application\ Support/com.cmuxterm.app/config

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
ln -sf "$PWD/bin/claude-worktree-remove.sh" ~/.local/bin/claude-worktree-remove
ln -sf "$PWD/bin/gh-api-read.ts" ~/.local/bin/gh-api-read
ln -sf "$PWD/bin/kagi-search.ts" ~/.local/bin/kagi-search
ln -sf "$PWD/bin/ghostty-tab-title.ts" ~/.local/bin/ghostty-tab-title
ln -sf "$PWD/bin/obsidian-notes.ts" ~/.local/bin/obsidian-notes
ln -sf "$PWD/bin/jj-jump.ts" ~/.local/bin/jj-jump
ln -sf "$PWD/bin/jpl.ts" ~/.local/bin/jpl
ln -sf "$PWD/bin/jpr.ts" ~/.local/bin/jpr
ln -sf "$PWD/bin/flag-stats.ts" ~/.local/bin/flag-stats

ln -sf "$PWD/brew/outdated-exclude.txt" ~/.local/share/brew-outdated-exclude.txt

mkdir -p ~/.claude/skills ~/.config/opencode/skills ~/.codex/skills ~/.pi/agent/skills ~/.config/opencode/agent
ln -sf "$PWD/claude/CLAUDE.md" ~/.claude/CLAUDE.md
ln -sf "$PWD/opencode/opencode.json" ~/.config/opencode/opencode.json
ln -sf "$PWD/claude/CLAUDE.md" ~/.config/opencode/AGENTS.md
ln -sf "$PWD/claude/CLAUDE.md" ~/.codex/AGENTS.md
ln -sf "$PWD/claude/CLAUDE.md" ~/.pi/agent/AGENTS.md
ln -sf "$PWD/pi/APPEND_SYSTEM.md" ~/.pi/agent/APPEND_SYSTEM.md

ln -sf "$PWD/claude/settings.json" ~/.claude/settings.json
ln -sf "$PWD/claude/statusline.ts" ~/.claude/statusline.ts
ln -sf "$PWD/claude/commands" ~/.claude

# Skills. Claude Code follows symlinks, so symlink skills there for live editing
# (edit in repo, no reinstall needed). opencode/codex/pi do NOT follow symlinks
# when scanning for skills (opencode's Bun glob and codex's scanner skip
# symlinked entries), so copy into those instead. Each copy gets a marker file
# so the next install can delete stale copies (renamed/removed skills) without
# touching private skills that live alongside or tool-internal dirs like
# codex's .system.
skill_marker=.dotfiles-managed
skill_copy_dests=(~/.config/opencode/skills ~/.codex/skills ~/.pi/agent/skills)

# Claude: drop broken symlinks from renamed/deleted skills before relinking.
find ~/.claude/skills -maxdepth 1 -type l ! -exec test -e {} \; -delete

# Copy targets: remove what a previous install put there — marked copies plus
# any leftover symlinks from the old symlink-based setup — so deletions and
# renames propagate. (BSD find lacks -printf, so resolve dirs via dirname.)
find "${skill_copy_dests[@]}" -maxdepth 2 -name "$skill_marker" |
  while read -r marker; do rm -rf "$(dirname "$marker")"; done
find "${skill_copy_dests[@]}" -maxdepth 1 -type l -delete

for skill in "$PWD/claude/skills"/*/; do
  name=$(basename "$skill")
  ln -sf "$skill" ~/.claude/skills/
  for dest in "${skill_copy_dests[@]}"; do
    rm -rf "$dest/$name"
    cp -R "${skill%/}" "$dest/"
    touch "$dest/$name/$skill_marker"
  done
done

# opencode subagent tiers (see claude/skills/opencode)
find ~/.config/opencode/agent -maxdepth 1 -type l ! -exec test -e {} \; -delete
for agent in "$PWD/opencode/agent"/*.md; do
  ln -sf "$agent" ~/.config/opencode/agent/
done

# pi extensions (single-file, dependency-free)
mkdir -p ~/.pi/agent/extensions
find ~/.pi/agent/extensions -maxdepth 1 -type l ! -exec test -e {} \; -delete
for ext in "$PWD/pi/extensions"/*.ts; do
  ln -sf "$ext" ~/.pi/agent/extensions/
done
