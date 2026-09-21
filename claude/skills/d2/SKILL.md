---
name: d2
description: Make box-and-arrow diagrams as images with the D2 CLI, including Oxide-styled ones for slides, docs, or notes. Use when the user asks for a diagram as a PNG/SVG, wants an existing mermaid diagram rendered nicely, or mentions d2. Covers the render-and-look loop, the Oxide style import, and layout gotchas.
---

# D2 diagrams

`d2` is installed (`brew install d2`). It renders `.d2` source to SVG or PNG
with dagre or ELK layout built in. No browser needed, renders in tens of ms.

## Loop

1. Write the source to the scratchpad (or wherever the user wants it kept).
2. `d2 file.d2 file.png`
3. Look at the PNG with the Read tool. Fix. Repeat.

For the user to iterate alongside: `d2 --watch file.d2 file.svg` serves a
live-reloading preview in the browser.

## Oxide style

Import the shared style at the top of the file:

```d2
...@/Users/david/repos/dotfiles/d2/oxide.d2

direction: right
a: Some artifact { class: thing }
b: Another { class: thing }
g: A group {
  class: group
  c: Inside { class: thing }
}
a -> b { class: edge }
b -> g.c: uses { class: dashed }
```

Classes: `thing` (green box, the nouns), `group` (gray box, for containers
and verb labels), `edge` (solid), `dashed` (secondary relationship, takes a
label). The import sets ELK layout, padding, and the background. Colors are
design-system dark-theme tokens; the file comments name each one. Font is
D2's default; changing it needs TTF files via `--font-*` flags, not worth it.

See `examples/pipeline.d2` for a full diagram using a container, multi-line
labels, and edge ordering.

## Layout control (ELK)

- **Vertical order within a column** follows node declaration order. To move
  a node to the bottom, declare it last.
- **Port order on a fan-out node** follows edge declaration order. If two
  edges cross on the way to their targets, reorder the edge lines.
- **Nested `direction`** inside a container is ignored under ELK.
- **Container padding** is fixed and generous. A grid container (`grid-rows:
  2`, `grid-gap: 12`) packs children tightly, but only works when edges
  connect to the container itself, not to its children: edges into grid
  children route badly and can drag the container out of its column. For two
  small things that travel together, a single box with a two-line label
  (`"TypeScript client\n+ mock API server"`) usually reads better than any container.
  A container with transparent fill and stroke looks broken; avoid it.
- **Tall fan-out nodes**: a node with many outgoing edges grows to fit its
  ports. Pin it with `height: 70` (or whatever matches the other boxes).
- Invisible edges are not a tool here. There is no `~~~`. Use ordering.

## Syntax gotchas

- Maps must be multi-line or use `;` separators. `vars: { d2-config: {
  layout-engine: elk, theme-id: 200 } }` fails with a confusing "layout not
  found" error. Write it over several lines.
- Newlines in labels: `impl: "API implementation\n(Rust)"`.
- Edge attributes go in braces after the optional label: `a -> b: label {
  class: dashed }`.
- Source arrowheads (`source-arrowhead`) only draw on bidirectional edges
  (`a <-> b`). On `a -> b` they are silently dropped. Arrowhead size cannot be
  changed.
- Import paths (`...@path`) are cut at the first `.`, so a path through
  `.config` or `.claude` fails with "failed to import /path/up/to/dot.d2".
  That is why the style lives at `~/repos/dotfiles/d2/oxide.d2`.
- Top-level background: `style.fill: "#..."` at file root. `theme-id` alone
  does not set it.

## When not to use D2

If the diagram needs to live as text inside an RFD, GitHub markdown, or an
Obsidian note, write mermaid instead: those render mermaid natively and D2
only as an image. Mermaid can be rendered to PNG with `mmdc` (mermaid-cli,
installed) but needs a theme JSON and a CSS file to look like anything.
