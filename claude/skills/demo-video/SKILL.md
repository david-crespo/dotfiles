---
name: demo-video
description: Record a narrated screen-capture video demo of a web UI change (a PR, a feature, a redesign) by scripting the flow with Playwright and assembling an mp4 with ffmpeg. Use when the user asks for a video demo, a screen recording, or a walkthrough of a change in the browser.
---

Produce a short, sharp, self-narrating mp4 of a UI change by scripting the
walkthrough in Playwright. One script, one run, one video; iterate on the
script when frames look wrong. Builds on the `browser-interact` skill for
selectors, waiting, and mock-API behavior.

## Process

1. **Understand the change.** Read the diff or PR description and list every
   user-visible behavior it adds or alters. Read the repo's e2e tests for the
   affected pages to borrow selectors.
2. **Plan the beats.** Aim for 30–60 seconds and 5–8 beats. Comprehensive
   means every notable behavior gets a beat; watchable means one beat per
   behavior, no repeats, no dead time. Order it as one connected walk through
   the UI (see below). Show the plan to the user briefly if the change is
   large or the priorities are unclear; otherwise just go.
3. **Probe uncertain steps standalone first.** Any "actually do it" step (create
   a resource, submit a form) can fail on a required field with no default.
   Run that flow in a throwaway script and print `ariaSnapshot()` after submit
   to catch validation errors before wiring it into the long recording.
4. **Copy the template** (`record-demo.mjs` next to this file) into the repo,
   e.g. `.claude/notes/record-demo.mjs`, set the CONFIG block, and write the
   WALK section. Run it from the repo root so `@playwright/test` resolves.
5. **Verify by extracting frames**, never by trusting a clean run:
   ```sh
   ffmpeg -v error -ss 3 -i demo.mp4 -frames:v 1 f3.png
   ```
   at a handful of timestamps (intro, each modal, the toast, the ending) and
   Read the PNGs. Check: no stray hover tooltip, captions not covering toasts
   or footers, captions truthful about what is on screen, output resolution is
   2x the viewport.
6. **Fix and re-record.** Runs are cheap (roughly the video length plus a few
   seconds). Deliver the mp4 path, dimensions, duration, and size, plus a
   numbered list of the beats so the user can review against the change.

## Structuring the walk

- **Open where the change is visible.** If the change shows on the homepage,
  start there. If it only appears three clicks deep, start on that deep route
  rather than making the viewer watch the clicks to get there.
- **Passive before interactive**: layout and appearance beats first, then
  chrome (menus, drawers), then modals and toasts.
- **End on a payoff**: a real end-to-end action that lands somewhere new
  (create a resource and arrive on its page) with a closing caption.
- **One full page load only.** In-memory mock APIs reset on `goto`, so after
  the initial load navigate by clicking. This is also why the order must be a
  single connected path.
- **Caption every beat** in a short imperative or declarative sentence, and
  always caption before acting. The `caption` helper holds ~1s after showing
  text so the viewer reads it before the click; a caption that changes in the
  same instant as the action is hard to follow. Clear the caption
  (`caption('')`, no hold) right before an action that spawns a toast or
  anything else that lands in the same spot.
- **Pacing**: caption hold ~1s, then the action, then ~1.4s to let the
  result settle (~2s if there is something to read, ~2.5s on the final
  frame). Use `moveClick` for every click so the cursor visibly travels, and
  `pressSequentially` for text the viewer should see typed.

## Why the template works the way it does

- **Frames + ffmpeg, not `recordVideo`.** Playwright's recorder uses the CDP
  screencast, which is capped at CSS-pixel resolution. `deviceScaleFactor: 2`
  with a doubled `recordVideo.size` yields a 1x image padded into a 2x canvas;
  CDP `Emulation.setDeviceMetricsOverride` with `scale: 2` renders sharp but
  crops to one quadrant and breaks click coordinates. `page.screenshot()` does
  honor `deviceScaleFactor`, so a capture loop gives true 2x frames. Expect
  ~12fps at 800×1600, fine for UI, slightly steppy for fast animations.
- **Busy flag and try/catch in the loop**: a capture can outlast the interval,
  and captures throw mid-navigation. Drop the frame rather than crash.
- **Measured fps**: the loop rate drifts, so compute frames/elapsed and pass
  that to `-framerate` or the video plays at the wrong speed.
- **`addInitScript` for cursor and caption**: survives full page loads, so it
  keeps working even if the walk needs a second `goto`.
- **`reducedMotion: 'no-preference'`**: macOS Reduce Motion propagates into
  headless chromium and suppresses the transitions being demoed.
- **`libx264` + `yuv420p` + `+faststart`**: the combination that GitHub PR
  comments, Slack, and QuickTime all play inline. Drag the mp4 into the PR
  description or a comment; GitHub hosts it.

## Gotchas

- **Strict mode differs from e2e**: `getByText('X deleted')` matched both the
  toast and an aria-live region. Scope through the toast container or a role.
- **Dev server port**: read the actual port from the server's startup output;
  vite bumps to the next port if the default is held by a stale process.
- **Sandbox** (this machine): the dev server can't listen and localhost can't
  be curled from sandboxed bash, so start the server and run the recorder with
  the sandbox disabled. Frame extraction for review should run sandboxed or
  write into the repo, since `$TMPDIR` differs between the two.
- **Tooltips in the intro**: the mouse starts at 0,0 or wherever the last
  action left it. Park it in dead space before the first caption.
- **Overpromising captions**: say what the frame shows ("buttons stack"), not
  what the code intends ("buttons go full width") unless the frame confirms it.
- **Output location**: `.claude/notes/` is gitignored, so the video and script
  live there by default. Don't commit either unless asked.
