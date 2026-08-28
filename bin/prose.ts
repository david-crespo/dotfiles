#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-run=open,deno

// Local review GUI for a markdown file: GitHub-style live preview, an
// optional CodeMirror editing pane, and selection comments that flow back
// into a running Claude Code session over a WebSocket (arm a Monitor with
// ws://localhost:PORT/claude). The server holds a Y.Doc bridging the file on
// disk (which Claude edits directly) and the browser (which edits over
// ws://.../sync); browser code lives in prose-client.ts, bundled at
// startup. Orchestrated by the prose skill.

import { Command } from "@cliffy/command"
import { basename, dirname, fromFileUrl, join } from "@std/path"
import * as Y from "yjs"

type Comment = {
  kind: "comment" | "dellm"
  selection: string
  prefix: string
  suffix: string
  text?: string
}

function page(title: string, initialState: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/github-markdown.css">
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
    height: 100vh;
    overflow: hidden;
    border-right: 1px solid #d1d9e0;
  }
  body.editor-shown #editor-pane { display: flex; flex-direction: column; }
  #editor-toolbar {
    box-sizing: border-box;
    display: flex;
    flex: 0 0 44px;
    align-items: center;
    justify-content: flex-end;
    padding: 0 10px;
    border-bottom: 1px solid #d1d9e0;
    background: #f6f8fa;
  }
  #editor-host { min-height: 0; flex: 1; overflow: hidden; }
  .cm-editor { height: 100%; }
  .cm-vim-visual-line-selected { background: #c5d9f7 !important; }
  .cm-vim-visual-mode:not(.cm-vim-visual-line) .cm-selectionBackground {
    background: #c5d9f7 !important;
  }
  .cm-vim-visual-line .cm-selectionBackground { background: transparent !important; }
  .cm-vim-visual-mode .cm-selectionMatch,
  .cm-prose-helix-mode .cm-selectionMatch { background: transparent !important; }
  .cm-prose-helix-mode .cm-hx-cursor {
    background: #1f2328 !important;
    color: #ffffff !important;
  }
  .cm-vimCursorLayer { animation: none !important; }
  .cm-vim-panel, .cm-vim-panel input { color: inherit; }
  .cm-vim-panel input { font-family: inherit; }
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
  }
  #editor-mode {
    box-sizing: border-box;
    display: inline-flex;
    gap: 2px;
    height: 28px;
    padding: 2px;
    border: 1px solid #d1d9e0;
    border-radius: 6px;
    background: #f6f8fa;
  }
  #editor-mode button {
    min-width: 38px;
    padding: 0 8px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: #59636e;
    font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    cursor: pointer;
  }
  #editor-mode button[aria-pressed="true"] {
    background: #ffffff;
    color: #1f2328;
    box-shadow: 0 1px 2px rgba(31, 35, 40, 0.12);
  }
  #editor-mode button:not([aria-pressed="true"]):hover { color: #1f2328; }
  #editor-mode button:focus-visible { outline: 2px solid #0969da; outline-offset: 1px; }
  #editor-toggle {
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
  .cm-flash { animation: flash-fade 1.8s ease-out; }
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
    width: 340px;
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
    #editor-toolbar { background: #151b23; border-bottom-color: #3d444d; }
    .cm-vim-visual-line-selected { background: #3a4f6a !important; }
    .cm-vim-visual-mode:not(.cm-vim-visual-line) .cm-selectionBackground {
      background: #3a4f6a !important;
    }
    .cm-vim-panel, .cm-vim-panel input { color: #f0f6fc; }
    .cm-prose-helix-mode .cm-hx-cursor {
      background: #f0f6fc !important;
      color: #0d1117 !important;
    }
    #editor-mode, #editor-toggle {
      background: #151b23;
      border-color: #3d444d;
      color: #9198a1;
      color-scheme: dark;
    }
    #editor-mode button { color: #9198a1; }
    #editor-mode button[aria-pressed="true"] {
      background: #2d333b;
      color: #f0f6fc;
      box-shadow: 0 1px 2px #010409;
    }
    #editor-mode button:not([aria-pressed="true"]):hover { color: #f0f6fc; }
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
<body>
<div id="layout">
  <div id="editor-pane">
    <div id="editor-toolbar">
      <div id="editor-mode" role="group" aria-label="Editor mode">
        <button type="button" data-editor-mode="regular" aria-pressed="false">Standard</button>
        <button type="button" data-editor-mode="vim" aria-pressed="false">Vim</button>
        <button type="button" data-editor-mode="helix" aria-pressed="false">Helix</button>
      </div>
    </div>
    <div id="editor-host"></div>
  </div>
  <div id="preview-pane"><article class="markdown-body" id="content"></article></div>
</div>
<button id="editor-toggle" aria-label="Toggle raw markdown editor" title="Toggle raw markdown editor (⌘E)">✎</button>
<div id="popover">
  <textarea id="comment-text" placeholder="Comment for Claude"></textarea>
  <div class="row">
    <button id="dellm" title="Rewrite the selection to sound like a person; comment text (if any) is extra guidance">de-LLM</button>
    <span class="hint">⌘⏎ to send · esc to cancel</span>
    <button id="send">Send</button>
  </div>
</div>
<div id="toast"></div>
<script id="initial-state" type="application/octet-stream">${initialState}</script>
<script type="module" src="/bundle.js"></script>
</body>
</html>`
}

// Single contiguous splice turning oldStr into newStr (common prefix/suffix
// diff) — how a file-level change gets applied to the Y.Text so it merges
// with concurrent browser edits instead of replacing the document.
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
async function buildClientBundle(): Promise<string> {
  const self = await Deno.realPath(fromFileUrl(import.meta.url))
  const binDir = dirname(self)
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

await new Command()
  .name("prose")
  .description("Serve a markdown file as a live GitHub-style preview with review comments")
  .arguments("<file:string>")
  .option("-p, --port <port:number>", "Port to listen on", { default: 4917 })
  .option("--no-open", "Don't open the browser")
  .action(async ({ port, open }, file) => {
    await Deno.stat(file) // fail fast on bad path

    const binDir = dirname(await Deno.realPath(fromFileUrl(import.meta.url)))
    const markdownCss = await Deno.readTextFile(
      join(binDir, "lib", "github-markdown.min.css"),
    )
    const bundleJs = await buildClientBundle()

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
    const syncClients = new Set<WebSocket>()
    // Lets a page that survived a server restart know it must reload instead
    // of merging its old Y.Doc with this process's fresh one.
    const sessionId = crypto.randomUUID()

    const ydoc = new Y.Doc()
    const ytext = ydoc.getText("content")
    let fileContent = await Deno.readTextFile(file)
    ydoc.transact(() => ytext.insert(0, fileContent), "file")

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

    // --- disk -> ydoc ---

    const mergeDisk = (disk: string) => {
      const current = ytext.toString()
      if (disk !== current) {
        const { start, delLen, insert } = splice(current, disk)
        ydoc.transact(() => {
          if (delLen > 0) ytext.delete(start, delLen)
          if (insert.length > 0) ytext.insert(start, insert)
        }, "file")
      }
      fileContent = disk
    }

    const onDiskChange = async () => {
      let disk: string
      try {
        disk = await Deno.readTextFile(file)
      } catch {
        return // transiently missing (rename-replace save); next event catches up
      }
      // Ignore the watcher seeing our own write: comparing against the live
      // ytext instead would splice stale disk content over keystrokes typed
      // since the write.
      if (disk === fileContent) return
      mergeDisk(disk)
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

    // --- ydoc -> disk (browser edits), debounced ---

    let writeTimer: ReturnType<typeof setTimeout> | undefined
    const writeNow = async () => {
      // Merge any disk change the watcher hasn't delivered yet so a write
      // can't clobber an edit Claude just made.
      try {
        const disk = await Deno.readTextFile(file)
        if (disk !== fileContent) mergeDisk(disk)
      } catch {
        // keep going; write below recreates the file
      }
      const current = ytext.toString()
      if (current === fileContent) return
      fileContent = current
      await Deno.writeTextFile(file, current)
    }
    const scheduleWrite = () => {
      clearTimeout(writeTimer)
      writeTimer = setTimeout(writeNow, 400)
    }

    // --- edit notices to the Claude session ---

    // Edit notices keep the session's mental model of the draft current
    // without a re-read, but the session only needs them when it's about to
    // act — so they never wake it on their own. Changes accumulate in a
    // window that flushes right before the next comment. GUI edits are the
    // user's ("user-edit"); disk changes ("file-edit") are the user saving
    // from an external editor OR Claude's own edits echoed back — the
    // session filters the latter by recognizing its own text. When both
    // sources land in one window the diff can't be attributed, so send a
    // coarse notice instead.
    let lastKnown = fileContent
    let windowBase: string | null = null
    const windowSources = new Set<"browser" | "file">()

    const flushUserEdit = () => {
      if (windowBase === null) return
      const current = ytext.toString()
      const base = windowBase
      windowBase = null
      const mixed = windowSources.size > 1
      const kind = windowSources.has("browser") ? "user-edit" : "file-edit"
      windowSources.clear()
      const event: Record<string, unknown> = {
        kind,
        file,
        ts: new Date().toISOString(),
      }
      if (mixed) {
        event.note =
          "user edited the draft in the GUI (interleaved with file edits); re-read the file before editing"
      } else {
        // A window that nets out to nothing (typed then undone) isn't worth
        // waking the session for.
        if (base === current) return
        const { start, delLen, insert } = splice(base, current)
        event.old = base.slice(start, start + delLen).slice(0, 2000)
        event.new = insert.slice(0, 2000)
      }
      logEvent(event)
    }

    ytext.observe((_event, txn) => {
      if (windowBase === null) windowBase = lastKnown
      windowSources.add(txn.origin === "file" ? "file" : "browser")
      lastKnown = ytext.toString()
    })

    ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      for (const ws of syncClients) {
        if (ws !== origin && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(update)
          } catch {
            syncClients.delete(ws)
          }
        }
      }
      if (origin !== "file") scheduleWrite()
    })

    Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
      const { pathname } = new URL(req.url)
      if (pathname === "/") {
        const initialState = Y.encodeStateAsUpdate(ydoc).toBase64()
        return new Response(page(basename(file), initialState), {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      }
      if (pathname === "/bundle.js") {
        return new Response(bundleJs, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        })
      }
      if (pathname === "/github-markdown.css") {
        return new Response(markdownCss, {
          headers: { "content-type": "text/css; charset=utf-8" },
        })
      }
      // Browser editing pane syncs the Y.Doc here (binary yjs updates both ways).
      if (pathname === "/sync") {
        const { socket, response } = Deno.upgradeWebSocket(req)
        socket.binaryType = "arraybuffer"
        // Updates are ignored until the client echoes this session's id back:
        // a page from a previous server process holds an unrelated Y.Doc whose
        // state must reload, not merge (it would duplicate the document).
        let verified = false
        socket.onopen = () => {
          socket.send(JSON.stringify({ type: "hello", session: sessionId }))
        }
        socket.onmessage = (e) => {
          if (typeof e.data === "string") {
            const msg = JSON.parse(e.data)
            if (msg.type === "hello" && msg.session === sessionId && !verified) {
              verified = true
              syncClients.add(socket)
              socket.send(Y.encodeStateAsUpdate(ydoc))
            }
            return
          }
          if (!verified) return
          Y.applyUpdate(ydoc, new Uint8Array(e.data as ArrayBuffer), socket)
        }
        socket.onclose = () => syncClients.delete(socket)
        socket.onerror = () => syncClients.delete(socket)
        return response
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
        // A pending user-edit notice should reach the session before the
        // comment that may refer to the edited text.
        flushUserEdit()
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
