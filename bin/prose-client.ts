/// <reference lib="dom" />

// Browser half of prose: bundled at server startup by
// `deno bundle --platform browser` (see prose.ts) and served as
// /bundle.js. Renders the GFM preview of the file the server pushes over
// /doc, hosts real helix in a collapsible xterm.js pane wired to /pty, and
// runs the selection comment popover.

import { languages } from "@codemirror/language-data"
import { LanguageDescription } from "@codemirror/language"
import { classHighlighter, highlightCode } from "@lezer/highlight"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"
import MarkdownExit from "markdown-exit"
import { Conversation } from "./lib/prose/conversation.ts"
import { findConflictEnd, parseConflict } from "./lib/prose/conflict.ts"
// @ts-expect-error no type declarations
import taskLists from "markdown-it-task-lists"

const content = document.getElementById("content")!
const popover = document.getElementById("popover")!
const commentText = document.getElementById("comment-text") as HTMLTextAreaElement
const toast = document.getElementById("toast")!
// Absent in ?preview mode (helix runs in a sibling terminal pane instead)
const editorHost = document.getElementById("editor-host")
const editorToggle = document.getElementById("editor-toggle")
const conversation = new Conversation(() => hidePopover())

// ---------- document ----------

// The file on disk is the document. The server sends its full text on
// connect and after every change; the diff against the previous text drives
// the change flashes.
let docText: string | null = null

function connectDoc() {
  const ws = new WebSocket(`ws://${location.host}/doc`)
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === "doc") applyDoc(msg.text)
    if (msg.type === "conversation") conversation.receive(msg, msg.replay)
  }
  ws.onclose = () => {
    conversation.setConnected(false)
    setTimeout(connectDoc, 1000)
  }
}
connectDoc()

// Single contiguous splice turning oldStr into newStr (common prefix/suffix)
function splice(oldStr: string, newStr: string) {
  let start = 0
  const maxStart = Math.min(oldStr.length, newStr.length)
  while (start < maxStart && oldStr[start] === newStr[start]) start++
  let endOld = oldStr.length
  let endNew = newStr.length
  while (endOld > start && endNew > start && oldStr[endOld - 1] === newStr[endNew - 1]) {
    endOld--
    endNew--
  }
  return { start, delLen: endOld - start, insert: newStr.slice(start, endNew) }
}

function applyDoc(text: string) {
  if (docText !== null && text !== docText) {
    const { start, insert } = splice(docText, text)
    const lineOf = (offset: number) => text.slice(0, offset).split("\n").length - 1
    // pure deletions still flash the block they happened in
    pendingFlash.push({
      start: lineOf(start),
      end: lineOf(start + insert.length) + 1,
      inserted: insert,
    })
  }
  docText = text
  renderPreview()
}

// ---------- preview ----------

const md = MarkdownExit({ html: true, linkify: true }).use(taskLists)
// Stamp block elements with their source line range so remote-edit flashes
// can find the right blocks after a re-render.
md.core.ruler.push("data_line", (state) => {
  if (state.env.nested) return true // conflict panels: lines are meaningless
  for (const token of state.tokens) {
    if (token.map && token.nesting !== -1) {
      token.attrSet("data-line", `${token.map[0]}:${token.map[1]}`)
    }
  }
  return true
})

// jj/git conflict markers left in the file: render each side (and the base)
// as markdown in a labelled box instead of a wall of marker lines. Top level
// only, matching where jj writes them. `alt` lets a marker line interrupt a
// paragraph, since jj puts no blank line before it.
md.block.ruler.before("table", "conflict", (state, startLine, endLine, silent) => {
  // Column 0 only. Inside a list item this runs as a terminator (silent), so
  // an unindented marker ends the item and the top-level pass renders it.
  if (state.tShift[startLine] > 0) return false
  const raw = (i: number) => state.src.slice(state.bMarks[i], state.eMarks[i])
  if (!raw(startLine).startsWith("<<<<<<<")) return false
  const lines: string[] = []
  for (let i = startLine; i < endLine; i++) lines.push(raw(i))
  const end = findConflictEnd(lines, 0)
  if (end < 0) return false
  if (silent) return true
  const token = state.push("conflict", "div", 0)
  token.block = true
  token.map = [startLine, startLine + end + 1]
  token.meta = parseConflict(lines, 0, end)
  state.line = startLine + end + 1
  return true
}, { alt: ["paragraph", "reference", "blockquote", "list"] })
md.renderer.rules.conflict = (tokens, idx, _opts, _env, self) => {
  const t = tokens[idx]
  const conflict = t.meta as ReturnType<typeof parseConflict>
  const esc = md.utils.escapeHtml
  const panels = conflict.panels.map((p) => {
    const changed = p.changed?.length
      ? ` data-changed="${esc(JSON.stringify(p.changed))}"`
      : ""
    return `<section class="conflict-panel" data-kind="${p.kind}"${changed}>` +
      `<div class="conflict-label">${esc(p.label)}</div>` +
      `<div class="conflict-body">${md.render(p.text, { nested: true })}</div></section>`
  })
  return `<div${self.renderAttrs(t)} class="conflict"><div class="conflict-title">${
    esc(conflict.title)
  }</div>${panels.join("")}</div>\n`
}

// In jj's diff-style markers the changed lines are known exactly; mark them
// in the rendered panels so a one-word difference doesn't hide in a paragraph.
function markConflictChanges() {
  for (
    const panel of content.querySelectorAll<HTMLElement>(".conflict-panel[data-changed]")
  ) {
    const body = panel.querySelector<HTMLElement>(".conflict-body")!
    const cls = panel.dataset.kind === "base" ? "conflict-removed" : "conflict-added"
    const lines = JSON.parse(panel.dataset.changed!) as string[]
    if (wrapText(body, lines.join("\n"), cls)) continue
    for (const line of lines) wrapText(body, line, cls)
  }
}

// GitHub expands two kinds of bare URL on their own line into embeds: a blob
// permalink with a line range becomes a code snippet, and a user-attachments
// asset becomes an image or video. Swap such paragraphs for a placeholder
// that hydrateEmbeds fills in after render.
const permalinkRe =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/([^#?]+)(?:\?[^#]*)?#L(\d+)(?:-L(\d+))?$/
const assetRe =
  /^https:\/\/(?:github\.com\/user-attachments\/assets\/|private-user-images\.githubusercontent\.com\/)\S+$/

md.core.ruler.push("gh_embed", (state) => {
  const toks = state.tokens
  for (let i = 0; i + 2 < toks.length; i++) {
    const [open, inline, close] = [toks[i], toks[i + 1], toks[i + 2]]
    if (open.type !== "paragraph_open" || close.type !== "paragraph_close") continue
    const kids = inline.children ?? []
    if (
      kids.length !== 3 || kids[0].type !== "link_open" || kids[2].type !== "link_close"
    ) {
      continue
    }
    const href = kids[0].attrGet("href") ?? ""
    if (kids[1].content !== href) continue
    if (!permalinkRe.test(href) && !assetRe.test(href)) continue
    const tok = new state.Token("gh_embed", "div", 0)
    tok.attrSet("class", "gh-embed")
    tok.attrSet("data-src", href)
    tok.map = open.map
    tok.block = true
    toks.splice(i, 3, tok)
  }
  return true
})
md.renderer.rules.gh_embed = (tokens, idx, _opts, _env, self) => {
  const t = tokens[idx]
  const href = t.attrGet("data-src") ?? ""
  // Placeholder degrades to the plain link until hydrated
  return `<div${self.renderAttrs(t)}><a href="${md.utils.escapeHtml(href)}">${
    md.utils.escapeHtml(href)
  }</a></div>\n`
}

// Resolved embed contents, keyed by URL. Permalinks are immutable and asset
// redirects stay valid long enough for a session, so nothing expires.
const embedCache = new Map<string, Promise<HTMLElement>>()

function buildEmbed(href: string): Promise<HTMLElement> {
  let p = embedCache.get(href)
  if (!p) {
    p = (permalinkRe.test(href) ? buildBlobEmbed(href) : buildAssetEmbed(href)).catch(
      (e) => {
        embedCache.delete(href) // retry on next render
        const el = document.createElement("div")
        el.className = "gh-embed-error"
        el.textContent = `couldn't load embed: ${e instanceof Error ? e.message : e}`
        return el
      },
    )
    embedCache.set(href, p)
  }
  return p
}

async function buildBlobEmbed(href: string): Promise<HTMLElement> {
  const [, owner, repo, ref, path, startStr, endStr] = permalinkRe.exec(href)!
  const start = Number(startStr)
  const end = endStr ? Number(endStr) : start
  const q = new URLSearchParams({ owner, repo, ref, path })
  const res = await fetch(`/gh/blob?${q}`)
  if (!res.ok) throw new Error(await res.text())
  const lines = (await res.text()).split("\n").slice(start - 1, end)
  const code = lines.join("\n")

  const root = document.createElement("div")
  root.className = "gh-blob"
  const header = document.createElement("div")
  header.className = "gh-blob-header"
  const shortRef = /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref
  header.innerHTML = `<a href="${md.utils.escapeHtml(href)}" target="_blank">${
    md.utils.escapeHtml(repo + "/" + path)
  }</a> <span>${start === end ? `Line ${start}` : `Lines ${start} to ${end}`} in <code>${
    md.utils.escapeHtml(shortRef)
  }</code></span>`
  const body = document.createElement("div")
  body.className = "gh-blob-body"
  const gutter = document.createElement("pre")
  gutter.className = "gh-blob-gutter"
  gutter.textContent = lines.map((_, i) => start + i).join("\n")
  const pre = document.createElement("pre")
  const codeEl = document.createElement("code")
  codeEl.textContent = code
  pre.append(codeEl)
  body.append(gutter, pre)
  root.append(header, body)
  const desc = LanguageDescription.matchFilename(languages, path)
  if (desc) await highlightElement(codeEl, desc, { detached: true })
  return root
}

async function buildAssetEmbed(href: string): Promise<HTMLElement> {
  const res = await fetch(`/gh/asset?${new URLSearchParams({ url: href })}`)
  if (!res.ok) throw new Error(await res.text())
  const { src, type } = (await res.json()) as { src: string; type: string }
  const video = () => {
    const v = document.createElement("video")
    v.src = src
    v.controls = true
    v.muted = true
    return v
  }
  if (type.startsWith("video/")) return video()
  const img = document.createElement("img")
  img.src = src
  img.alt = href
  // The type is inferred from the URL and may be missing; a failed image
  // load most likely means it was a video.
  if (!type) img.onerror = () => img.replaceWith(video())
  return img
}

async function hydrateEmbeds() {
  for (const el of content.querySelectorAll<HTMLElement>(".gh-embed[data-src]")) {
    const built = await buildEmbed(el.dataset.src!)
    if (!el.isConnected) continue // a re-render replaced this block mid-load
    el.replaceChildren(built.cloneNode(true))
    el.classList.add("hydrated")
  }
}

// Images and videos the draft references by local path (screenshots not yet
// uploaded to GitHub) are served by the prose server, relative to the draft.
function rewriteLocalMedia() {
  for (const el of content.querySelectorAll<HTMLElement>("img, video, source")) {
    const src = el.getAttribute("src")
    if (!src || /^(https?:|data:|blob:|\/local\?)/.test(src)) continue
    el.setAttribute("src", `/local?${new URLSearchParams({ path: src })}`)
  }
}

// 0-based [start, end) source line ranges to flash on the next render, with
// the inserted source text so small edits can flash just the changed words
let pendingFlash: { start: number; end: number; inserted: string }[] = []

// Highlight fenced code blocks in the preview with the same lezer parsers
// the editor pane uses (already in the bundle via @codemirror/language-data);
// classHighlighter emits tok-* classes styled in the page CSS.
async function highlightCodeBlocks() {
  for (
    const el of content.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')
  ) {
    const lang = /language-(\S+)/.exec(el.className)?.[1]
    if (!lang) continue
    const desc = LanguageDescription.matchLanguageName(languages, lang, true)
    if (desc) await highlightElement(el, desc)
  }
}

async function highlightElement(
  el: HTMLElement,
  desc: LanguageDescription,
  { detached = false } = {},
) {
  const support = await desc.load()
  if (!detached && !el.isConnected) return // a re-render replaced this block mid-load
  const code = el.textContent ?? ""
  const frag = document.createDocumentFragment()
  highlightCode(
    code,
    support.language.parser.parse(code),
    classHighlighter,
    (text, classes) => {
      if (classes) {
        const span = document.createElement("span")
        span.className = classes
        span.textContent = text
        frag.append(span)
      } else {
        frag.append(text)
      }
    },
    () => frag.append("\n"),
  )
  el.replaceChildren(frag)
}

// Find a piece of source text within a rendered block and wrap it in an
// inline span of the given class. Whitespace is stripped from both sides
// before matching (hard-wrapped source vs reflowed rendered text); a second
// attempt strips inline markdown markers. Returns false when the text can't
// be located or covers most of the block — callers fall back to marking the
// whole block.
function wrapText(el: HTMLElement, inserted: string, className: string): boolean {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const positions: { node: Text; offset: number }[] = []
  let haystack = ""
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    for (let i = 0; i < node.data.length; i++) {
      if (/\s/.test(node.data[i])) continue
      haystack += node.data[i]
      positions.push({ node, offset: i })
    }
  }
  const candidates = [inserted, inserted.replace(/[*_`~[\]]/g, "")]
    .map((s) => s.replace(/\s+/g, ""))
  for (const needle of candidates) {
    // too short to locate reliably, or a rewrite of most of the block
    if (needle.length < 3 || needle.length >= 0.6 * haystack.length) return false
    const idx = haystack.indexOf(needle)
    if (idx < 0) continue
    const start = positions[idx]
    const end = positions[idx + needle.length - 1]
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset + 1)
    const span = document.createElement("span")
    span.className = className
    try {
      range.surroundContents(span)
    } catch {
      // range crosses element boundaries; extract-and-reinsert instead
      span.appendChild(range.extractContents())
      range.insertNode(span)
    }
    return true
  }
  return false
}

function renderPreview() {
  content.innerHTML = md.render(docText ?? "")
  markConflictChanges()
  highlightCodeBlocks()
  rewriteLocalMedia()
  hydrateEmbeds()
  CSS.highlights.delete("pending-comment") // ranges are stale after re-render
  if (pendingFlash.length > 0) {
    const els = [...content.querySelectorAll<HTMLElement>("[data-line]")]
    const hit = els.filter((el) => {
      const [s, e] = el.dataset.line!.split(":").map(Number)
      return pendingFlash.some((r) => s < r.end && e > r.start)
    })
    // flash only the innermost matching blocks; within one, flash just the
    // inserted text when it's small and locatable, else the whole block
    for (const el of hit) {
      if (hit.some((other) => other !== el && el.contains(other))) continue
      const [s, e] = el.dataset.line!.split(":").map(Number)
      const ranges = pendingFlash.filter((r) => s < r.end && e > r.start)
      let scoped = ranges.length > 0
      for (const r of ranges) {
        scoped = wrapText(el, r.inserted, "flash-inline") && scoped
      }
      if (!scoped) el.classList.add("flash")
    }
    pendingFlash = []
  }
}

// ---------- helix pane ----------

// Real helix runs server-side in a pty (see prose.ts servePty); this pane is
// its terminal. It starts on first show and keeps running while hidden, so
// toggling the pane doesn't lose editor state.
const EDITOR_VISIBILITY_PREF = "prose-editor"
let term: Terminal | null = null
let ptySock: WebSocket | null = null

function startHelix(host: HTMLElement) {
  term = new Terminal({
    fontSize: 13,
    fontFamily: '"Berkeley Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    theme: { background: "#020202" },
    cursorBlink: false,
    macOptionIsMeta: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host)
  // The default DOM renderer can't keep up with helix's full-viewport
  // redraws (holding k scrolled several times slower than in a terminal).
  // WebGL renders the same output at terminal speed; if the context is lost
  // or unavailable, dispose the addon and xterm falls back to the DOM renderer.
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch (err) {
    console.warn("prose: WebGL renderer unavailable, using DOM renderer", err)
  }
  fit.fit()
  // Reachable from the devtools console for debugging rendering issues
  Object.assign(globalThis, { proseTerm: term })
  // Let ⌘-chords through to the page (⌘E toggles this pane, ⌘S is swallowed
  // below) instead of xterm eating them.
  term.attachCustomKeyEventHandler((e) => !e.metaKey)

  const spawnSize = { cols: term.cols, rows: term.rows }
  const ws = new WebSocket(
    `ws://${location.host}/pty?${new URLSearchParams({
      cols: String(spawnSize.cols),
      rows: String(spawnSize.rows),
    })}`,
  )
  ws.binaryType = "arraybuffer"
  ptySock = ws
  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }
  const sendSize = () => send({ type: "resize", cols: term!.cols, rows: term!.rows })
  ws.onopen = () => {
    // A fit that ran while the socket was still connecting had nowhere to
    // go; if the size moved on since spawn, tell helix now.
    if (term!.cols !== spawnSize.cols || term!.rows !== spawnSize.rows) sendSize()
  }
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) term?.write(new Uint8Array(e.data))
  }
  ws.onclose = () => {
    ptySock = null
    term?.write("\r\n\x1b[2m[helix exited — click here to restart]\x1b[0m")
    host.addEventListener("click", () => restartHelix(host), { once: true })
  }
  term.onData((data) => send({ type: "input", data }))
  // Spawn counts as a resize: switching to the alternate screen, which helix
  // does at startup, also fires xterm's scroll event.
  let lastResizeAt = Date.now()
  term.onResize(() => {
    lastResizeAt = Date.now()
    sendSize()
  })
  // Helix positions the cursor before every write and never wraps or line
  // feeds, so the alternate screen should never scroll. When it does, helix
  // and xterm disagree about the size (or a glyph width) and every row is
  // off by one until helix happens to rewrite it. Ask helix for a full
  // redraw, which it does on any resize event. Around a resize this is
  // expected and self-correcting: frames drawn for the old size land after
  // xterm shrank, and helix's redraw for the new size repairs them. Outside
  // that window it is an anomaly, so leave a trace in the console. Capped so
  // a persistent disagreement can't turn into a redraw loop.
  const redraws: number[] = []
  let redrawTimer: ReturnType<typeof setTimeout> | undefined
  term.onScroll(() => {
    if (!term || term.buffer.active.type !== "alternate") return
    // xterm fires this before the resize event of the same resize() call, so
    // judge a moment later.
    setTimeout(() => {
      const now = Date.now()
      if (!term || now - lastResizeAt < 1000) return
      while (redraws.length && now - redraws[0] > 10_000) redraws.shift()
      if (redraws.length >= 3) return
      console.warn(
        `prose: helix pane scrolled unexpectedly at ${term.cols}x${term.rows}; requesting redraw`,
      )
      clearTimeout(redrawTimer)
      redrawTimer = setTimeout(() => {
        redraws.push(Date.now())
        send({ type: "redraw" })
      }, 300)
    }, 50)
  })
  new ResizeObserver(() => {
    if (document.body.classList.contains("editor-shown")) fit.fit()
  }).observe(host)
  term.focus()
}

function restartHelix(host: HTMLElement) {
  term?.dispose()
  term = null
  startHelix(host)
}

function setEditorShown(shown: boolean) {
  if (!editorHost) return
  document.body.classList.toggle("editor-shown", shown)
  try {
    localStorage.setItem(EDITOR_VISIBILITY_PREF, shown ? "1" : "0")
  } catch {
    // storage unavailable; the toggle still works for this page load
  }
  if (!shown) return
  if (!ptySock) startHelix(editorHost)
  else term?.focus()
}

if (editorHost && editorToggle) {
  let storedPref: string | null = null
  try {
    storedPref = localStorage.getItem(EDITOR_VISIBILITY_PREF)
  } catch {
    // ignore
  }
  setEditorShown(storedPref === "1")

  editorToggle.addEventListener("click", () => {
    setEditorShown(!document.body.classList.contains("editor-shown"))
  })
  document.addEventListener("keydown", (e) => {
    if (e.key === "e" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      setEditorShown(!document.body.classList.contains("editor-shown"))
    }
  })

  // Helix auto-saves, so ⌘S has nothing to do; consume the reflexive macOS
  // save shortcut before the browser opens its Save Page UI.
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "s" &&
        event.target instanceof Node &&
        editorHost.contains(event.target)
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    { capture: true },
  )
}

// ---------- comment popover ----------

function showToast(msg: string) {
  toast.textContent = msg
  toast.style.opacity = "1"
  setTimeout(() => (toast.style.opacity = "0"), 1500)
}

type Captured = {
  selection: string
  prefix: string
  suffix: string
  embed?: string
  rect: DOMRect
  range: Range
}

// Selection + up to 60 chars of context on each side, for anchoring the
// comment to the markdown source on the Claude side.
function captureSelection(): Captured | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!content.contains(range.commonAncestorContainer)) return null
  const before = range.cloneRange()
  before.setStart(content, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const after = range.cloneRange()
  after.setEnd(content, content.childNodes.length)
  after.setStart(range.endContainer, range.endOffset)
  // Embedded content has no counterpart in the markdown source; a selection
  // inside one also carries the URL that produced it.
  const anchorEl = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement
  const embed = anchorEl?.closest<HTMLElement>(".gh-embed")?.dataset.src
  return {
    selection: range.toString(),
    embed,
    prefix: before.toString().slice(-60),
    suffix: after.toString().slice(0, 60),
    rect: range.getBoundingClientRect(),
    range: range.cloneRange(),
  }
}

let captured: Captured | null = null
let selectionSending = false

function hidePopover() {
  popover.style.display = "none"
  commentText.value = ""
  captured = null
  CSS.highlights.delete("pending-comment")
  conversation.suspendToasts(false)
}

// Focusing the comment box clears the browser's native Selection, though the
// CSS Highlight remains visible. Restore the captured range so the native
// context menu recognizes selected text and offers actions such as Copy.
content.addEventListener("contextmenu", (e) => {
  if (!captured || !(e.target instanceof Node) || !content.contains(e.target)) return
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(captured.range.cloneRange())
})

document.addEventListener("mouseup", (e) => {
  // A right-click's mouseup fires after the context menu opens. Moving focus
  // to the comment box then clears the selection before Copy can use it.
  if (e.button !== 0) return
  if (popover.contains(e.target as Node)) return
  if (conversation.element.contains(e.target as Node)) return
  if (selectionSending) return
  const cap = captureSelection()
  if (!cap) {
    hidePopover()
    return
  }
  captured = cap
  // Keep the selection visible while the textarea has focus.
  CSS.highlights.set("pending-comment", new Highlight(cap.range))
  popover.style.display = "flex"
  conversation.suspendToasts(true)
  // Shift left when the selection is too close to the viewport's right edge.
  const maxLeft = document.documentElement.clientWidth - popover.offsetWidth - 8
  const left = Math.max(8, Math.min(cap.rect.left, maxLeft))
  popover.style.left = window.scrollX + left + "px"
  popover.style.top = window.scrollY + cap.rect.bottom + 8 + "px"
  commentText.focus()
})

async function submit(kind: "comment" | "dellm") {
  if (!captured || selectionSending) return
  const text = commentText.value.trim() || undefined
  if (kind === "comment" && !text) return
  const { selection, prefix, suffix, embed } = captured
  selectionSending = true
  try {
    const result = await conversation.send({ kind, text, selection, prefix, suffix, embed })
    hidePopover()
    window.getSelection()?.removeAllRanges()
    showToast(result.agentConnected ? "Comment sent" : "Comment saved · no agent connected")
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not send comment. Try again.")
  } finally {
    selectionSending = false
  }
}
document.getElementById("send")!.addEventListener("click", () => submit("comment"))
document.getElementById("dellm")!.addEventListener("click", () => submit("dellm"))
commentText.addEventListener("keydown", (e) => {
  // ctrl+enter for terminal-browser panes, where cmd chords may not arrive
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit("comment")
  if (e.key === "Escape") hidePopover()
})
