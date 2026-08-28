// Prototype: real Helix editing a markdown file in a browser, with a live
// rendered preview beside it. Spawns `hx` in a pty and bridges it to xterm.js
// over a websocket; a second websocket pushes the file's contents to the
// preview pane whenever it changes on disk (helix auto-save handles the
// editor -> disk half, see hx-config.toml).
//
// Usage: node server.mjs [file.md] [port]
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pty from "node-pty"
import { WebSocketServer } from "ws"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(args(1) ?? path.join(__dirname, "draft.md"))
const PORT = Number(args(2) ?? 4923)
const CONFIG = path.join(__dirname, "hx-config.toml")
const HX = process.env.HX ?? "hx"

function args(n) {
  return process.argv[n + 1]
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)
  if (pathname === "/") {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(fs.readFileSync(path.join(__dirname, "index.html")))
  } else {
    res.writeHead(404)
    res.end()
  }
})

const ptyWss = new WebSocketServer({ noServer: true })
const previewWss = new WebSocketServer({ noServer: true })
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)
  const wss =
    pathname === "/pty" ? ptyWss : pathname === "/preview" ? previewWss : null
  if (!wss) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
})

ptyWss.on("connection", (ws) => {
  const proc = pty.spawn(HX, ["--config", CONFIG, FILE], {
    name: "xterm-256color",
    cols: 100,
    rows: 32,
    cwd: path.dirname(FILE),
    env: { ...process.env, COLORTERM: "truecolor" },
  })
  console.log(`[pty] spawned hx pid=${proc.pid}`)
  proc.onData((data) => ws.send(data))
  proc.onExit(({ exitCode }) => {
    console.log(`[pty] hx exited ${exitCode}`)
    ws.close()
  })
  ws.on("message", (msg) => {
    const s = msg.toString()
    if (s.startsWith("\x00resize:")) {
      const [cols, rows] = s.slice(8).split("x").map(Number)
      proc.resize(cols, rows)
    } else {
      proc.write(s)
    }
  })
  ws.on("close", () => proc.kill())
})

previewWss.on("connection", (ws) => ws.send(fs.readFileSync(FILE, "utf8")))
fs.watchFile(FILE, { interval: 200 }, () => {
  const text = fs.readFileSync(FILE, "utf8")
  console.log(`[file] changed — ${text.length} chars`)
  for (const client of previewWss.clients) client.send(text)
})

server.listen(PORT, () =>
  console.log(`editing ${FILE} at http://localhost:${PORT}`),
)
