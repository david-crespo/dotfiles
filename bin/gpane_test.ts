import {
  findPane,
  foregroundCommand,
  formatTree,
  inferLayout,
  planResize,
  planSplitSpan,
  type Size,
  splitResize,
} from "./gpane.ts"

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`)
  }
}

const px = (width: number, height: number): Size => ({ width, height })

// Sizes below mimic TIOCGWINSZ pixels: dividers (~16px) aren't counted, so
// neighbors don't sum exactly to the window. Screen is a 16" MBP at 2x.
const screen = px(3456, 2234)

Deno.test("agent column beside editor over terminal", () => {
  const layout = inferLayout([px(990, 2000), px(1994, 1190), px(1994, 794)], screen)!
  assertEquals(formatTree(layout.tree), "1 | (2 / 3)")
  assertEquals(layout.ambiguous, false)
  assertEquals(layout.rects, [
    { x: 0, y: 0, width: 33, height: 100 },
    { x: 33, y: 0, width: 67, height: 60 },
    { x: 33, y: 60, width: 67, height: 40 },
  ])
})

Deno.test("middle column between agent and editor/terminal", () => {
  const layout = inferLayout(
    [px(490, 2000), px(490, 2000), px(1994, 1190), px(1994, 794)],
    screen,
  )!
  assertEquals(layout.ambiguous, false)
  assertEquals(layout.rects.map((r) => [r.x, r.y, r.width, r.height]), [
    [0, 0, 16, 100],
    [16, 0, 17, 100],
    [33, 0, 67, 60],
    [33, 60, 67, 40],
  ])
})

Deno.test("two agents side by side", () => {
  const layout = inferLayout([px(1492, 2000), px(1492, 2000)], screen)!
  assertEquals(formatTree(layout.tree), "1 | 2")
  assertEquals(layout.ambiguous, false)
})

Deno.test("tracker split above agent (measured sizes)", () => {
  const layout = inferLayout([px(1540, 752), px(1540, 1402)], screen)!
  assertEquals(formatTree(layout.tree), "1 / 2")
  assertEquals(layout.rects[0], { x: 0, y: 0, width: 100, height: 35 })
})

Deno.test("equal 2x2 grid is ambiguous", () => {
  const layout = inferLayout([
    px(1000, 1000),
    px(1000, 1000),
    px(1000, 1000),
    px(1000, 1000),
  ], screen)!
  assertEquals(layout.ambiguous, true)
})

Deno.test("single pane", () => {
  const layout = inferLayout([px(3000, 2000)], screen)!
  assertEquals(formatTree(layout.tree), "1")
  assertEquals(layout.rects, [{ x: 0, y: 0, width: 100, height: 100 }])
})

Deno.test("sizes that can't tile give no layout", () => {
  assertEquals(inferLayout([px(1000, 2000), px(500, 500)], screen), undefined)
})

Deno.test("foreground command is the group leader", () => {
  const procs = [
    { pid: 100, ppid: 1, pgid: 100, command: "login" },
    { pid: 101, ppid: 100, pgid: 101, command: "zsh" },
    { pid: 200, ppid: 101, pgid: 200, command: "claude" },
    { pid: 201, ppid: 200, pgid: 200, command: "node" },
  ]
  assertEquals(foregroundCommand(200, procs), "claude")
  assertEquals(foregroundCommand(101, procs), "zsh")
})

Deno.test("foreground command after exec is login's child", () => {
  // zsh (pid 301) exec'd glow and handed the tty back to login's group
  const procs = [
    { pid: 300, ppid: 1, pgid: 300, command: "login" },
    { pid: 301, ppid: 300, pgid: 300, command: "glow" },
  ]
  assertEquals(foregroundCommand(300, procs), "glow")
})

Deno.test("split resize shrinks or grows the new pane", () => {
  // 35% of a 2000px pane: move the new divider 300px toward the new pane
  assertEquals(splitResize("up", 0.35, 2000), { direction: "up", amount: 300 })
  assertEquals(splitResize("right", 0.35, 2000), { direction: "right", amount: 300 })
  assertEquals(splitResize("down", 0.7, 1000), { direction: "up", amount: 200 })
  assertEquals(splitResize("left", 0.7, 1000), { direction: "right", amount: 200 })
  assertEquals(splitResize("up", 0.5, 2000), undefined)
})

Deno.test("find pane by self or id prefix", () => {
  const panes = [
    { id: "ABCD-1", self: false },
    { id: "ABEF-2", self: true },
  ]
  assertEquals(findPane(panes, "self").id, "ABEF-2")
  assertEquals(findPane(panes, "abc").id, "ABCD-1")
  let error = ""
  try {
    findPane(panes, "AB")
  } catch (e) {
    error = (e as Error).message
  }
  assertEquals(error, "pane id AB is ambiguous; use more characters")
})

Deno.test("resize middle column and agent", () => {
  // agent | mid | right column, total width 2974px
  const sizes = [px(490, 2000), px(490, 2000), px(1994, 1190), px(1994, 794)]
  const { tree } = inferLayout(sizes, screen)!
  // The middle column's right edge is the last divider of the run, reachable
  // from the editor (right column's first leaf) in any nesting. It's at
  // 980/2974 = 33%, so moving it to 58% is 1725 - 980 = 745px right
  assertEquals(planResize(tree, sizes, 1, "right", 0.58), {
    via: 2,
    direction: "right",
    amount: 745,
  })
  // The agent's right edge is the first divider, reachable from the agent
  assertEquals(planResize(tree, sizes, 0, "right", 0.33), {
    via: 0,
    direction: "right",
    amount: 491,
  })
  // Same divider seen from the middle column's left edge
  assertEquals(planResize(tree, sizes, 1, "left", 0.1), {
    via: 0,
    direction: "left",
    amount: 193,
  })
})

Deno.test("resize editor over terminal", () => {
  const sizes = [px(990, 2000), px(1994, 1190), px(1994, 794)]
  const { tree } = inferLayout(sizes, screen)!
  // The editor's bottom edge is 1190/1984 of the way down the 2000px column
  // (the divider's pixels are spread proportionally), 1200px, so 70% is 200px
  assertEquals(planResize(tree, sizes, 1, "bottom", 0.7), {
    via: 2,
    direction: "down",
    amount: 200,
  })
  // The terminal's left edge is the root divider at 990 of 2984px, reached
  // via the editor since it's the first leaf of the right column
  assertEquals(planResize(tree, sizes, 2, "left", 0.5), {
    via: 1,
    direction: "right",
    amount: 502,
  })
})

Deno.test("resize refuses tab edges and inner dividers of long runs", () => {
  const message = (f: () => unknown) => {
    try {
      f()
      return ""
    } catch (e) {
      return (e as Error).message
    }
  }
  const three = [px(990, 2000), px(1994, 1190), px(1994, 794)]
  const t3 = inferLayout(three, screen)!.tree
  assertEquals(
    message(() => planResize(t3, three, 0, "left", 0.5)),
    "pane 1 has no divider on its left edge",
  )
  const four = [px(700, 2000), px(700, 2000), px(700, 2000), px(700, 2000)]
  const t4 = inferLayout(four, screen)!.tree
  assertEquals(
    message(() => planResize(t4, four, 1, "right", 0.3)),
    "can't reach the divider on pane 2's right edge with resize_split",
  )
})

Deno.test("split span plans a middle column", () => {
  // agent | (editor / terminal), 2984px wide
  const sizes = [px(990, 2000), px(1994, 1190), px(1994, 794)]
  const { tree } = inferLayout(sizes, screen)!
  const plan = planSplitSpan(tree, sizes, 0, "right", 0.25)
  assertEquals(plan.edge, "right")
  assertEquals(plan.newIndex, 3)
  assertEquals([plan.inner, plan.far].map((p) => p.toFixed(3)), ["0.332", "0.582"])
  // After the split the run is agent | new | right column; the new pane's
  // right edge is its last divider, reached via the editor, 25% = 746px
  assertEquals(plan.outer, { via: 1, direction: "right", amount: 746 })
})

Deno.test("split span needs space beyond the edge", () => {
  const sizes = [px(990, 2000), px(1994, 1190), px(1994, 794)]
  const { tree } = inferLayout(sizes, screen)!
  const message = (f: () => unknown) => {
    try {
      f()
      return ""
    } catch (e) {
      return (e as Error).message
    }
  }
  assertEquals(
    message(() => planSplitSpan(tree, sizes, 1, "right", 0.2)),
    "pane 2's right edge is the tab's, so there's no space to take; use --size",
  )
  assertEquals(
    message(() => planSplitSpan(tree, sizes, 2, "left", 0.4)),
    "not enough room beyond pane 3's left edge",
  )
})
