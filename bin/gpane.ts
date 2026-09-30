#!/usr/bin/env -S deno run --allow-env --allow-read --allow-run=osascript,python3,ps

// Show the Ghostty split layout of the tab this runs in, so an agent can decide
// where to open a pane (tracker, preview, logs) instead of splitting blind.
//
// Ghostty's AppleScript lists a tab's terminals in split-tree order (in-order
// leaves) but exposes no geometry. Each pane's pixel size comes from TIOCGWINSZ
// on its tty, and the layout is reconstructed by finding split trees over that
// order whose sizes fit together. Normal layouts come out unique; symmetric
// grids can fit more than one tree, which is reported as ambiguous.
//
// `gpane split` splits a pane by id (or `self`), runs a command in the new
// pane, sizes it with resize_split, and returns focus. `gpane resize` moves
// one edge of a pane to a position in the tab.

import $ from "@david/dax"
import { Command, EnumType, ValidationError } from "@cliffy/command"

export interface Size {
  width: number
  height: number
}

/** `row` is side by side (left | right), `column` is stacked (top / bottom). */
export type Tree =
  | { kind: "leaf"; index: number }
  | { kind: "split"; direction: "row" | "column"; first: Tree; second: Tree }

/** Position and size as percentages of the tab. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Layout {
  tree: Tree
  rects: Rect[]
  ambiguous: boolean
}

interface Candidate {
  tree: Tree
  width: number
  height: number
}

// Divider and padding pixels aren't in the pane sizes, so neighbors only line
// up approximately. Real mismatches between unrelated panes are much larger.
const tolerance = (sizes: Size[]) =>
  Math.max(48, 0.03 * Math.max(...sizes.flatMap((s) => [s.width, s.height])))

/**
 * All split trees over panes in this order whose sizes fit together and fit
 * within `bounds` (the largest screen). Without the bounds check, two panes
 * side by side also "fit" stacked into a window twice as tall. Returns
 * undefined if nothing fits (e.g. a pane was resized mid-read).
 */
export function inferLayout(sizes: Size[], bounds?: Size): Layout | undefined {
  if (sizes.length === 0) return undefined
  const tol = tolerance(sizes)
  const memo = new Map<string, Candidate[]>()

  function candidates(start: number, end: number): Candidate[] {
    const key = `${start}:${end}`
    const cached = memo.get(key)
    if (cached) return cached
    const out: Candidate[] = []
    if (end - start === 1) {
      out.push({ tree: { kind: "leaf", index: start }, ...sizes[start] })
    } else {
      for (let mid = start + 1; mid < end; mid++) {
        for (const a of candidates(start, mid)) {
          for (const b of candidates(mid, end)) {
            if (Math.abs(a.height - b.height) <= tol) {
              out.push({
                tree: { kind: "split", direction: "row", first: a.tree, second: b.tree },
                ...combine("row", a, b),
              })
            }
            if (Math.abs(a.width - b.width) <= tol) {
              out.push({
                tree: { kind: "split", direction: "column", first: a.tree, second: b.tree },
                ...combine("column", a, b),
              })
            }
          }
        }
      }
    }
    const fits = bounds
      ? out.filter((c) => c.width <= bounds.width + tol && c.height <= bounds.height + tol)
      : out
    memo.set(key, fits)
    return fits
  }

  const all = candidates(0, sizes.length)
  if (all.length === 0) return undefined

  // Different trees can place panes identically (a | (b | c) vs (a | b) | c),
  // so only count distinct placements as ambiguity
  const placements = new Map<string, Layout>()
  for (const { tree } of all) {
    const rects = placeTree(tree, sizes)
    const key = rects.map((r) => [r.x, r.y, r.width, r.height].join(",")).join(";")
    if (!placements.has(key)) placements.set(key, { tree, rects, ambiguous: false })
  }
  const [first] = placements.values()
  return { ...first, ambiguous: placements.size > 1 }
}

/** Size of two panes side by side (`row`) or stacked (`column`). */
function combine(direction: "row" | "column", a: Size, b: Size): Size {
  return direction === "row"
    ? { width: a.width + b.width, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height }
}

function treeSize(tree: Tree, sizes: Size[]): Size {
  if (tree.kind === "leaf") return sizes[tree.index]
  return combine(tree.direction, treeSize(tree.first, sizes), treeSize(tree.second, sizes))
}

function placeTree(tree: Tree, sizes: Size[]): Rect[] {
  // Round only at the end so equivalent trees produce identical placements
  return placeTreeExact(tree, sizes).map((r) => {
    const x = Math.round(r.x)
    const y = Math.round(r.y)
    return {
      x,
      y,
      width: Math.round(r.x + r.width) - x,
      height: Math.round(r.y + r.height) - y,
    }
  })
}

function placeTreeExact(tree: Tree, sizes: Size[]): Rect[] {
  const rects: Rect[] = new Array(sizes.length)
  const place = (node: Tree, rect: Rect) => {
    if (node.kind === "leaf") {
      rects[node.index] = rect
      return
    }
    const a = treeSize(node.first, sizes)
    const b = treeSize(node.second, sizes)
    if (node.direction === "row") {
      const w = (rect.width * a.width) / (a.width + b.width)
      place(node.first, { ...rect, width: w })
      place(node.second, { ...rect, x: rect.x + w, width: rect.width - w })
    } else {
      const h = (rect.height * a.height) / (a.height + b.height)
      place(node.first, { ...rect, height: h })
      place(node.second, { ...rect, y: rect.y + h, height: rect.height - h })
    }
  }
  place(tree, { x: 0, y: 0, width: 100, height: 100 })
  return rects
}

/** Compact nesting with 1-based pane numbers, e.g. `1 | (2 / 3)`. */
export function formatTree(tree: Tree, top = true): string {
  if (tree.kind === "leaf") return String(tree.index + 1)
  const op = tree.direction === "row" ? " | " : " / "
  const s = formatTree(tree.first, false) + op + formatTree(tree.second, false)
  return top ? s : `(${s})`
}

export type Direction = "up" | "down" | "left" | "right"

const opposite: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
}

/**
 * The `resize_split` that leaves a freshly split pane with `fraction` of the
 * original pane's `extent` (its height for up/down, width for left/right).
 * Splits come out 50/50, and resize_split on the new pane moves the nearest
 * enclosing divider of the matching orientation, which is the new one.
 * Moving it in the split's direction shrinks the new pane either way: `up`
 * lowers the top side's ratio, `down` raises it.
 */
export function splitResize(
  direction: Direction,
  fraction: number,
  extent: number,
): { direction: Direction; amount: number } | undefined {
  const amount = Math.round(Math.abs(0.5 - fraction) * extent)
  if (amount === 0) return undefined
  return { direction: fraction < 0.5 ? direction : opposite[direction], amount }
}

/** `self`, or a unique prefix of a pane id as printed by `gpane ls`. */
export function findPane<P extends { id: string; self: boolean }>(
  panes: P[],
  ref: string,
): P {
  if (ref === "self") return panes.find((p) => p.self)!
  const matches = panes.filter((p) => p.id.toLowerCase().startsWith(ref.toLowerCase()))
  if (matches.length === 1) return matches[0]
  throw new Error(
    matches.length === 0
      ? `no pane in this tab with id starting ${ref}`
      : `pane id ${ref} is ambiguous; use more characters`,
  )
}

export type Edge = "top" | "bottom" | "left" | "right"

/** `row` for left/right, `column` for up/down and top/bottom. */
const axis = (d: Direction | Edge): "row" | "column" =>
  d === "left" || d === "right" ? "row" : "column"

/** Split tree with runs of same-direction splits merged: `a | b | c`. */
type Flat =
  | { kind: "leaf"; index: number }
  | { kind: "split"; direction: "row" | "column"; children: Flat[] }

function flatten(tree: Tree): Flat {
  if (tree.kind === "leaf") return tree
  const children = [tree.first, tree.second].flatMap((child) => {
    const flat = flatten(child)
    return flat.kind === "split" && flat.direction === tree.direction
      ? flat.children
      : [flat]
  })
  return { kind: "split", direction: tree.direction, children }
}

function containsLeaf(node: Flat, index: number): boolean {
  return node.kind === "leaf"
    ? node.index === index
    : node.children.some((c) => containsLeaf(c, index))
}

/**
 * The resize_split that moves one edge of pane `index` to `position` (0-1) of
 * the tab's width or height, measured from the left or top. `amount` is in
 * backing pixels, `via` is the pane to send it to.
 *
 * Positions rather than sizes because moving a divider moves exactly that
 * divider, but panes nested beside it scale with it by ratios that the
 * inferred tree doesn't know: in `(a | b) | c`, moving b's right edge grows a
 * too. So when moving several edges, move the outer ones first.
 *
 * resize_split moves the divider of the nearest split around the receiving
 * pane with the matching orientation. The inferred tree can't tell
 * `(a | b) | c` from `a | (b | c)`, which route that differently, so work on
 * the flattened `a | b | c`: in any nesting, the first and last children of a
 * run each sit directly under the split that owns the divider next to them.
 * A pane there, or one reached only through splits of the other orientation,
 * gets the right divider. Inner dividers of runs of four or more have no such
 * pane.
 */
export function planResize(
  tree: Tree,
  sizes: Size[],
  index: number,
  edge: Edge,
  position: number,
): { via: number; direction: Direction; amount: number } {
  const direction = axis(edge)
  const before = edge === "left" || edge === "top"

  // Innermost run of the matching direction with a divider on this edge
  let divider: { run: Flat[]; at: number } | undefined
  const find = (node: Flat) => {
    if (node.kind === "leaf") return
    const i = node.children.findIndex((c) => containsLeaf(c, index))
    if (node.direction === direction) {
      const at = before ? i - 1 : i
      if (at >= 0 && at < node.children.length - 1) divider = { run: node.children, at }
    }
    find(node.children[i])
  }
  find(flatten(tree))
  if (!divider) throw new Error(`pane ${index + 1} has no divider on its ${edge} edge`)

  const { run, at } = divider
  const reachable = (node: Flat) =>
    node.kind === "leaf" ? node.index : node.children.find((c) => c.kind === "leaf")?.index
  const via = (at + 1 === run.length - 1 ? reachable(run[at + 1]) : undefined) ??
    (at === 0 ? reachable(run[0]) : undefined)
  if (via === undefined) {
    throw new Error(
      `can't reach the divider on pane ${index + 1}'s ${edge} edge with resize_split`,
    )
  }

  return { via, ...edgeMove(tree, sizes, index, edge, position) }
}

/** Where an edge of pane `index` is, as a fraction of the tab from left or top. */
export function edgePosition(tree: Tree, sizes: Size[], index: number, edge: Edge): number {
  const r = placeTreeExact(tree, sizes)[index]
  const percent = {
    left: r.x,
    right: r.x + r.width,
    top: r.y,
    bottom: r.y + r.height,
  }[edge]
  return percent / 100
}

/** The resize_split direction and backing pixels that move an edge to `position`. */
function edgeMove(
  tree: Tree,
  sizes: Size[],
  index: number,
  edge: Edge,
  position: number,
): { direction: Direction; amount: number } {
  const row = axis(edge) === "row"
  const total = treeSize(tree, sizes)
  const delta = (position - edgePosition(tree, sizes, index, edge)) *
    (row ? total.width : total.height)
  return {
    direction: row ? (delta >= 0 ? "right" : "left") : (delta >= 0 ? "down" : "up"),
    amount: Math.round(Math.abs(delta)),
  }
}

/** The tree after splitting leaf `index`, with the new pane as leaf `newIndex`. */
function splitLeaf(
  tree: Tree,
  index: number,
  direction: Direction,
  newIndex: number,
): Tree {
  if (tree.kind === "split") {
    return {
      ...tree,
      first: splitLeaf(tree.first, index, direction, newIndex),
      second: splitLeaf(tree.second, index, direction, newIndex),
    }
  }
  if (tree.index !== index) return tree
  const added: Tree = { kind: "leaf", index: newIndex }
  const newFirst = direction === "up" || direction === "left"
  return {
    kind: "split",
    direction: axis(direction),
    first: newFirst ? added : tree,
    second: newFirst ? tree : added,
  }
}

const edgeToward = { up: "top", down: "bottom", left: "left", right: "right" } as const

/**
 * Plan for splitting pane `index` so the new pane gets `fraction` of the tab
 * and the split pane keeps its size, taking the space from beyond the split
 * pane's edge in that direction. First move that edge (now the new pane's far
 * edge) out to `far`, via `outer`, which is planned on the predicted tree
 * after the split (a 50/50 pair in place of the pane; the new pane is index
 * `sizes.length`). Moving it rescales the pair by ratios we can't know, so the
 * caller re-reads the layout before moving the pair's own divider to `inner`.
 */
export function planSplitSpan(
  tree: Tree,
  sizes: Size[],
  index: number,
  direction: Direction,
  fraction: number,
) {
  const edge = edgeToward[direction]
  const inner = edgePosition(tree, sizes, index, edge)
  if (inner < 0.005 || inner > 0.995) {
    throw new Error(
      `pane ${
        index + 1
      }'s ${edge} edge is the tab's, so there's no space to take; use --size`,
    )
  }
  const far = direction === "up" || direction === "left"
    ? inner - fraction
    : inner + fraction
  if (far <= 0 || far >= 1) {
    throw new Error(`not enough room beyond pane ${index + 1}'s ${edge} edge`)
  }
  const newIndex = sizes.length
  const half = axis(direction) === "column"
    ? { width: sizes[index].width, height: sizes[index].height / 2 }
    : { width: sizes[index].width / 2, height: sizes[index].height }
  const predictedSizes = sizes.map((s, i) => (i === index ? half : s)).concat([half])
  const predictedTree = splitLeaf(tree, index, direction, newIndex)
  const outer = planResize(predictedTree, predictedSizes, newIndex, edge, far)
  return { edge, inner, far, outer, newIndex }
}

// ---------------------------------------------------------------------------

interface Pane {
  id: string
  tty: string
  title: string
  cwd: string
  command: string
  cols: number
  rows: number
  width: number
  height: number
  self: boolean
  focused: boolean
}

interface TabInfo {
  /** Largest screen in backing pixels */
  screen: Size
  window: number
  tab: number
  tabName: string
  /** AppleScript ids, for looking the tab up again */
  windowId: string
  tabId: string
  panes: Pane[]
}

const FIELD = "\x1f"
const RECORD = "\x1e"

async function readTab(selfTty: string): Promise<TabInfo> {
  const script = `
use framework "AppKit"

on run argv
  set targetTty to item 1 of argv
  -- largest screen in backing pixels, to rule out layouts bigger than any screen
  set maxW to 0
  set maxH to 0
  repeat with screen in (current application's NSScreen's screens() as list)
    set scale to (screen's backingScaleFactor()) as real
    set f to screen's frame()
    set w to ((item 1 of item 2 of f) * scale) as integer
    set h to ((item 2 of item 2 of f) * scale) as integer
    if w > maxW then set maxW to w
    if h > maxH then set maxH to h
  end repeat
  set fs to character id 31
  set rs to character id 30
  tell application "Ghostty"
    set windowIndex to 0
    repeat with w in windows
      set windowIndex to windowIndex + 1
      repeat with t in tabs of w
        set ttys to {}
        repeat with term in terminals of t
          set end of ttys to (tty of term as text)
        end repeat
        if ttys contains targetTty then
          set out to (maxW as text) & fs & (maxH as text) & fs & (windowIndex as text) & fs & (index of t as text) & fs & (name of t) & fs & (id of focused terminal of t) & fs & (id of w) & fs & (id of t)
          repeat with term in terminals of t
            set out to out & rs & (id of term) & fs & (tty of term) & fs & (name of term) & fs & (working directory of term) & fs & (pid of term as text)
          end repeat
          return out
        end if
      end repeat
    end repeat
  end tell
  error "no Ghostty terminal with tty " & targetTty
end run
`
  const out = (await $`osascript -e ${script} ${selfTty}`.text()).replace(/\n$/, "")
  const [header, ...records] = out.split(RECORD)
  const [screenW, screenH, window, tab, tabName, focusedId, windowId, tabId] = header.split(
    FIELD,
  )
  const terms = records.map((r) => {
    const [id, tty, title, cwd, pid] = r.split(FIELD)
    return { id, tty, title, cwd, pid: Number(pid) }
  })

  const sizes: number[][] = JSON.parse(
    await $`python3 -c ${WINSIZE_PY} ${terms.map((t) => t.tty)}`.text(),
  )
  const procs = await listProcs()

  return {
    screen: { width: Number(screenW), height: Number(screenH) },
    window: Number(window),
    tab: Number(tab),
    tabName,
    windowId,
    tabId,
    panes: terms.map((t, i) => {
      const [rows, cols, width, height] = sizes[i]
      return {
        id: t.id,
        tty: t.tty,
        title: t.title,
        cwd: t.cwd,
        command: foregroundCommand(t.pid, procs),
        cols,
        rows,
        width,
        height,
        self: t.tty === selfTty,
        focused: t.id === focusedId,
      }
    }),
  }
}

// Deno has no ioctl, and calling libc's variadic ioctl through FFI is unsafe
// on arm64, so read window sizes (rows, cols, xpixel, ypixel) with Python
const WINSIZE_PY = `
import fcntl, json, os, struct, sys, termios
out = []
for path in sys.argv[1:]:
    fd = os.open(path, os.O_RDONLY | os.O_NOCTTY)
    out.append(struct.unpack("HHHH", fcntl.ioctl(fd, termios.TIOCGWINSZ, bytes(8))))
    os.close(fd)
print(json.dumps(out))
`

export interface Proc {
  pid: number
  ppid: number
  pgid: number
  command: string
}

/**
 * Ghostty's terminal `pid` is really the tty's foreground process group
 * (tcgetpgrp). That's usually the command's own pid, but after `exec` in zsh
 * (as `tracker --split` does) zsh hands the terminal back to the group it
 * started in, which belongs to macOS's `login` wrapper. So name the group's
 * leader unless it's login, in which case name login's child in the group.
 */
export function foregroundCommand(pgid: number, procs: Proc[]): string {
  const group = procs.filter((p) => p.pgid === pgid)
  const leader = group.find((p) => p.pid === pgid)
  if (leader && leader.command !== "login") return leader.command
  return group.find((p) => p.ppid === pgid)?.command ?? leader?.command ?? ""
}

async function listProcs(): Promise<Proc[]> {
  const out = await $`ps -A -o pid=,ppid=,pgid=,comm=`.noThrow().text()
  return out.split("\n").filter(Boolean).map((line) => {
    const [, pid, ppid, pgid, comm] = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)!
    return {
      pid: Number(pid),
      ppid: Number(ppid),
      pgid: Number(pgid),
      command: comm.split("/").at(-1)!.replace(/^-/, ""),
    }
  })
}

interface SplitOptions {
  /** Shell command typed into the new pane (prefixed with exec) */
  command?: string
  cwd: string
  /** Terminal to focus afterwards */
  refocus: string
  /** The target's window and tab ids */
  windowId: string
  tabId: string
}

/** Split a terminal and return the new terminal's id. */
async function splitPane(targetId: string, direction: Direction, opts: SplitOptions) {
  const script = `
on run argv
  set {targetId, splitDirection, cmd, cwd, refocusId, windowId, tabId} to argv
  tell application "Ghostty"
    set target to terminal id targetId
    set cfg to new surface configuration
    set initial working directory of cfg to cwd
    if cmd is not "" then set initial input of cfg to cmd
    if splitDirection is "up" then
      set newTerminal to split target direction up with configuration cfg
    else if splitDirection is "down" then
      set newTerminal to split target direction down with configuration cfg
    else if splitDirection is "left" then
      set newTerminal to split target direction left with configuration cfg
    else
      set newTerminal to split target direction right with configuration cfg
    end if
    -- Ghostty focuses the new pane asynchronously, retrying for up to ~0.75s
    -- until it's attached to the window, so wait for that before refocusing
    set t to tab id tabId of window id windowId
    repeat 20 times
      if id of focused terminal of t is id of newTerminal then exit repeat
      delay 0.05
    end repeat
    focus (terminal id refocusId)
    return id of newTerminal
  end tell
end run
`
  const out = await $`osascript -e ${script} ${targetId} ${direction} ${
    opts.command ? `exec ${opts.command}\n` : ""
  } ${opts.cwd} ${opts.refocus} ${opts.windowId} ${opts.tabId}`
    .text()
  return out.trim()
}

/** Send resize_split to a terminal. `pixels` are backing pixels. */
async function resizeSplit(terminalId: string, direction: Direction, pixels: number) {
  const script = `
use framework "AppKit"

on run argv
  set {terminalId, resizeDirection, resizePixels} to argv
  -- resize_split counts in points, TIOCGWINSZ in backing pixels
  set scale to (current application's NSScreen's mainScreen()'s backingScaleFactor()) as real
  set resizePoints to ((resizePixels as integer) / scale) div 1
  tell application "Ghostty"
    perform action ("resize_split:" & resizeDirection & "," & resizePoints) on terminal id terminalId
  end tell
end run
`
  await $`osascript -e ${script} ${terminalId} ${direction} ${pixels}`.stdout("null")
}

/** The tab's layout, when it's clear enough to pick a divider to move. */
function requireLayout(info: TabInfo): Layout {
  const layout = inferLayout(info.panes, info.screen)
  if (!layout) throw new Error("could not infer the layout from pane sizes")
  if (layout.ambiguous) {
    throw new Error("layout is ambiguous, not sure which divider to move")
  }
  return layout
}

/**
 * `split --width/--height`: split, move the far edge out, wait for the layout
 * to show it, then put the split pane's edge back. See planSplitSpan.
 */
async function splitSpan(
  info: TabInfo,
  target: Pane,
  direction: Direction,
  fraction: number,
  opts: SplitOptions,
): Promise<string> {
  const plan = planSplitSpan(
    requireLayout(info).tree,
    info.panes,
    info.panes.indexOf(target),
    direction,
    fraction,
  )
  const newId = await splitPane(target.id, direction, opts)
  const idOf = (i: number) => (i === plan.newIndex ? newId : info.panes[i].id)
  await resizeSplit(idOf(plan.outer.via), plan.outer.direction, plan.outer.amount)

  // Pane sizes update asynchronously after a resize
  const deadline = Date.now() + 2000
  while (true) {
    const now = await readTab(selfTty())
    const after = inferLayout(now.panes, now.screen)
    const index = now.panes.findIndex((p) => p.id === newId)
    const targetIndex = now.panes.findIndex((p) => p.id === target.id)
    if (after && index >= 0 && targetIndex >= 0) {
      const far = edgePosition(after.tree, now.panes, index, plan.edge)
      if (Math.abs(far - plan.far) < 0.015) {
        const move = edgeMove(after.tree, now.panes, targetIndex, plan.edge, plan.inner)
        // The new pane sits directly under the split it made with the target
        if (move.amount > 0) await resizeSplit(newId, move.direction, move.amount)
        return newId
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`split ${newId} but its far edge didn't settle; check gpane ls`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function parsePercent(value: string): number {
  const fraction = Number(value.replace(/%$/, "")) / 100
  if (!(fraction > 0 && fraction < 1)) {
    throw new ValidationError(`expected a percentage between 0% and 100%, got ${value}`)
  }
  return fraction
}

/** The caller's tty. Exported by .zshrc; agents have no controlling terminal but inherit it. */
function selfTty() {
  const tty = Deno.env.get("GHOSTTY_TERMINAL_TTY")
  if (!tty) throw new Error("GHOSTTY_TERMINAL_TTY is not set (not in Ghostty?)")
  return tty
}

function formatTab(info: TabInfo, layout: Layout | undefined): string {
  const home = Deno.env.get("HOME") ?? ""
  const tilde = (p: string) => (home && p.startsWith(home) ? "~" + p.slice(home.length) : p)
  const lines = [
    `window ${info.window}, tab ${info.tab} "${info.tabName}": ${info.panes.length} pane(s)`,
  ]
  if (layout) {
    lines.push(
      `layout: ${formatTree(layout.tree)}` +
        (layout.ambiguous ? "  (ambiguous: other arrangements fit the same sizes)" : ""),
    )
  } else {
    lines.push("layout: could not infer from pane sizes")
  }
  lines.push("")
  const rows = info.panes.map((p, i) => {
    const r = layout?.rects[i]
    return [
      String(i + 1),
      p.id.slice(0, 8),
      r ? `${r.x},${r.y}` : "?",
      r ? `${r.width}x${r.height}` : "?",
      `${p.cols}x${p.rows}`,
      p.command,
      tilde(p.cwd),
      [p.self && "self", p.focused && "focused"].filter(Boolean).join(","),
    ]
  })
  const header = ["#", "id", "x,y%", "w x h%", "cols x rows", "cmd", "cwd", ""]
  const table = [header, ...rows]
  const widths = header.map((_, c) => Math.max(...table.map((r) => r[c].length)))
  for (const r of table) {
    lines.push(r.map((cell, c) => cell.padEnd(widths[c])).join("  ").trimEnd())
  }
  return lines.join("\n")
}

if (import.meta.main) {
  await new Command()
    .name("gpane")
    .description("Inspect and split the Ghostty panes of the tab this runs in.")
    .action(function () {
      this.showHelp()
    })
    .command("ls", "Show this tab's panes and their inferred layout.")
    .action(async () => {
      const info = await readTab(selfTty())
      console.log(formatTab(info, inferLayout(info.panes, info.screen)))
    })
    .command(
      "split",
      "Split a pane in this tab, optionally running a command in the new pane.\n" +
        "The command is typed into the new shell with exec, so the pane closes when it exits.\n" +
        "Prints the new pane's id. Focus goes back to the pane that had it.",
    )
    .type("direction", new EnumType(["up", "down", "left", "right"]))
    .arguments("<pane:string> <direction:direction>")
    .option(
      "--size <percent:string>",
      "New pane's share of the split pane, 10-90%. Defaults to 50%.",
      { conflicts: ["width", "height"] },
    )
    .option(
      "--width <percent:string>",
      "For left/right: new pane's share of the tab, taken from beyond the split pane.",
      { conflicts: ["height"] },
    )
    .option("--height <percent:string>", "Like --width, for up/down.")
    .example("tracker above self", "gpane split self up --size 35% -- glow --tui notes.md")
    .example("middle column", "gpane split self right --width 25% -- tracker notes.md")
    .action(async function ({ size, width, height }, ref, direction) {
      const info = await readTab(selfTty())
      const target = findPane(info.panes, ref)
      const command = this.getLiteralArgs().map((a) => $.escapeArg(a)).join(" ")
      const focused = info.panes.find((p) => p.focused) ?? info.panes.find((p) => p.self)!
      const base = {
        command,
        cwd: Deno.cwd(),
        refocus: focused.id,
        windowId: info.windowId,
        tabId: info.tabId,
      }
      const span = width ?? height
      if (span !== undefined) {
        const vertical = axis(direction) === "column"
        if (vertical !== (height !== undefined)) {
          throw new ValidationError(
            vertical ? "use --height with up/down" : "use --width with left/right",
          )
        }
        console.log(await splitSpan(info, target, direction, parsePercent(span), base))
        return
      }
      const fraction = size === undefined ? 0.5 : parsePercent(size)
      if (!(fraction >= 0.1 && fraction <= 0.9)) {
        throw new ValidationError(`--size must be between 10% and 90%, got ${size}`)
      }
      const extent = axis(direction) === "row" ? target.width : target.height
      const newId = await splitPane(target.id, direction, base)
      const resize = splitResize(direction, fraction, extent)
      if (resize) await resizeSplit(newId, resize.direction, resize.amount)
      console.log(newId)
    })
    .command(
      "resize",
      "Move one edge of a pane to N% of the tab, measured from the left or top.\n" +
        "Panes nested beside the divider scale with it, so when moving several\n" +
        "edges, do the outer ones first. Ghostty keeps each split between 10% and 90%.",
    )
    .type("edge", new EnumType(["top", "bottom", "left", "right"]))
    .arguments("<pane:string> <edge:edge> <position:string>")
    .example(
      "middle column",
      "gpane resize <middle> right 58%  # then: gpane resize self right 33%",
    )
    .action(async (_options, ref, edge, positionArg) => {
      const info = await readTab(selfTty())
      const target = findPane(info.panes, ref)
      const position = parsePercent(positionArg)
      const plan = planResize(
        requireLayout(info).tree,
        info.panes,
        info.panes.indexOf(target),
        edge,
        position,
      )
      if (plan.amount > 0) {
        await resizeSplit(info.panes[plan.via].id, plan.direction, plan.amount)
      }
    })
    .parse(Deno.args)
    .catch((error) => {
      // Cliffy prints its own usage errors; for the rest a message is enough
      console.error(`gpane: ${error instanceof Error ? error.message : error}`)
      Deno.exit(1)
    })
}
