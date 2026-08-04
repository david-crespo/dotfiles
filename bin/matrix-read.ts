#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read --allow-write

// Read-only Matrix CLI. The homeserver defaults to matrix.oxide.computer;
// set MATRIX_HOMESERVER (base URL) to override. The access token comes from
// MATRIX_TOKEN if set, otherwise from the state file that `matrix-read login`
// writes. Login opts in to refresh tokens (MSC2918) and discards the refresh
// token, so the server expires the access token after its configured lifetime
// (Synapse default: 5 minutes) and nothing can renew it. If
// MATRIX_ALLOWED_ROOMS is set (comma-separated room IDs), only those rooms
// are listed and readable.
//
//   matrix-read login <user>                mint a short-lived access token (prompts for password)
//   matrix-read logout                      revoke the stored token before it expires
//   matrix-read rooms                       list joined unencrypted rooms (name + ID)
//   matrix-read messages <room> [options]   print message history, oldest first
//
// <room> is a room ID (!abc:server), alias (#eng:server), or a case-insensitive
// substring of a room name.
//
//   --since <date>   messages after this date (e.g. 2026-07-20)
//   --limit <n>      max messages when --since is not given (default 100)
//   --json           print raw events as JSON

import { Command } from "@cliffy/command"
import { Secret } from "@cliffy/prompt"
import { dirname } from "@std/path"

const API_PREFIX = "/_matrix/client/v3"

// base_url from https://oxide.computer/.well-known/matrix/client
const HOMESERVER = Deno.env.get("MATRIX_HOMESERVER") ?? "https://matrix.oxide.computer"

// Reusing a fixed device ID means each login invalidates the previous token
// and Element's session list only ever shows one matrix-read device.
const DEVICE_ID = "matrix-read"

function tokenFile(): string {
  const state = Deno.env.get("XDG_STATE_HOME") ?? `${Deno.env.get("HOME")}/.local/state`
  return `${state}/matrix-read/token.json`
}

interface StoredToken {
  access_token: string
  user_id: string
  expires_at?: number // ms epoch; absent if the server did not return an expiry
}

function readStoredToken(): StoredToken | null {
  try {
    return JSON.parse(Deno.readTextFileSync(tokenFile()))
  } catch {
    return null
  }
}

let cachedToken: string | undefined

function token(): string {
  if (cachedToken) return cachedToken
  const fromEnv = Deno.env.get("MATRIX_TOKEN")
  if (fromEnv) return (cachedToken = fromEnv)
  const stored = readStoredToken()
  if (!stored) {
    console.error("No access token: run 'matrix-read login <user>', or set MATRIX_TOKEN")
    Deno.exit(1)
  }
  if (stored.expires_at !== undefined && Date.now() >= stored.expires_at) {
    try {
      Deno.removeSync(tokenFile())
    } catch {
      // already gone
    }
    console.error("Stored token has expired; run 'matrix-read login <user>'")
    Deno.exit(1)
  }
  return (cachedToken = stored.access_token)
}

async function api<T>(
  path: string,
  params: Record<string, string> = {},
  opts: { ok404?: boolean } = {},
): Promise<T | null> {
  const url = new URL(API_PREFIX + path, HOMESERVER)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}` },
  }).catch((err) => {
    console.error(`Request to ${url.host} failed: ${err.message}`)
    return Deno.exit(1)
  })
  if (response.status === 404 && opts.ok404) {
    await response.body?.cancel()
    return null
  }
  if (!response.ok) {
    const body = await response.text()
    let msg = body
    try {
      const err = JSON.parse(body)
      msg = `${err.errcode}: ${err.error}`
    } catch {
      // leave raw body
    }
    console.error(
      `Matrix API failed (${response.status} on ${path}): ${
        sanitizeTerminalText(msg, true)
      }`,
    )
    Deno.exit(1)
  }
  return await response.json()
}

function allowedRooms(): string[] | null {
  const raw = Deno.env.get("MATRIX_ALLOWED_ROOMS")
  if (!raw) return null
  return raw.split(",").map((r) => r.trim()).filter(Boolean)
}

interface Room {
  id: string
  name: string | null
}

// Encrypted rooms (all DMs plus some named rooms) are excluded: this client
// has no E2EE keys, so their message history is unreadable ciphertext.
async function joinedRooms(): Promise<Room[]> {
  const res = await api<{ joined_rooms: string[] }>("/joined_rooms")
  let ids = res!.joined_rooms
  const allowed = allowedRooms()
  if (allowed) ids = ids.filter((id) => allowed.includes(id))
  const rooms = await Promise.all(ids.map(async (id) => {
    const encoded = encodeURIComponent(id)
    const [name, encryption] = await Promise.all([
      api<{ name?: string }>(`/rooms/${encoded}/state/m.room.name`, {}, { ok404: true }),
      api<object>(`/rooms/${encoded}/state/m.room.encryption`, {}, { ok404: true }),
    ])
    return { id, name: name?.name ?? null, encrypted: encryption !== null }
  }))
  return rooms.filter((r) => !r.encrypted)
}

function checkAllowed(id: string) {
  const allowed = allowedRooms()
  if (allowed && !allowed.includes(id)) {
    console.error(`Room ${id} is not in MATRIX_ALLOWED_ROOMS`)
    Deno.exit(1)
  }
}

async function checkUnencrypted(id: string) {
  const encryption = await api<object>(
    `/rooms/${encodeURIComponent(id)}/state/m.room.encryption`,
    {},
    { ok404: true },
  )
  if (encryption !== null) {
    console.error(`Room ${id} is encrypted; this client cannot read its messages`)
    Deno.exit(1)
  }
}

async function resolveRoom(arg: string): Promise<string> {
  if (arg.startsWith("!")) {
    checkAllowed(arg)
    await checkUnencrypted(arg)
    return arg
  }
  if (arg.startsWith("#")) {
    const res = await api<{ room_id: string }>(
      `/directory/room/${encodeURIComponent(arg)}`,
    )
    checkAllowed(res!.room_id)
    await checkUnencrypted(res!.room_id)
    return res!.room_id
  }
  const rooms = await joinedRooms()
  const matches = rooms.filter((r) => r.name?.toLowerCase().includes(arg.toLowerCase()))
  if (matches.length === 1) return matches[0].id
  if (matches.length === 0) {
    console.error(`No joined room name matches '${arg}'`)
  } else {
    console.error(`Multiple rooms match '${arg}':`)
    for (const r of matches) {
      console.error(`  ${sanitizeTerminalText(r.name ?? "(unnamed)")}  ${r.id}`)
    }
  }
  Deno.exit(1)
}

async function runRooms() {
  const rooms = await joinedRooms()
  rooms.sort((a, b) => (a.name ?? "~").localeCompare(b.name ?? "~"))
  const names = rooms.map((r) => sanitizeTerminalText(r.name ?? "(unnamed)"))
  const width = Math.max(...names.map((name) => name.length))
  for (const r of rooms) {
    const name = sanitizeTerminalText(r.name ?? "(unnamed)")
    console.log(`${name.padEnd(width)}  ${r.id}`)
  }
}

interface MessageEvent {
  type: string
  sender: string
  origin_server_ts: number
  content: { msgtype?: string; body?: string }
}

interface MessagesResponse {
  chunk: MessageEvent[]
  end?: string
}

const PAGE_SIZE = 100
const MAX_PAGES = 200

async function fetchMessages(
  roomId: string,
  since: number | null,
  limit: number,
): Promise<MessageEvent[]> {
  const events: MessageEvent[] = []
  let from: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (await api<MessagesResponse>(
      `/rooms/${encodeURIComponent(roomId)}/messages`,
      {
        dir: "b",
        limit: String(PAGE_SIZE),
        filter: JSON.stringify({ types: ["m.room.message"] }),
        ...(from && { from }),
      },
    ))!
    for (const ev of res.chunk) {
      if (since !== null && ev.origin_server_ts < since) return events
      events.push(ev)
      if (since === null && events.length >= limit) return events
    }
    // no end token means the server reached the start of the room's history
    if (!res.end) return events
    from = res.end
  }
  console.error(`Stopped after ${MAX_PAGES * PAGE_SIZE} messages; narrow --since`)
  return events
}

// "sv" locale formats dates as ISO-like YYYY-MM-DD in local time
function localDate(ts: number): string {
  return new Date(ts).toLocaleDateString("sv")
}

function localTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false }).slice(0, 5)
}

function parseSinceDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const [year, month, day] = match.slice(1).map(Number)
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) return null
  return parsed.getTime()
}

function sanitizeTerminalText(value: string, multiline = false): string {
  const sanitized = [...value].filter((char) => {
    const code = char.charCodeAt(0)
    return code === 0x0a || (code > 0x1f && (code < 0x7f || code > 0x9f))
  }).join("")
  return multiline ? sanitized : sanitized.replaceAll("\n", " ")
}

function safeJsonStringify(value: object): string {
  return [...JSON.stringify(value, null, 2)].map((char) => {
    const code = char.charCodeAt(0)
    return code >= 0x7f && code <= 0x9f ? `\\u${code.toString(16).padStart(4, "0")}` : char
  }).join("")
}

function renderBody(ev: MessageEvent): string | null {
  const { msgtype, body } = ev.content
  if (body === undefined) return null // redacted
  switch (msgtype) {
    case "m.emote":
      return `* ${sanitizeTerminalText(body, true)}`
    case "m.image":
    case "m.file":
    case "m.video":
    case "m.audio":
      return `[${msgtype.slice(2)}: ${sanitizeTerminalText(body, true)}]`
    default:
      return sanitizeTerminalText(body, true)
  }
}

async function runMessages(
  room: string,
  opts: { since?: string; limit: number; json?: boolean },
) {
  let since: number | null = null
  if (opts.since) {
    since = parseSinceDate(opts.since)
    if (since === null) {
      console.error(`Cannot parse date '${opts.since}'`)
      Deno.exit(1)
    }
  }
  const roomId = await resolveRoom(room)
  const events = await fetchMessages(roomId, since, opts.limit)
  events.reverse() // fetched newest-first; print oldest-first
  if (opts.json) {
    console.log(safeJsonStringify(events))
    return
  }
  let day: string | null = null
  for (const ev of events) {
    const body = renderBody(ev)
    if (body === null) continue
    const evDay = localDate(ev.origin_server_ts)
    if (evDay !== day) {
      day = evDay
      console.log(`\n### ${day}\n`)
    }
    const sender = sanitizeTerminalText(
      ev.sender.replace(/^@/, "").replace(/:.*$/, ""),
    )
    const indented = body.split("\n").join("\n    ")
    console.log(`[${localTime(ev.origin_server_ts)}] ${sender}: ${indented}`)
  }
}

async function runLogin(user: string) {
  const password = await Secret.prompt({ message: `Password for ${user}` })
  const url = new URL(API_PREFIX + "/login", HOMESERVER)
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user },
      password,
      device_id: DEVICE_ID,
      initial_device_display_name: "matrix-read",
      // ask for a server-expiring access token; we discard the refresh token
      // the server sends back, so the token dies for good at expiry
      refresh_token: true,
    }),
  })
  const body = await response.json()
  if (!response.ok) {
    console.error(`Login failed (${response.status}): ${body.errcode}: ${body.error}`)
    Deno.exit(1)
  }
  const stored: StoredToken = {
    access_token: body.access_token,
    user_id: body.user_id,
  }
  let expiryNote =
    "WARNING: no expiry returned; the server has refresh-token TTLs disabled, so this token lives until logout"
  if (body.expires_in_ms !== undefined) {
    stored.expires_at = Date.now() + body.expires_in_ms
    expiryNote = `token expires in ${Math.round(body.expires_in_ms / 60_000)} minutes`
  }
  await Deno.mkdir(dirname(tokenFile()), { recursive: true })
  await Deno.writeTextFile(tokenFile(), JSON.stringify(stored) + "\n", { mode: 0o600 })
  console.error(`Logged in as ${body.user_id}; ${expiryNote}.`)
}

async function runLogout() {
  const stored = readStoredToken()
  if (!stored) {
    console.error("No stored token")
    return
  }
  const url = new URL(API_PREFIX + "/logout", HOMESERVER)
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${stored.access_token}` },
  })
  // 401 means the token already expired or was invalidated
  if (!response.ok && response.status !== 401) {
    const body = await response.text()
    console.error(`Logout failed (${response.status}): ${sanitizeTerminalText(body)}`)
    Deno.exit(1)
  }
  await Deno.remove(tokenFile())
  console.error(response.ok ? "Token revoked." : "Token was already invalid; removed.")
}

const login = new Command()
  .description("Mint a short-lived access token; prompts for the account password")
  .arguments("<user:string>")
  .action((_, user) => runLogin(user))

const logout = new Command()
  .description("Revoke the stored token before it expires")
  .action(runLogout)

const rooms = new Command()
  .description(
    "List joined unencrypted rooms (name + ID); encrypted rooms are unreadable and hidden",
  )
  .action(runRooms)

const messages = new Command()
  .description("Print a room's message history, oldest first")
  .arguments("<room:string>")
  .option("--since <date:string>", "Messages after this date (e.g. 2026-07-20)")
  .option("--limit <n:number>", "Max messages when --since is not given", {
    default: 100,
  })
  .option("--json", "Print raw events as JSON")
  .action((options, room) => runMessages(room, options))

await new Command()
  .name("matrix-read")
  .description("Read-only Matrix client: list rooms and read message history")
  .action(function () {
    this.showHelp()
  })
  .command("login", login)
  .command("logout", logout)
  .command("rooms", rooms)
  .command("messages", messages)
  .parse(Deno.args)
