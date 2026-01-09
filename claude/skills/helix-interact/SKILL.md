---
name: helix-interact
description: Test Helix editor config changes, debug LSP issues, or observe editor behavior by running Helix in a tmux session. Use when iterating on helix config.toml, languages.toml, Steel scripts, or troubleshooting language server problems.
---

Interact with the Helix editor through tmux, typically to iterate on configuration changes or fix config problems. Also useful for testing LSP functionality or observing editor behavior.

If the user specifies a file path to use for testing, open that file in helix. For a language name (like "rust", "python", "typescript"), create a temporary file with representative code. Some language servers require a full project structure (e.g., `cargo init` for Rust) rather than a standalone file.

Note that this iteration process with tmux is error-prone, so err on the side of pausing to let the user test what you've come up with rather than churning and churning.

## Technique

Helix requires a PTY which isn't available through direct bash commands. Use tmux:

1. Verify tmux and hx are available (`command -v tmux` and `command -v hx`). If missing, inform the user.
2. Create detached session: `tmux new-session -d -s helix-test`
3. Send commands: `tmux send-keys -t helix-test 'hx file.txt' C-m`
4. Capture output: `tmux capture-pane -t helix-test -p`
5. Clean up: `tmux send-keys -t helix-test ':q!' C-m && tmux kill-session -t helix-test`

**Key points:**
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
- Don't over-rely on tmux testing - trust the implementation if it loads without errors and let the user test interactively

## Troubleshooting

**Config locations:**
- Global: `~/.config/helix/` (config.toml, languages.toml, etc.)
- Project-local: `.helix/` directory (if it exists)

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

Now complete the user's request using this technique.
