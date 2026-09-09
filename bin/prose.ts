#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net=127.0.0.1,localhost,github.com,raw.githubusercontent.com,private-user-images.githubusercontent.com --allow-run=open,deno,gh,python3,hx

// Local review GUI for a markdown file: GitHub-style live preview, a
// collapsible pane running real helix on the file (hx in a pty, rendered by
// xterm.js), and selection comments that flow back into a running Claude
// Code session over a WebSocket (arm a Monitor with ws://localhost:PORT/claude).
//
// The file on disk is the only document. Helix auto-saves shortly after
// typing stops; Claude edits the file directly; a watcher pushes every disk
// change to the preview. Browser code lives in prose-client.ts, bundled at
// startup. Orchestrated by the prose skill.

import { Command } from "@cliffy/command"
import { basename, dirname, fromFileUrl, join } from "@std/path"

type Comment = {
  kind: "comment" | "dellm"
  selection: string
  prefix: string
  suffix: string
  text?: string
  embed?: string
}

// Helix gets a temp config: the user's config.toml (if any) plus auto-save, so
// the preview updates shortly after typing stops, and auto-reload, so the pane
// picks up Claude's edits to the file instead of going stale. `hx --config`
// replaces config.toml entirely, which is why we concatenate rather than
// override. Steel config (init.scm) still loads from the normal location.
//
// auto-reload is not upstream helix: it's the `auto-reload` branch of the
// local fork (a port of helix-editor/helix#13963 that reloads unmodified
// buffers silently). With `merge`, buffers with unsaved edits get a three-way
// merge of disk into the buffer; overlapping edits are left as conflict
// markers to resolve in place.
const AUTO_SAVE = `
[editor.auto-save]
focus-lost = true

[editor.auto-save.after-delay]
enable = true
timeout = 650
`

const AUTO_RELOAD = `
[editor.auto-reload]
focus-gained = true
merge = true

[editor.auto-reload.periodic]
enable = true
interval = 300
`

async function writeHelixConfig(): Promise<string> {
  let userConfig = ""
  try {
    userConfig = await Deno.readTextFile(
      join(Deno.env.get("HOME")!, ".config/helix/config.toml"),
    )
  } catch {
    // no user config; auto-save section alone is fine
  }
  const path = await Deno.makeTempFile({ prefix: "prose-hx-", suffix: ".toml" })
  let config = userConfig
  if (!config.includes("[editor.auto-save")) config += AUTO_SAVE
  if (!config.includes("[editor.auto-reload")) config += AUTO_RELOAD
  await Deno.writeTextFile(path, config)
  return path
}

function page(title: string, previewOnly: boolean) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src *; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; frame-src 'none'; object-src 'none'">
<title>${title}</title>
<link rel="stylesheet" href="/github-markdown.css">
<link rel="stylesheet" href="/xterm.css">
<style>
  body { margin: 0; background-color: #ffffff; }
  @media (prefers-color-scheme: dark) { body { background-color: #0d1117; } }
  #layout { display: grid; grid-template-columns: 1fr; }
  body.editor-shown #layout { grid-template-columns: minmax(0, 45%) minmax(0, 1fr); }
  #editor-pane {
    display: none;
    position: sticky;
    top: 0;
    align-self: start;
    box-sizing: border-box;
    height: 100vh;
    overflow: hidden;
    padding: 6px 0 6px 6px;
    background: #020202; /* ayu_evolve background, so the pane's padding matches helix */
    border-right: 1px solid #d1d9e0;
  }
  body.editor-shown #editor-pane { display: block; }
  #editor-host { height: 100%; }
  #editor-host .xterm { height: 100%; }
  .markdown-body {
    box-sizing: border-box;
    min-width: 200px;
    max-width: 830px;
    margin: 0 auto;
    padding: 45px;
  }
  #editor-toggle {
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 11;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid #d1d9e0;
    border-radius: 6px;
    background: #f6f8fa;
    color: #59636e;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  #editor-toggle:hover { color: #1f2328; background: #eef1f4; }
  @keyframes flash-fade {
    from { background-color: rgba(255, 223, 93, 0.5); }
    to { background-color: transparent; }
  }
  #content .flash { animation: flash-fade 1.8s ease-out; }
  #content .flash-inline { animation: flash-fade 1.8s ease-out; border-radius: 2px; }
  /* GitHub-style embeds (permalink snippets, assets) */
  .gh-embed img, .gh-embed video { max-width: 100%; }
  .gh-embed { margin-bottom: 16px; }
  .gh-embed-error { color: #d1242f; font-size: 13px; }
  .gh-blob { border: 1px solid #d1d9e0; border-radius: 6px; margin-bottom: 16px; overflow: hidden; }
  .gh-blob-header {
    padding: 8px 16px;
    background: #f6f8fa;
    border-bottom: 1px solid #d1d9e0;
    font-size: 12px;
    color: #59636e;
  }
  .gh-blob-header a { font-weight: 600; }
  .gh-blob-body { display: flex; }
  .gh-blob-body pre {
    margin: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    font-size: 12px !important;
    line-height: 20px;
  }
  .gh-blob-body > pre:last-child { flex: 1; min-width: 0; overflow-x: auto; }
  .gh-blob-gutter { color: #59636e; text-align: right; user-select: none; padding-right: 0 !important; }
  @media (prefers-color-scheme: dark) {
    .gh-embed-error { color: #f85149; }
    .gh-blob { border-color: #3d444d; }
    .gh-blob-header { background: #151b23; border-color: #3d444d; color: #9198a1; }
    .gh-blob-gutter { color: #9198a1; }
  }
  /* lezer classHighlighter tokens in preview code blocks (GitHub palette) */
  .tok-keyword, .tok-operator, .tok-modifier { color: #cf222e; }
  .tok-string, .tok-string2, .tok-regexp { color: #0a3069; }
  .tok-comment, .tok-meta { color: #59636e; }
  .tok-number, .tok-bool, .tok-literal, .tok-atom, .tok-constant { color: #0550ae; }
  .tok-typeName, .tok-className, .tok-tagName, .tok-standard { color: #953800; }
  .tok-function, .tok-macroName { color: #8250df; }
  .tok-propertyName, .tok-attributeName, .tok-definition { color: #0550ae; }
  .tok-heading { font-weight: 600; }
  .tok-link { text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    .tok-keyword, .tok-operator, .tok-modifier { color: #ff7b72; }
    .tok-string, .tok-string2, .tok-regexp { color: #a5d6ff; }
    .tok-comment, .tok-meta { color: #9198a1; }
    .tok-number, .tok-bool, .tok-literal, .tok-atom, .tok-constant { color: #79c0ff; }
    .tok-typeName, .tok-className, .tok-tagName, .tok-standard { color: #ffa657; }
    .tok-function, .tok-macroName { color: #d2a8ff; }
    .tok-propertyName, .tok-attributeName, .tok-definition { color: #79c0ff; }
  }
  #popover {
    position: absolute;
    z-index: 10;
    display: none;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    width: 366px;
    max-width: calc(100vw - 16px);
    padding: 12px;
    border: 1px solid #d1d9e0;
    border-radius: 12px;
    background: #ffffff;
    box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
    font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  #popover textarea {
    resize: vertical;
    min-height: 60px;
    font: inherit;
    line-height: 1.4;
    padding: 8px;
    border: 1px solid #d1d9e0;
    border-radius: 6px;
    background: #f6f8fa;
    color: #1f2328;
    outline: none;
    transition: border-color 0.1s, box-shadow 0.1s;
  }
  #popover textarea:focus {
    background: #ffffff;
    border-color: #0969da;
    box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.3);
  }
  #popover textarea::placeholder { color: #818b98; }
  #popover .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  #popover .hint { color: #59636e; font-size: 11px; flex: 1; text-align: right; }
  #popover button {
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  #popover #dellm {
    background: transparent;
    border: 1px solid #d1d9e0;
    color: #59636e;
  }
  #popover #dellm:hover { color: #1f2328; border-color: #818b98; background: #f6f8fa; }
  #popover #send {
    background: #1f883d;
    border: 1px solid rgba(31, 35, 40, 0.15);
    color: #ffffff;
  }
  #popover #send:hover { background: #1a7f37; }
  #toast {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 14px;
    border-radius: 6px;
    background: #1f883d;
    color: white;
    font: 13px -apple-system, sans-serif;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
  }
  ::highlight(pending-comment) { background-color: rgba(84, 174, 255, 0.4); }
  @media (prefers-color-scheme: dark) {
    #editor-pane { border-right-color: #3d444d; }
    #editor-toggle {
      background: #151b23;
      border-color: #3d444d;
      color: #9198a1;
      color-scheme: dark;
    }
    #editor-toggle:hover { color: #f0f6fc; background: #1c2330; }
    @keyframes flash-fade {
      from { background-color: rgba(187, 128, 9, 0.4); }
      to { background-color: transparent; }
    }
    #popover { background: #151b23; border-color: #3d444d; box-shadow: 0 8px 24px #010409; color: #f0f6fc; }
    #popover textarea { background: #0d1117; color: #f0f6fc; border-color: #3d444d; }
    #popover textarea:focus {
      background: #0d1117;
      border-color: #1f6feb;
      box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.35);
    }
    #popover textarea::placeholder { color: #656c76; }
    #popover .hint { color: #9198a1; }
    #popover #dellm { border-color: #3d444d; color: #9198a1; }
    #popover #dellm:hover { color: #f0f6fc; border-color: #656c76; background: #151b23; }
    #popover #send { background: #238636; border-color: rgba(240, 246, 252, 0.1); }
    #popover #send:hover { background: #29903b; }
  }
</style>
</head>
<body${previewOnly ? ' class="preview-only"' : ""}>
<div id="layout">
  ${previewOnly ? "" : '<div id="editor-pane"><div id="editor-host"></div></div>'}
  <div id="preview-pane"><article class="markdown-body" id="content"></article></div>
</div>
${
    previewOnly
      ? ""
      : '<button id="editor-toggle" aria-label="Toggle helix editor" title="Toggle helix editor (⌘E)">✎</button>'
  }
<div id="popover">
  <textarea id="comment-text" placeholder="Comment for Claude"></textarea>
  <div class="row">
    <button id="dellm" title="Rewrite the selection to sound like a person; comment text (if any) is extra guidance">de-LLM</button>
    <span class="hint">⌘⏎ to send · esc to cancel</span>
    <button id="send">Send</button>
  </div>
</div>
<div id="toast"></div>
<script type="module" src="/bundle.js"></script>
</body>
</html>`
}

// Single contiguous splice turning oldStr into newStr (common prefix/suffix
// diff), for describing a disk change to the session compactly.
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

// deno bundle doesn't fetch missing npm packages itself, so cache first
// (a fast no-op once the packages are in deno's cache).
async function buildClientBundle(binDir: string): Promise<string> {
  const clientPath = join(binDir, "prose-client.ts")
  const config = join(dirname(binDir), "deno.jsonc")
  const run = async (args: string[]) => {
    const out = await new Deno.Command(Deno.execPath(), { args, stderr: "piped" }).output()
    if (!out.success) {
      throw new Error(`${args[0]} failed:\n${new TextDecoder().decode(out.stderr)}`)
    }
  }
  await run(["cache", "--config", config, clientPath])
  const outFile = await Deno.makeTempFile({ prefix: "prose-bundle-", suffix: ".js" })
  try {
    await run([
      "bundle",
      "--quiet",
      "--platform",
      "browser",
      "--config",
      config,
      "--output",
      outFile,
      clientPath,
    ])
    return await Deno.readTextFile(outFile)
  } finally {
    await Deno.remove(outFile).catch(() => {})
  }
}

// ---------- GitHub embeds ----------

let ghTokenPromise: Promise<string | null> | undefined
function ghToken(): Promise<string | null> {
  ghTokenPromise ??= new Deno.Command("gh", { args: ["auth", "token"], stderr: "null" })
    .output()
    .then((o) => (o.success ? new TextDecoder().decode(o.stdout).trim() || null : null))
    .catch(() => null)
  return ghTokenPromise
}

async function ghHeaders(): Promise<HeadersInit> {
  const token = await ghToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

const cacheDir = join(
  Deno.env.get("XDG_CACHE_HOME") ?? join(Deno.env.get("HOME")!, ".cache"),
  "prose",
)

// File contents at a ref. A full commit sha is immutable, so those are cached
// on disk forever; branch names and short shas are fetched every time.
async function fetchBlob(owner: string, repo: string, ref: string, path: string) {
  const immutable = /^[0-9a-f]{40}$/.test(ref)
  const cachePath = join(cacheDir, "blobs", owner, repo, ref, path)
  if (immutable) {
    try {
      return await Deno.readTextFile(cachePath)
    } catch {
      // not cached
    }
  }
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`
  const res = await fetch(url, { headers: await ghHeaders() })
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`)
  const text = await res.text()
  if (immutable) {
    await Deno.mkdir(dirname(cachePath), { recursive: true })
    await Deno.writeTextFile(cachePath, text)
  }
  return text
}

// github.com/user-attachments/assets/<id> redirects to a signed S3 URL that
// works for a few minutes. Resolve it server-side and hand the browser that
// URL, so the bytes never pass through here. Redirects are followed only
// within the allowlisted hosts (the shebang's --allow-net); the final S3
// hostname varies, so the type comes from the redirect URL rather than a
// response header. No auth: public-repo assets need none, and private ones
// are gated on a browser session (a JWT-signed private-user-images URL)
// that a token can't replace.
const assetHosts = ["github.com", "private-user-images.githubusercontent.com"]
async function resolveAsset(url: string) {
  for (let hops = 0; hops < 5; hops++) {
    const u = new URL(url)
    if (!assetHosts.includes(u.hostname)) {
      const type = u.searchParams.get("response-content-type") ??
        mimeTypes[u.pathname.split(".").pop()?.toLowerCase() ?? ""] ?? ""
      return { src: url, type }
    }
    const res = await fetch(url, { redirect: "manual" })
    await res.body?.cancel()
    const location = res.headers.get("location")
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).href
      continue
    }
    if (!res.ok) throw new Error(`${res.status} fetching ${url}`)
    throw new Error(`asset not accessible: ${url}`)
  }
  throw new Error(`too many redirects: ${url}`)
}

const mimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
}

// ---------- helix in a pty ----------

// stdin frame for prose-pty.py: type byte, u32 BE length, payload
function frame(kind: "i" | "r", payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(5 + payload.length)
  buf[0] = kind.charCodeAt(0)
  new DataView(buf.buffer).setUint32(1, payload.length)
  buf.set(payload, 5)
  return buf
}

type PtyMessage = { type: "input"; data: string } | {
  type: "resize"
  cols: number
  rows: number
}

// One helix per WebSocket: spawned when the page opens its editor pane, hung
// up when the socket closes (page reload or close). Output is relayed as
// binary frames; input and resizes arrive as JSON text frames.
function servePty(
  req: Request,
  opts: { binDir: string; hxConfig: string; file: string; port: number },
): Response {
  const q = new URL(req.url).searchParams
  const cols = Math.max(20, Number(q.get("cols")) || 80)
  const rows = Math.max(5, Number(q.get("rows")) || 24)
  const { socket, response } = Deno.upgradeWebSocket(req)
  const enc = new TextEncoder()
  let proc: Deno.ChildProcess | null = null
  let stdin: WritableStreamDefaultWriter<Uint8Array> | null = null
  let sendQueue: Promise<void> = Promise.resolve()
  const write = (buf: Uint8Array) => {
    // Serialize writes: a resize during a burst of typing must not interleave
    // with a partially written input frame.
    sendQueue = sendQueue.then(() => stdin?.write(buf)).catch(() => {})
  }

  socket.onopen = () => {
    proc = new Deno.Command("python3", {
      args: [
        join(opts.binDir, "prose-pty.py"),
        `${cols}x${rows}`,
        "hx",
        "--config",
        opts.hxConfig,
        opts.file,
      ],
      cwd: dirname(opts.file),
      env: {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        // for helix-side integrations (Steel) that want to talk to this server
        PROSE_PORT: String(opts.port),
        PROSE_FILE: opts.file,
      },
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn()
    stdin = proc.stdin.getWriter()
    console.log(`helix started (pid ${proc.pid}, ${cols}x${rows})`)
    ;(async () => {
      try {
        for await (const chunk of proc.stdout) {
          if (socket.readyState === WebSocket.OPEN) socket.send(chunk)
        }
      } catch {
        // socket closed mid-stream
      }
      const status = await proc.status
      console.log(`helix exited (${status.code})`)
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "helix exited")
    })()
  }
  socket.onmessage = (e) => {
    if (typeof e.data !== "string") return
    const msg = JSON.parse(e.data) as PtyMessage
    if (msg.type === "input") write(frame("i", enc.encode(msg.data)))
    else if (msg.type === "resize") write(frame("r", enc.encode(`${msg.cols}x${msg.rows}`)))
  }
  const hangup = () => {
    // Closing stdin makes the helper SIGHUP helix
    sendQueue = sendQueue.then(() => stdin?.close()).catch(() => {})
  }
  socket.onclose = hangup
  socket.onerror = hangup
  return response
}

await new Command()
  .name("prose")
  .description(
    "Serve a markdown file as a live GitHub-style preview with review comments and a helix pane",
  )
  .arguments("<file:string>")
  .option("-p, --port <port:number>", "Port to listen on", { default: 4917 })
  .option("--no-open", "Don't open the browser")
  .action(async ({ port, open }, file) => {
    await Deno.stat(file) // fail fast on bad path

    const binDir = dirname(await Deno.realPath(fromFileUrl(import.meta.url)))
    const [markdownCss, xtermCss, bundleJs, hxConfig] = await Promise.all([
      Deno.readTextFile(join(binDir, "lib", "github-markdown.min.css")),
      Deno.readTextFile(join(binDir, "lib", "xterm.css")),
      buildClientBundle(binDir),
      writeHelixConfig(),
    ])

    // Log comments under XDG state rather than next to the draft, so drafts
    // in versioned directories don't grow a stray .comments.jsonl. One file
    // per draft, named by its absolute path with slashes flattened.
    const stateDir = join(
      Deno.env.get("XDG_STATE_HOME") ??
        join(Deno.env.get("HOME")!, ".local", "state"),
      "prose",
    )
    await Deno.mkdir(stateDir, { recursive: true })
    const absFile = await Deno.realPath(file)
    const commentLog = join(
      stateDir,
      absFile.replaceAll("/", "-") + ".comments.jsonl",
    )
    const claudeClients = new Set<WebSocket>()
    const docClients = new Set<WebSocket>()

    let fileContent = await Deno.readTextFile(file)

    const sendToClaude = (line: string) => {
      for (const ws of claudeClients) {
        try {
          ws.send(line)
        } catch {
          claudeClients.delete(ws)
        }
      }
    }

    const logEvent = async (event: Record<string, unknown>) => {
      const line = JSON.stringify(event)
      await Deno.writeTextFile(commentLog, line + "\n", { append: true })
      sendToClaude(line)
    }

    // --- edit notices to the Claude session ---

    // Edit notices keep the session's mental model of the draft current
    // without a re-read, but the session only needs them when it's about to
    // act — so they never wake it on their own. Disk changes (helix saves,
    // and Claude's own edits echoed back — the session filters those by
    // recognizing its own text) accumulate in a window that flushes right
    // before the next comment, as one splice from the window's base.
    let windowBase: string | null = null

    const flushFileEdit = () => {
      if (windowBase === null) return
      const base = windowBase
      windowBase = null
      // A window that nets out to nothing (typed then undone) isn't worth
      // the session's attention.
      if (base === fileContent) return
      const { start, delLen, insert } = splice(base, fileContent)
      logEvent({
        kind: "file-edit",
        file,
        ts: new Date().toISOString(),
        old: base.slice(start, start + delLen).slice(0, 2000),
        new: insert.slice(0, 2000),
      })
    }

    // --- disk -> preview ---

    const docMessage = () => JSON.stringify({ type: "doc", text: fileContent })

    const onDiskChange = async () => {
      let disk: string
      try {
        disk = await Deno.readTextFile(file)
      } catch {
        return // transiently missing (rename-replace save); next event catches up
      }
      if (disk === fileContent) return
      windowBase ??= fileContent
      fileContent = disk
      const msg = docMessage()
      for (const ws of docClients) {
        try {
          ws.send(msg)
        } catch {
          docClients.delete(ws)
        }
      }
    }

    // Watch the parent dir rather than the file: most editors save by
    // rename-replace, which makes a watch on the file itself go stale.
    const watchTarget = basename(file)
    ;(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      for await (const event of Deno.watchFs(dirname(file))) {
        if (!event.paths.some((p) => basename(p) === watchTarget)) continue
        clearTimeout(timer)
        timer = setTimeout(onDiskChange, 80)
      }
    })()

    // Only the page this server serves may talk to it. Browsers send Origin
    // on POSTs and WebSocket upgrades, so a cross-site page can't inject
    // comments into the session or type into helix; the Host check blocks
    // DNS rebinding. Non-browser clients (the session's Monitor) send neither.
    const selfOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`])
    const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`])

    Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
      const { pathname, searchParams } = new URL(req.url)
      const origin = req.headers.get("origin")
      const host = req.headers.get("host")
      if ((origin && !selfOrigins.has(origin)) || (host && !allowedHosts.has(host))) {
        return new Response("forbidden", { status: 403 })
      }
      if (pathname === "/") {
        // ?preview renders only the markdown pane, for terminal-browser
        // setups where helix runs in a sibling terminal pane (prose-tab)
        return new Response(page(basename(file), searchParams.has("preview")), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }
      if (pathname === "/bundle.js") {
        return new Response(bundleJs, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        })
      }
      if (pathname === "/github-markdown.css" || pathname === "/xterm.css") {
        return new Response(pathname === "/xterm.css" ? xtermCss : markdownCss, {
          headers: { "content-type": "text/css; charset=utf-8" },
        })
      }
      // Embeds: GitHub permalink contents, resolved asset URLs, and local
      // images referenced from the draft (see prose-client.ts hydrateEmbeds).
      if (pathname === "/gh/blob") {
        const args = ["owner", "repo", "ref", "path"].map((k) => searchParams.get(k) ?? "")
        // Each becomes a cache path segment, so no traversal or separators
        const segment = /^(?!\.\.?$)[\w.-]+$/
        const valid = args.slice(0, 3).every((a) => segment.test(a)) &&
          args[3].split("/").every((a) => segment.test(a))
        if (!valid) return new Response("bad request", { status: 400 })
        try {
          const [owner, repo, ref, path] = args
          return new Response(await fetchBlob(owner, repo, ref, path), {
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 502 })
        }
      }
      if (pathname === "/gh/asset") {
        const url = searchParams.get("url") ?? ""
        try {
          return Response.json(await resolveAsset(url))
        } catch (e) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 502 })
        }
      }
      if (pathname === "/local") {
        const p = searchParams.get("path") ?? ""
        const resolved = p.startsWith("/") ? p : join(dirname(absFile), p)
        let real: string
        try {
          real = await Deno.realPath(resolved)
        } catch {
          return new Response("not found", { status: 404 })
        }
        // Anything under $HOME or next to the draft; nothing else is a
        // plausible screenshot location.
        const allowed = [Deno.env.get("HOME")!, dirname(absFile)]
        if (!allowed.some((dir) => real.startsWith(dir + "/"))) {
          return new Response("forbidden", { status: 403 })
        }
        const ext = real.split(".").pop()?.toLowerCase() ?? ""
        const f = await Deno.open(real)
        return new Response(f.readable, {
          headers: { "content-type": mimeTypes[ext] ?? "application/octet-stream" },
        })
      }
      // The preview subscribes here: current file text on connect and after
      // every change on disk.
      if (pathname === "/doc") {
        const { socket, response } = Deno.upgradeWebSocket(req)
        socket.onopen = () => {
          docClients.add(socket)
          socket.send(docMessage())
        }
        socket.onclose = () => docClients.delete(socket)
        socket.onerror = () => docClients.delete(socket)
        return response
      }
      if (pathname === "/pty") {
        return servePty(req, { binDir, hxConfig, file: absFile, port })
      }
      // The Claude Code session connects a Monitor here; each comment is
      // pushed as one JSON text frame.
      if (pathname === "/claude") {
        const { socket, response } = Deno.upgradeWebSocket(req)
        socket.onopen = () => claudeClients.add(socket)
        socket.onclose = () => claudeClients.delete(socket)
        socket.onerror = () => claudeClients.delete(socket)
        return response
      }
      if (pathname === "/comment" && req.method === "POST") {
        const body = (await req.json()) as Comment
        if (body.kind !== "comment" && body.kind !== "dellm") {
          return new Response("bad kind", { status: 400 })
        }
        // A pending edit notice should reach the session before the comment
        // that may refer to the edited text.
        flushFileEdit()
        await logEvent({ ...body, file, ts: new Date().toISOString() })
        return new Response("ok")
      }
      return new Response("not found", { status: 404 })
    })

    const url = `http://localhost:${port}`
    console.log(`reviewing ${file} at ${url}`)
    console.log(`comment feed: ws://localhost:${port}/claude (logged to ${commentLog})`)
    if (open) {
      await new Deno.Command("open", { args: [url] }).output()
    }
  })
  .parse(Deno.args)
