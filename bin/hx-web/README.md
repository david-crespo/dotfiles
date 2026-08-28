# hx-web

Prototype: real Helix editing a markdown file with a live rendered preview,
exploring editor-in-browser designs for the prose review tool. Two modes:

1. **Browser**: helix embedded in a web page (pty → websocket → xterm.js),
   preview beside it.
2. **All-terminal**: helix in a regular terminal pane, preview rendered as
   actual pixels in a sibling pane via
   [terminal-browser](https://github.com/zenbu-labs/terminal-browser)
   (Chromium offscreen rendering displayed through the kitty graphics
   protocol — the maintained successor to
   [awrit](https://github.com/chase/awrit)).

## Setup

```sh
npm install
```

If node-pty later fails with an opaque `posix_spawnp failed`, npm's
allowScripts policy blocked its postinstall; fix with
`chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`.

## Mode 1: browser

```sh
node server.mjs [file.md] [port]   # defaults: ./draft.md, 4923
```

Open http://localhost:4923 — helix left, preview right. Edits hit the file
~650ms after you stop typing via helix's built-in
`[editor.auto-save] after-delay` (see `hx-config.toml`, passed to the spawned
hx with `--config`, which *replaces* the user's config.toml); a file watcher
pushes the file to the preview pane over a second websocket. Markdown is
rendered client-side with marked + github-markdown-css (not GitHub-exact).

## Mode 2: all-terminal

Install terminal-browser (~130MB prebuilt bundle to
`~/.local/share/terminal-browser`, launcher in `~/.local/bin`; it also
symlinks agent skills into claude/codex/gemini skill dirs):

```sh
curl -fsSL https://terminal-browser.sh/install | bash
```

Then, with the server running:

```sh
terminal-browser open 'http://localhost:4923/?preview' --split right --size 0.5
```

`?preview` serves only the rendered-markdown pane (no embedded terminal).
terminal-browser splits the current terminal tab itself — no
tmux/zellij/ghostty-split scripting needed. In another pane, run real helix
with the auto-save config:

```sh
hx --config hx-config.toml draft.md
```

Close the browser pane with ctrl+q; `terminal-browser shutdown` kills all of
its panes. `terminal-browser action -- eval/click/snapshot ...` drives the
open tab from a shell, which is handy for agents verifying the render.

## Known limitations (by design — it's a prototype)

- Helix does not reload the buffer when the file changes externally, and
  after an external change auto-save is blocked ("file modified by an
  external process, use :w! to overwrite"). A real integration would close
  this with a Steel plugin: poll mtime with
  `enqueue-thread-local-callback-with-delay` and call `reload` when the
  buffer is unmodified (all typed commands are exposed to Steel).
- One hx process per websocket connection; concurrent page loads on the same
  file will fight.
- No comment/selection gestures — this only demonstrates the editor+preview
  layout and the sync loop.
