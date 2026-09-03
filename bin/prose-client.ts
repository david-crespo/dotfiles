/// <reference lib="dom" />

// Browser half of prose: bundled at server startup by
// `deno bundle --platform browser` (see prose.ts) and served as
// /bundle.js. Holds the Y.Doc that mirrors the draft file, a collapsible
// CodeMirror pane bound to it, a rendered GFM preview, and the selection
// comment popover.

import { basicSetup, EditorView } from "codemirror"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import {
  defaultHighlightStyle,
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language"
import { classHighlighter, highlightCode, tags } from "@lezer/highlight"
import {
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view"
import {
  Compartment,
  type Extension,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state"
import { oneDark } from "@codemirror/theme-one-dark"
import { getCM, Vim, vim } from "@replit/codemirror-vim"
import { helix } from "codemirror-helix"
import * as Y from "yjs"
import { yCollab, ySyncAnnotation } from "y-codemirror.next"
import MarkdownExit from "markdown-exit"
// @ts-expect-error no type declarations
import taskLists from "markdown-it-task-lists"

const content = document.getElementById("content")!
const popover = document.getElementById("popover")!
const commentText = document.getElementById("comment-text") as HTMLTextAreaElement
const toast = document.getElementById("toast")!
const editorHost = document.getElementById("editor-host")!
const editorToggle = document.getElementById("editor-toggle")!
const editorModeButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-editor-mode]"),
]

// ---------- shared document ----------

const ydoc = new Y.Doc()
const ytext = ydoc.getText("content")
const initialState = document.getElementById("initial-state")
let ready = initialState !== null
if (initialState?.textContent) {
  Y.applyUpdate(ydoc, Uint8Array.fromBase64(initialState.textContent), "server")
}

let sock: WebSocket | null = null
let session: string | null = null

ydoc.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin !== "server" && sock?.readyState === WebSocket.OPEN) sock.send(update)
})

function connect() {
  const ws = new WebSocket(`ws://${location.host}/sync`)
  ws.binaryType = "arraybuffer"
  // Nothing is sent until the server's hello confirms we're talking to the
  // same process: pushing state first would merge our Y.Doc history into a
  // restarted server's unrelated fresh one, duplicating the document.
  ws.onmessage = (e) => {
    if (typeof e.data === "string") {
      const msg = JSON.parse(e.data)
      if (msg.type === "hello") {
        if (session !== null && session !== msg.session) {
          location.reload()
          return
        }
        session = msg.session
        ws.send(JSON.stringify({ type: "hello", session }))
        sock = ws
        // Push local state (no-op on first load; syncs offline edits on reconnect)
        ws.send(Y.encodeStateAsUpdate(ydoc))
      }
      return
    }
    Y.applyUpdate(ydoc, new Uint8Array(e.data as ArrayBuffer), "server")
    if (!ready) {
      ready = true
      renderPreview()
    }
  }
  ws.onclose = () => {
    if (sock === ws) sock = null
    setTimeout(connect, 1000)
  }
}
connect()

// ---------- preview ----------

const md = MarkdownExit({ html: true, linkify: true }).use(taskLists)
// Stamp block elements with their source line range so remote-edit flashes
// can find the right blocks after a re-render.
md.core.ruler.push("data_line", (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting !== -1) {
      token.attrSet("data-line", `${token.map[0]}:${token.map[1]}`)
    }
  }
  return true
})

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

// Find the inserted source text within a rendered block and wrap it in an
// inline flash span. Whitespace is stripped from both sides before matching
// (hard-wrapped source vs reflowed rendered text); a second attempt strips
// inline markdown markers. Returns false when the text can't be located or
// the edit rewrote most of the block — callers fall back to a block flash.
function flashInsertedText(el: HTMLElement, inserted: string): boolean {
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
    span.className = "flash-inline"
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
  content.innerHTML = md.render(ytext.toString())
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
        scoped = flashInsertedText(el, r.inserted) && scoped
      }
      if (!scoped) el.classList.add("flash")
    }
    pendingFlash = []
  }
}

if (ready) renderPreview()

let renderTimer: ReturnType<typeof setTimeout> | undefined
ytext.observe(() => {
  if (!ready) return
  clearTimeout(renderTimer)
  renderTimer = setTimeout(renderPreview, 120)
})

// ---------- editor pane ----------

const flashEffect = StateEffect.define<{ from: number; to: number }>()
const clearFlash = StateEffect.define<null>()
const flashMark = Decoration.mark({ class: "cm-flash" })
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        deco = deco.update({ add: [flashMark.range(e.value.from, e.value.to)] })
      }
      if (e.is(clearFlash)) deco = Decoration.none
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

let flashClearTimer: ReturnType<typeof setTimeout> | undefined
function flashRemoteEdits(update: ViewUpdate) {
  const effects: StateEffect<{ from: number; to: number }>[] = []
  update.changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (toB > fromB) effects.push(flashEffect.of({ from: fromB, to: toB }))
    // preview flashes by source line, so pure deletions still flash the block
    const start = update.state.doc.lineAt(fromB).number - 1
    const end = update.state.doc.lineAt(toB).number // 1-based == exclusive 0-based
    pendingFlash.push({ start, end, inserted: update.state.sliceDoc(fromB, toB) })
  })
  if (effects.length > 0) {
    queueMicrotask(() => view.dispatch({ effects }))
    clearTimeout(flashClearTimer)
    flashClearTimer = setTimeout(
      () => view.dispatch({ effects: clearFlash.of(null) }),
      1900,
    )
  }
}

const remoteEditWatcher = EditorView.updateListener.of((update) => {
  if (!update.docChanged || !ready) return
  const remote = update.transactions.some((tr) =>
    tr.annotation(ySyncAnnotation) !== undefined
  )
  if (remote) flashRemoteEdits(update)
})

const darkMode = matchMedia("(prefers-color-scheme: dark)").matches

// Styling for the markdown constructs themselves (the code inside fenced
// blocks is handled by each language's own parser + theme highlight style)
const mdColors = darkMode
  ? { accent: "#61afef", mark: "#5c6370", quote: "#98c379", code: "#e5c07b" }
  : { accent: "#0969da", mark: "#8b949e", quote: "#1a7f37", code: "#953800" }
const mdHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: mdColors.accent, textDecoration: "underline" },
  { tag: tags.url, color: mdColors.accent },
  { tag: tags.monospace, color: mdColors.code },
  { tag: tags.quote, color: mdColors.quote },
  // the #, *, -, > marks themselves
  { tag: tags.processingInstruction, color: mdColors.mark },
])

type EditorMode = "regular" | "vim" | "helix"

const EDITOR_MODE_PREF = "prose-editor-mode"
const editorModeCompartment = new Compartment()

// Follow screen lines by default. Keep operator-pending motions unchanged so
// commands such as dj retain Vim's logical-line behavior.
for (const context of ["normal", "visual"]) {
  Vim.noremap("j", "gj", context)
  Vim.noremap("k", "gk", context)
}

const vimExtension = vim()
const helixExtension = helix()
const helixModeClass = EditorView.editorAttributes.of({
  class: "cm-prose-helix-mode",
})

const visualLineMark = Decoration.line({ class: "cm-vim-visual-line-selected" })

function visualLineDecorations(view: EditorView): DecorationSet {
  const vimState = getCM(view)?.state.vim
  const visualMode = Boolean(vimState?.visualMode)
  const active = Boolean(visualMode && vimState?.visualLine)
  view.dom.classList.toggle("cm-vim-visual-mode", visualMode)
  view.dom.classList.toggle("cm-vim-visual-line", active)
  if (!active) return Decoration.none

  const selection = view.state.selection.main
  const firstLine = view.state.doc.lineAt(selection.from).number
  const lastLine = view.state.doc.lineAt(selection.to).number
  const decorations = new RangeSetBuilder<Decoration>()
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
    const line = view.state.doc.line(lineNumber)
    decorations.add(line.from, line.from, visualLineMark)
  }
  return decorations.finish()
}

const vimVisualLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = visualLineDecorations(view)
    }

    update(update: ViewUpdate) {
      this.decorations = visualLineDecorations(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function storedEditorMode(): EditorMode {
  try {
    const stored = localStorage.getItem(EDITOR_MODE_PREF)
    return stored === "vim" || stored === "helix" ? stored : "regular"
  } catch {
    return "regular"
  }
}

function modeExtension(mode: EditorMode): Extension {
  if (mode === "vim") return vimExtension
  if (mode === "helix") return [helixExtension, helixModeClass]
  return []
}

let currentEditorMode = storedEditorMode()

const extensions: Extension[] = [
  syntaxHighlighting(mdHighlight),
  // Registering mdHighlight (a non-fallback highlighter) deactivates
  // basicSetup's fallback defaultHighlightStyle, so re-add it explicitly for
  // code-block tokens in light mode; oneDark brings its own in dark mode.
  ...(darkMode ? [] : [syntaxHighlighting(defaultHighlightStyle)]),
  // Modal keymaps must come before basicSetup's regular keymap.
  editorModeCompartment.of(modeExtension(currentEditorMode)),
  basicSetup,
  // GFM base (tables, strikethrough, task lists) + per-language highlighting
  // inside fenced code blocks
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
  yCollab(ytext, null),
  flashField,
  remoteEditWatcher,
  vimVisualLinePlugin,
  EditorView.theme({
    "&": { height: "100%", fontSize: "13px" },
    ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  }),
]
if (darkMode) {
  extensions.push(
    oneDark,
    // darker ground than oneDark's #282c34 for more text contrast; matches
    // the page's dark background. Prec.high because earlier/higher-precedence
    // extensions win style conflicts, so a plain theme would lose to oneDark.
    Prec.high(
      EditorView.theme(
        {
          "&": { backgroundColor: "#0d1117" },
          ".cm-gutters": { backgroundColor: "#0d1117" },
          // translucent: the active-line layer paints over the selection
          // layer, so an opaque color would hide selection on that line
          ".cm-activeLine": { backgroundColor: "rgba(110, 118, 129, 0.12)" },
          ".cm-activeLineGutter": { backgroundColor: "#161b22" },
          // mirror oneDark's exact selector — a simpler one loses on specificity
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
            { backgroundColor: "#2d4a6d" },
        },
        { dark: true },
      ),
    ),
  )
}

const view = new EditorView({
  doc: ytext.toString(),
  extensions,
  parent: editorHost,
})

// ---------- editor mode ----------

function renderEditorMode() {
  for (const button of editorModeButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.editorMode === currentEditorMode),
    )
  }
}

renderEditorMode()
for (const button of editorModeButtons) {
  button.addEventListener("click", () => {
    const requestedMode = button.dataset.editorMode
    const mode: EditorMode = requestedMode === "vim" || requestedMode === "helix"
      ? requestedMode
      : "regular"
    if (mode === currentEditorMode) {
      view.focus()
      return
    }
    currentEditorMode = mode
    view.dispatch({ effects: editorModeCompartment.reconfigure(modeExtension(mode)) })
    renderEditorMode()
    try {
      localStorage.setItem(EDITOR_MODE_PREF, mode)
    } catch {
      // storage unavailable; the selection still works for this page load
    }
    view.focus()
  })
}

// Edits are already synced to disk continuously. Consume the reflexive macOS
// save shortcut before Firefox or Chromium can open their Save Page UI.
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

// ---------- editor visibility toggle ----------

const EDITOR_VISIBILITY_PREF = "prose-editor"

function setEditorShown(shown: boolean) {
  document.body.classList.toggle("editor-shown", shown)
  try {
    localStorage.setItem(EDITOR_VISIBILITY_PREF, shown ? "1" : "0")
  } catch {
    // storage unavailable; the toggle still works for this page load
  }
  if (shown) view.focus()
}

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

async function send(kind: "comment" | "dellm", captured: Captured, text?: string) {
  const { selection, prefix, suffix, embed } = captured
  await fetch("/comment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, selection, embed, prefix, suffix, text }),
  })
  showToast(kind === "dellm" ? "de-LLM request sent" : "comment sent")
}

let captured: Captured | null = null

function hidePopover() {
  popover.style.display = "none"
  commentText.value = ""
  captured = null
  CSS.highlights.delete("pending-comment")
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
  const cap = captureSelection()
  if (!cap) {
    hidePopover()
    return
  }
  captured = cap
  // Keep the selection visible while the textarea has focus.
  CSS.highlights.set("pending-comment", new Highlight(cap.range))
  popover.style.display = "flex"
  popover.style.left = window.scrollX + cap.rect.left + "px"
  popover.style.top = window.scrollY + cap.rect.bottom + 8 + "px"
  commentText.focus()
})

function submit(kind: "comment" | "dellm") {
  if (!captured) return
  const text = commentText.value.trim() || undefined
  if (kind === "comment" && !text) return
  send(kind, captured, text)
  hidePopover()
  window.getSelection()?.removeAllRanges()
}
document.getElementById("send")!.addEventListener("click", () => submit("comment"))
document.getElementById("dellm")!.addEventListener("click", () => submit("dellm"))
commentText.addEventListener("keydown", (e) => {
  // ctrl+enter for terminal-browser panes, where cmd chords may not arrive
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit("comment")
  if (e.key === "Escape") hidePopover()
})
