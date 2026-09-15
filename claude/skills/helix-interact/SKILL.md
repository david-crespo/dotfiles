---
name: helix-interact
description: Test Helix editor config changes, debug LSP issues, or observe editor behavior by running Helix in a tmux session. Use when iterating on helix config.toml, languages.toml, Steel scripts, or troubleshooting language server problems.
---

Interact with the Helix editor through tmux, typically to iterate on configuration changes or fix config problems. Also useful for testing LSP functionality or observing editor behavior.

If the user specifies a file path to use for testing, open that file in helix. For a language name (like "rust", "python", "typescript"), create a temporary file with representative code. Some language servers require a full project structure (e.g., `cargo init` for Rust) rather than a standalone file.

Driving Helix through tmux is timing-sensitive: captures race LSP startup and popups, so a failed check is often the harness rather than the config. Verify that the config loads without errors and that the feature works once. If a check keeps failing in ways that look like capture timing rather than a config problem, hand it to the user to try interactively instead of retrying.

## Technique

Helix requires a PTY which isn't available through direct bash commands. Use tmux:

1. Verify tmux and hx are available (`command -v tmux` and `command -v hx`). If missing, inform the user.
2. Create detached session: `tmux new-session -d -s helix-test`
3. Send commands: `tmux send-keys -t helix-test 'hx file.txt' C-m`
4. Capture output: `tmux capture-pane -t helix-test -p`
5. Clean up: `tmux send-keys -t helix-test ':q!' C-m && tmux kill-session -t helix-test`

**Key points:**
- tmux cannot create its socket directory inside the Bash sandbox; run the tmux commands with the sandbox disabled.
- To restart Helix after a config or Steel change, `tmux kill-session` and create a new session. Do not rely on `:q!` then `hx`: with two views open the first `:q!` only closes one, and the `hx` keystrokes land in the still-running editor, so the "retest" runs the old code.
- Give the session a real size (`-x 160 -y 45`) and start it in the repo you want as Helix's cwd (`-c <dir>`).
- Use `C-m` for Enter, `Escape` for Escape
- Add `sleep 0.2-0.5` before capturing to allow LSP analysis (slower LSPs may need 1-2 seconds)
- Use `:config-reload` and `:lsp-restart` when testing config changes
- Check config statically first: `hx --health` or `hx --health rust`

## Docs

- The Helix docs are https://docs.helix-editor.com
- For Steel docs, look at https://raw.githubusercontent.com/mattwparas/helix/refs/heads/steel-event-system/steel-docs.md (it's a big file, so download the text and grep it) and https://raw.githubusercontent.com/mattwparas/helix/refs/heads/steel-event-system/STEEL.md

## Steel Command Development

When converting keybinding commands to Steel functions:

**Command expansions** like `%{buffer_name}` work in command strings but must be replaced with Steel API calls in functions:
- Current file: `(helix.static.cx->current-file)`
- Current selection: `(helix.static.current-highlighted-text!)`
- Look for `cx->` functions in steel-docs.md for other context access

**Shell commands:**
- Call with variadic args: `(helix.run-shell-command "cmd" "arg1" "arg2")`
- Output goes to popup, not statusline (unlike `:echo %sh{...}`)
- For multiple args from a list: `(apply helix.run-shell-command args-list)`

**Testing:**
- Shell command output appears in popups (captured by `tmux capture-pane`), unlike `:echo %sh{...}` which outputs to the status line
- The statusline in a capture (`NOR  name [+]  12:1  440`) gives the cursor line and buffer length; that is the cheapest way to assert where a command left the cursor. `tmux capture-pane -p | grep -vE '^\s*$' | tail -2` shows the statusline plus any error message under it.
- `tmux capture-pane -e` keeps color codes, but checking them is fiddly; for coloring questions, ask the user for a screenshot.

**Steel plugins (cogs in `~/.config/helix/cogs`, from `helix/cogs/` in dotfiles):**
- Cogs and `init.scm` are read at startup only; restart Helix after each edit.
- Pure functions (parsing, string handling, running a subprocess) can be checked without Helix: `steel file.scm` with `(require-builtin steel/process)`. `wait->stdout` returns an `Ok` wrapper; unwrap with `Ok->value`. `steel/process` is undocumented in `steel-docs.md`; oil.hx (github.com/Ra77a3l3-jar/oil.hx) is the reference for the idiom.
- Per-buffer keymaps built with `deep-copy-global-keybindings` must come after every global keymap edit in `init.scm`, or later global definitions win.
- Steel load errors show on the scratch buffer's status line at startup and in `~/.cache/helix/helix.log`. Filter the log with `grep -iE 'error|steel' | grep -v steel-language-server`; the language server's stderr is logged at ERROR level and is noise.
- Worked example: to test a cog that opens a scratch buffer, start Helix in a repo with a diff, run the command, then drive its keys and read cursor positions off the statusline after each one, e.g. `s ':multidiff' C-m; sleep 2; s ']f'; sleep 0.5; cap` with `s`/`cap` as small `tmux send-keys` / `capture-pane` wrappers.
## Troubleshooting

**Config locations:**
- Global: `~/.config/helix/` (config.toml, languages.toml, etc.)
- Project-local: `.helix/` directory (if it exists)

**Startup errors:** Some errors (e.g., Steel init failures) only show on the scratch buffer. Always test with `hx` (no file argument) first — opening a file prints "Loaded N file(s)." which overwrites the error in the status line.

**Logs:** Usually at `~/.cache/helix/helix.log` (use `tail -n 100`). If stale, open in Helix with `:log-open` and jump to bottom (`G`).

## Example

```bash
tmux new-session -d -s helix-test
tmux send-keys -t helix-test 'hx test.rs' C-m
sleep 0.3
tmux send-keys -t helix-test 'i' 'fn main() { invalid }' Escape
sleep 0.5
tmux capture-pane -t helix-test -p  # See LSP errors
tmux send-keys -t helix-test ':q!' C-m
tmux kill-session -t helix-test
```
