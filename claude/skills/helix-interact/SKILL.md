---
name: helix-interact
description: Test Helix editor config changes, debug LSP issues, or observe editor behavior by running Helix in a Rex session and driving it with rex send/capture. Use when iterating on helix config.toml, languages.toml, Steel scripts, or troubleshooting language server problems.
---

Interact with the Helix editor through Rex, typically to iterate on configuration changes or fix config problems. Also useful for testing LSP functionality or observing editor behavior.

If the user specifies a file path to use for testing, open that file in helix. For a language name (like "rust", "python", "typescript"), create a temporary file with representative code. Some language servers require a full project structure (e.g., `cargo init` for Rust) rather than a standalone file.

Driving Helix this way is timing-sensitive: captures race LSP startup and popups, so a failed check is often the harness rather than the config. Verify that the config loads without errors and that the feature works once. If a check keeps failing in ways that look like capture timing rather than a config problem, hand it to the user to try interactively instead of retrying.

## Technique

Helix needs a PTY, which the Bash tool doesn't have. Run it in its own Rex session, which no client displays, so it doesn't touch the user's layout:

```sh
rex new hx-test -c "$PWD" -- hx helix/init.scm   # session label hx-test
rex send -s hx-test ':ah-comment'                # literal text
rex send-key -s hx-test enter                    # keys: escape, alt+enter, ctrl+w, up, ...
rex capture -s hx-test --trim                    # the screen as text
rex kill hx-test
```

**Key points:**
- `rex` talks to the server over a Unix socket the sandbox blocks: run these with the sandbox disabled.
- Always pass `-s hx-test`. Without it, `rex` scopes to `$REX_SESSION`, so `-b <block>` alone fails with `block target ... not found` even though `rex block ls -s hx-test` lists the block, and `send` without a target types into your own pane.
- A session with no client is 80×24 and there's no way to resize it. Layout bugs that only show at other sizes need a visible pane (below) or the user.
- Use `rex send` for text and `rex send-key` for keys, in Rex's key syntax (`ctrl+c`, `alt+enter`, `shift+left`).
- To restart Helix after a config or Steel change, `rex kill hx-test` and create a new session. Do not rely on `:q!` then `hx`: with two views open the first `:q!` only closes one, and the `hx` keystrokes land in the still-running editor, so the "retest" runs the old code.
- `rex new` without `--keep-open` closes the session's pane when `hx` exits, so a crash or startup failure shows up as the session being empty. Add `--keep-open` to read what `hx` printed on the way out.
- Add `sleep 0.2-0.5` before capturing to allow LSP analysis (slower LSPs may need 1-2 seconds)
- Use `:config-reload` and `:lsp-restart` when testing config changes
- Check config statically first: `hx --health` or `hx --health rust`

**Letting the user watch:** when the user wants to see the editor, split your own pane instead of using a hidden session (see the `panes` skill): `rex split --block "$REX_BLOCK" --split above --ratio 50 --focus=false --cwd "$PWD" --label hx -- hx file`. It prints the block id; then drive it with `-b <id>` (your own session, so no `-s`) and close it with `rex block close <id>`.

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
- Shell command output appears in popups (captured by `rex capture`), unlike `:echo %sh{...}` which outputs to the status line
- The statusline in a capture (`NOR  name [+]  12:1  440`) gives the cursor line and buffer length; that is the cheapest way to assert where a command left the cursor. `rex capture -s hx-test --trim | tail -2` shows the statusline plus any message under it.
- `rex capture --format=html` keeps styling, but checking it is fiddly; for coloring questions, ask the user for a screenshot.

**Steel plugins (cogs in `~/.config/helix/cogs`, from `helix/cogs/` in dotfiles):**
- Cogs and `init.scm` are read at startup only; restart Helix after each edit.
- Pure functions (parsing, string handling, running a subprocess) can be checked without Helix: `steel file.scm` with `(require-builtin steel/process)`. `wait->stdout` returns an `Ok` wrapper; unwrap with `Ok->value`. `steel/process` is undocumented in `steel-docs.md`; oil.hx (github.com/Ra77a3l3-jar/oil.hx) is the reference for the idiom.
- Per-buffer keymaps built with `deep-copy-global-keybindings` must come after every global keymap edit in `init.scm`, or later global definitions win.
- Steel load errors show on the scratch buffer's status line at startup and in `~/.cache/helix/helix.log`. Filter the log with `grep -iE 'error|steel' | grep -v steel-language-server`; the language server's stderr is logged at ERROR level and is noise.
- Worked example: to test a cog that opens a scratch buffer, start Helix in a repo with a diff, run the command, then drive its keys and read cursor positions off the statusline after each one, e.g. `s ':multidiff'; k enter; sleep 2; s ']f'; sleep 0.5; cap` with `s`/`k`/`cap` as small wrappers around `rex send -s hx-test`, `rex send-key -s hx-test` and `rex capture -s hx-test --trim`.
- Components (`new-component!`): test rendering and keys by driving them as above. Keep the component's pure logic (text editing, wrapping, layout math) in functions that don't touch Helix, so `steel` can check them without the editor.

## Troubleshooting

**Config locations:**
- Global: `~/.config/helix/` (config.toml, languages.toml, etc.)
- Project-local: `.helix/` directory (if it exists)

**Startup errors:** Some errors (e.g., Steel init failures) only show on the scratch buffer. Always test with `hx` (no file argument) first — opening a file prints "Loaded N file(s)." which overwrites the error in the status line.

**Logs:** Usually at `~/.cache/helix/helix.log` (use `tail -n 100`). If stale, open in Helix with `:log-open` and jump to bottom (`G`).

## Example

```bash
rex new hx-test -c "$PWD" -- hx test.rs
sleep 0.5
rex send-key -s hx-test i
rex send -s hx-test 'fn main() { invalid }'
rex send-key -s hx-test escape
sleep 0.5
rex capture -s hx-test --trim  # See LSP errors
rex kill hx-test
```
