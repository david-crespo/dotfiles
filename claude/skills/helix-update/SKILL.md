---
name: helix-update
description: "Bring the user's local Helix fork up to date: fetch, rebase merge commit, resolve conflicts, rebuild."
---

The user runs a custom Helix build that merges two upstream forks on top of helix-editor/master:
- `search_position` (useche/helix) — adds match counter limit
- `steel-event-system` (mattwparas/helix) — Steel scripting

Their merge commit (description: "merge in search position PR") sits on top with both as parents. Updating means rebasing it onto the new tips of both branches.

## Steps

1. `cd /Users/david/repos/helix`
2. Fetch: `jj git fetch --all-remotes`
3. Find the merge commit's change ID. It's the descendant of both branches with description "merge in search position PR":
   ```
   jj log -r 'heads(::search_position+ & ::steel-event-system+)' --no-graph -T 'change_id.short() ++ " | " ++ description.first_line() ++ "\n"'
   ```
   (Or just look at recent `jj log` output — it's the merge with two branch parents.)
4. Rebase: `jj rebase -s <change-id> -d search_position -d steel-event-system`
5. If there are conflicts: `jj resolve --tool mergiraf`. Inspect with `jd` (alias for `jj diff`) and confirm before squashing.
6. Squash the resolution into the merge commit: `jj squash` (run from the conflict-resolution rev created by `jj resolve`).
7. Rebuild:
   ```
   killall hx; cargo install --profile opt --config 'build.rustflags=["-C", "target-cpu=native"]' --path helix-term --locked && cargo clean
   ```
8. Regenerate Steel bindings: `cargo xtask steel`

The build takes a while — run it in the background and report when done. If mergiraf can't resolve everything, stop and show the user the conflicted files rather than guessing.
