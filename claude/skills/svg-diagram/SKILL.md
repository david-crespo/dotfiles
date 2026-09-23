---
name: svg-diagram
description: Make a bespoke, hand-laid-out SVG figure for a slide (1920×1080, Oxide fonts and dark palette) from a small bun/TypeScript generator, with a render-and-look loop. Use when a diagram needs precise composition that D2's auto-layout can't give — typographic diagrams, piles of terms, membranes and regions, mirrored halves, anything where placement is the point. For box-and-arrow graphs use the d2 skill instead.
---

# Hand-laid SVG figures for slides

A generator script emits the SVG, headless Chromium renders it to PNG, you
look at the PNG and change the script. Layout is code, so every tweak is a
constant or a list edit, and the result is deterministic.

Worked example: `examples/product-surface.ts`, a three-column figure (a pile
of mono terms | a textured band | loose sans phrases) with a few connections
across the band. The design lessons below were learned building it.

## Setup (once per figure, in the scratchpad)

```sh
mkdir -p fig/fonts && cd fig
cp ~/repos/dotfiles/claude/skills/svg-diagram/template/{gen.ts,render.mjs} .
for f in GT-America-Mono-Regular-OCC SuisseIntl-Regular-WebS SuisseIntl-Medium-WebS SuisseIntl-Light-WebS; do
  curl -sSf -o fonts/$f.woff2 https://oxide.computer/fonts/$f.woff2
done
ln -s ~/oxide/console/node_modules node_modules   # for playwright
```

Fonts are the brand webfonts from oxide.computer; don't commit them anywhere.

## Loop

```sh
bun gen.ts > fig.svg && node render.mjs $PWD/fig.svg $PWD/fig.png
```

Then Read the PNG. `render.mjs` also writes `widths.json` with the measured
width of every `text[data-key]` element, and `gen.ts` reads it on the next
run, so after changing any sans text run the pair twice. The generator
prints overflow warnings to stderr; treat them as errors.

**Sandbox:** Chromium cannot start inside the Claude sandbox (mach port
bootstrap denied, or a `ProcessSingleton` socket failure). Run the render
command with the sandbox disabled. `bun gen.ts` runs fine sandboxed.
Headless Google Chrome with `--screenshot` also works but tends to hang
after writing the file; Playwright's `chromium` is the reliable path.

When changing direction (not just tuning), copy `gen.ts` and the PNG to
`gen-vN-<what>.ts` / `fig-vN-<what>.png` first so the user can compare.

## House style (already in the template)

- Stage 1920×1080 on a dual grid: `U = 1920/77` cell width,
  `CH = 1080/22` cell height, margin `3U`. Snap major edges to cells.
- Ground `#080f11`. Mono terms in GT America Mono 17px inside rounded boxes
  (fill `#0b1a18`, stroke `#183a30`, text `#3d9c72`); a "hot" variant
  brightens all three. Sans phrases in Suisse Intl, tracked `-1.5%`, in
  three tones: raise `#e7e9ea`, secondary `#a1a6a8`, tertiary `#5f6769`.
  Green `#48d597` only for the few things that must pop.
- Connectors 1.5px grey `#8a9396`: orthogonal where the content is
  structured (code, systems, tables), a loose cubic where it is informal
  (people, speech, activity). Regions are a faintly filled rect `#0d1618`
  with a 1px `#1c2628` stroke, optionally with a character dither.
- Mono widths are exact (GT Mono advance 620/1000), so mono boxes can be
  laid out without measuring. Sans cannot; use the measurement loop.

## Process that worked

1. Brainstorm several directions as a numbered list before drawing
   anything. Say which you'd pick and why.
2. Before building the chosen one, show an ASCII sketch of the layout and
   get a yes. It is much cheaper to move things in ASCII.
3. Build, render, show. Then take one or two user notes per round; don't
   bundle speculative changes with requested ones.
4. Keep a `.claude/notes` file with the user's prompts verbatim, the sketch,
   and a pointer to the scratch dir, so the session is resumable.

## Design lessons

- **Don't draw connectors that mean nothing.** A grid of boxes joined by
  lines "because diagrams have lines" reads as nonsense to people who know
  the subject. Every line should be a real relationship, or there should be
  no line.
- **Lines never cross boxes.** Route stubs through the gaps between rows,
  or arrange things so the connected item is adjacent to the connection.
  The second is better: put the items a connection touches at the edge
  nearest it, and let everything else recede.
- **Proximity is the layout.** When a group of items connects to something
  beside it, align the group toward that thing so the connected items sit
  at the ends of their rows. Short stubs, a short trunk, calm. Put the fork
  point at the midpoint of the gap.
- **A boundary that is a place of exchange is a region, not a line.** Give
  it width, a faint fill, texture, and contents of its own rather than
  leaving it as an empty divider between the two sides.
- **Order versus flux without tilting anything.** Rotated text looks like a
  word cloud. Get "wiggle" from varied size (24–52px), varied tone, and
  varied row lengths on an even baseline pitch. The ragged edge of the
  loose side can mirror the ragged edge of the ordered side.
- **Depth as tone.** Items further from the point of contact dim with
  distance. A group opacity from 0.95 down to 0.5 does it.
- **Dots, not arrowheads,** unless direction is genuinely the point. If
  one connector is styled differently (dashed, reversed arrow) without a
  label saying why, it reads as a mistake.
- **Equal gaps beat a centered element.** The user will see 44px vs 112px
  before they see that the middle element is off center. Fix the gaps, let
  the middle drift.
- **Halve margins when labels go.** If a header row is removed, pull the
  content up and re-spread it to fill; don't leave the hole.
- **Harvest real vocabulary.** For a pile of terms, an Explore subagent
  (cheap model) over the actual repo produces far better material than
  memory: crate names, table names, task names, identifiers. The odd,
  specific ones are the ones people remember.
