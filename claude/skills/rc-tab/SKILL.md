---
name: rc-tab
description: Open a Rex tab in a repo running a new Claude Code session with Remote Control on, and give the user its claude.ai link. Use when the user, usually on their phone, asks to start or open Claude in some repo, or for a session in a repo they can drive remotely.
---

# Claude in a new Rex tab, with Remote Control

The user drives the new session from the Claude app, so the result to hand
back is its `https://claude.ai/code/session_…` link. Run every `rex` command
outside the sandbox: it talks to the Rex server over a socket.

1. **Find the repo.** Personal repos are under `~/repos`, work ones under
   `~/oxide`. If more than one directory matches the name, `jj git remote list`
   usually settles it (one is a clone with the expected `origin`, the other a
   leftover). Ask if it doesn't.

2. **Open a shell tab there**, in the user's session, without taking focus:

   ```sh
   rex window new -s "$REX_SESSION" <repo> -c <dir> --focus=false --json
   ```

   Save `.block_ids[0]`.

3. **Start Claude in it.** `clod` (personal account) and `clox` (work) are
   shell functions in `.zprofile`, so type the command into the shell rather
   than passing it to `rex window new`. Use `clod` unless the user asks for the
   work account. `--remote-control <name>` turns Remote Control on at startup
   and names the session; use the repo name.

   ```sh
   rex send -s "$REX_SESSION" -b <block> 'clod --remote-control <repo>'
   rex send-key -s "$REX_SESSION" -b <block> enter
   ```

4. **Answer the trust prompt.** The first time an account opens a folder,
   Claude asks whether to trust it, with "No, exit" selected, and there's no
   flag to skip it in an interactive session. Capture the pane a few seconds
   after starting (`rex capture -s "$REX_SESSION" -b <block> --trim | tail -25`).
   If it shows `Yes, I trust this folder`, send `down`, then `enter`. Don't
   wait on the screen with Monitor: it always runs sandboxed, where `rex` can't
   reach its socket, so the watch never matches. Capture again in a separate
   call instead.

5. **Hand back the link.** Capture until the screen shows a
   `https://claude.ai/code/session_…` URL and give it to the user, with the tab
   name and account.
