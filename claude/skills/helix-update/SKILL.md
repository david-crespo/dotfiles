---
name: helix-update
description: "Bring the user's local Helix fork up to date: fetch, rebase their stack onto new upstream tips, rebuild with Steel, push to their fork."
---

The user runs a custom Helix build in `/Users/david/repos/helix` (a jj repo). The stack:

- A merge commit, "merge in search position PR", whose parents are:
  - `search_position` (remote `useche`): adds a match counter limit
  - `steel-event-system` (remote `steel`, mattwparas/helix): Steel scripting, itself based on helix-editor/master
- Their own commits on top of the merge, currently the `auto-reload` bookmark (poll for external file changes and reload buffers).

Remotes: `origin` is helix-editor/helix, `mine` is the user's fork (david-crespo/helix), `steel` is mattwparas, `useche` is useche.

## Steps

1. Fetch: `jj git fetch --remote origin --remote steel --remote useche --remote mine` (needs `github.com` in `allowed_domains`). Report what moved, e.g. `jj log -r '<old steel tip>..steel-event-system'`, and check the old tip is still an ancestor (a force-push changes how to rebase).
2. Push upstream master to the fork: `jj git push --remote mine --bookmark master`. If it errors about a non-tracking `master@mine`, run `jj bookmark track master@mine` first.
3. Find the merge commit (`jj log` shows it under the user's commits) and rebase it with everything on top:
   ```
   jj rebase --ignore-immutable -s <merge-change-id> -d search_position -d steel-event-system
   ```
   `--ignore-immutable` is needed because the user's commits are authored under their work email, which `mine()` doesn't match, so jj treats them as immutable. Rebasing them is what the user asked for.
4. If there are conflicts: `jj resolve --tool mergiraf`, inspect with `jj diff`, and confirm with the user before squashing the resolution into the conflicted commit. If mergiraf can't resolve everything, stop and show the user the conflicted files rather than guessing.
5. Build and install. `steel` is not a default feature of `helix-term`, so pass it explicitly or the build has no Steel:
   ```
   killall hx; cargo install --path helix-term --locked --features steel
   ```
   The plain release profile is enough. The `opt` profile (fat LTO, `target-cpu=native`) builds much slower for no noticeable speedup in an editor.
   Run it in the background with the sandbox disabled (it installs into `~/.cargo/bin`). `killall hx` closes the user's open editors; they expect that.
6. Verify: `hx --version` shows the new commit hash. Start `hx` with no file argument in a hidden Rex session (see the `helix-interact` skill) and check the status line shows no Steel error and the custom statusline from `init.scm` renders. Check `~/.cache/helix/helix.log` for Steel errors.
7. `cargo clean` (the target dir is about 1 GiB).
8. Push the user's bookmark: `jj git push --remote mine --bookmark auto-reload`.

`jj git push` needs the sandbox disabled: the `gh` credential helper reads `~/.config/gh`, which the sandbox denies.

## Steel version

The Steel embedded in `hx` is the `steel-core` git rev pinned in `Cargo.lock` on steel-event-system, and `--locked` keeps it. Getting newer Steel into `hx` means `cargo update -p steel-core`, which moves past the rev mattwparas tested and adds a `Cargo.lock` change to the stack; only do it if asked.

`cargo xtask steel` does not change the embedded Steel. It installs the standalone `steel` CLI, `steel-language-server`, `cargo-steel-lib` and `forge` from Steel's git HEAD, runs `forge pkg refresh`, writes `helix/*.scm` API stubs into `$STEEL_HOME/cogs/helix` for the language server, and reinstalls `hx`. Skip it unless the user asks; it only matters for the steel LSP and CLI.
