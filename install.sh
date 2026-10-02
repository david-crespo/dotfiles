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

mkdir -p ~/.config/nushell
ln -sf "$PWD/nushell/env.nu" ~/.config/nushell/env.nu
ln -sf "$PWD/nushell/config.nu" ~/.config/nushell/config.nu
ln -sf "$PWD/nushell/zsh-functions.nu" ~/.config/nushell/zsh-functions.nu

mkdir -p ~/.local/bin
# Deno resolves imports from the command symlink, so mirror the config and
# source directories that command entrypoints import from beside those symlinks.
ln -sf "$PWD/deno.jsonc" ~/.local/bin/deno.jsonc
ln -sf "$PWD/deno.lock" ~/.local/bin/deno.lock
ln -sfn "$PWD/bin/lib" ~/.local/bin/lib
ln -sfn "$PWD/bin/web-watch" ~/.local/bin/web-watch
ln -sf "$PWD/bin/codeblocks.ts" ~/.local/bin/cb
ln -sf "$PWD/bin/ghrel.nu" ~/.local/bin/ghrel
ln -sf "$PWD/bin/dq.ts" ~/.local/bin/dq
ln -sf "$PWD/bin/jprc.ts" ~/.local/bin/jprc
ln -sf "$PWD/bin/cpr.ts" ~/.local/bin/cpr
ln -sf "$PWD/bin/aipr.ts" ~/.local/bin/aipr
ln -sf "$PWD/bin/hxai.ts" ~/.local/bin/hxai
ln -sf "$PWD/bin/edit-cmd.sh" ~/.local/bin/ecmd
ln -sf "$PWD/bin/cancel-ci.ts" ~/.local/bin/cancel-ci
ln -sf "$PWD/bin/jjw.ts" ~/.local/bin/jjw-cmd
ln -sf "$PWD/bin/claude-worktree-remove.sh" ~/.local/bin/claude-worktree-remove
ln -sf "$PWD/bin/gh-api-read.ts" ~/.local/bin/gh-api-read
ln -sf "$PWD/bin/gh-unsub.ts" ~/.local/bin/gh-unsub
ln -sf "$PWD/bin/kagi-search.ts" ~/.local/bin/kagi-search
ln -sf "$PWD/bin/obsidian-notes.ts" ~/.local/bin/obsidian-notes
ln -sf "$PWD/bin/jj-jump.ts" ~/.local/bin/jj-jump
ln -sf "$PWD/bin/jpl.ts" ~/.local/bin/jpl
ln -sf "$PWD/bin/jpr.ts" ~/.local/bin/jpr
ln -sf "$PWD/bin/flag-stats.ts" ~/.local/bin/flag-stats
ln -sf "$PWD/bin/clip-bot-note.sh" ~/.local/bin/clip-bot-note
ln -sf "$PWD/bin/ww.ts" ~/.local/bin/ww
ln -sf "$PWD/bin/say-last.ts" ~/.local/bin/say-last
ln -sf "$PWD/bin/x-list.ts" ~/.local/bin/x-list
ln -sf "$PWD/bin/tseval.ts" ~/.local/bin/tseval
ln -sf "$PWD/bin/tsq.ts" ~/.local/bin/tsq
ln -sf "$PWD/bin/gpane.ts" ~/.local/bin/gpane

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

mkdir -p ~/.codex
ln -sf "$PWD/codex/hooks.json" ~/.codex/hooks.json

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

# ah (see below) ships its own skills, so they install the same way
skill_sources=("$PWD/claude/skills")
[ -d "$HOME/repos/ah/skills" ] && skill_sources+=("$HOME/repos/ah/skills")

for source in "${skill_sources[@]}"; do
  for skill in "$source"/*/; do
    name=$(basename "$skill")
    ln -sf "$skill" ~/.claude/skills/
    for dest in "${skill_copy_dests[@]}"; do
      rm -rf "$dest/$name"
      cp -R "${skill%/}" "$dest/"
      touch "$dest/$name/$skill_marker"
    done
  done
done

# Claude Code auto-loads a plugin it finds at ~/.claude/skills/<name>, so mods
# go there too (Claude only; the other agents don't run them).
for mod in "$PWD"/claude/mods/*/; do
  ln -sf "$mod" ~/.claude/skills/
done

# opencode subagent tiers (see claude/skills/shellout)
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

# Alfred workflows (see alfred/README.md). Each repo dir is linked into Alfred's
# workflows folder under the user.workflow.<UUID> name Alfred originally gave it.
# prefs.json records where the preferences folder lives (it moves if sync is on).
alfred_prefs=$(plutil -extract current raw "$HOME/Library/Application Support/Alfred/prefs.json" 2>/dev/null)
if [ -d "$alfred_prefs/workflows" ]; then
  link_alfred_workflow() {
    local dest="$alfred_prefs/workflows/user.workflow.$2"
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then
      echo "alfred: skipping $1, $dest is a real directory (move it aside first)" >&2
      return
    fi
    ln -sfn "$PWD/alfred/workflows/$1" "$dest"
  }
  link_alfred_workflow details-wrap FE496108-4453-4225-87DD-C457FD27420C
  link_alfred_workflow github-link 5A9D3432-44D4-4426-9F07-F1E110B822B8
  link_alfred_workflow google-meet CF67E427-2764-4E80-8A14-50E9E23CAC2A
  link_alfred_workflow say-last-claude-answer FEDCB77F-51D1-4A24-A872-D4F308A615A3
  link_alfred_workflow transform-text A0DC9B64-8694-4A42-B13B-15D6EEDD9691
fi

# ah, the agent host (separate repo, not required)
if [ -d "$HOME/repos/ah" ]; then
  ln -sf "$HOME/repos/ah/ah.ts" ~/.local/bin/ah
fi

# private dotfiles (separate private repo, not required)
if [ -d "$HOME/repos/dotfiles-private" ]; then
  "$HOME/repos/dotfiles-private/install.sh"
fi
