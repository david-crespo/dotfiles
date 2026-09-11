// Delivery of prose events into the Claude Code session that launched the
// server. Every session binds a cross-session messaging inbox socket (a Unix
// domain socket) and exports its path to child processes as
// CLAUDE_CODE_MESSAGING_SOCKET, so a server started from the session's Bash
// tool knows where to post without any discovery or arming step. Writing one
// JSON line to the socket wakes an idle session or is read between tool
// calls in a busy one. Docs: code.claude.com/docs/en/cross-session-messaging
// ("The session's inbox socket").

import $ from "@david/dax"
import { basename, join } from "@std/path"

export type Session = {
  socket: string
  // Exported alongside the socket; sending it as an auth line lets the
  // session verify the post came from its own child even after process
  // evidence is gone. Only meaningful for the socket from the environment.
  token?: string
}

export function resolveSession(flag?: string): Session | null {
  const envSocket = Deno.env.get("CLAUDE_CODE_MESSAGING_SOCKET")
  const socket = flag ?? envSocket
  if (!socket) return null
  const token = socket === envSocket
    ? Deno.env.get("CLAUDE_CODE_MESSAGING_TOKEN")
    : undefined
  return { socket, token }
}

// A session's registry entry, ~/.claude/sessions/<pid>.json, exists only
// while it runs; the socket file itself can outlive the process. Sync so the
// feed snapshot can include it without plumbing promises through.
export function sessionAlive(session: Session | null): boolean {
  if (!session) return false
  const pid = basename(session.socket).match(/^(\d+)\.sock$/)?.[1]
  const probe = pid
    ? join(Deno.env.get("HOME")!, ".claude", "sessions", `${pid}.json`)
    : session.socket
  try {
    Deno.statSync(probe)
    return true
  } catch {
    return false
  }
}

export async function postToSession(session: Session, text: string): Promise<void> {
  const lines = []
  if (session.token) lines.push(JSON.stringify({ type: "auth", token: session.token }))
  lines.push(JSON.stringify({ type: "user", message: { role: "user", content: text } }))
  // nc rather than Deno.connect: Deno gates Unix sockets behind --allow-net
  // with the exact path, which varies per session pid. Open only once the
  // message is ready: the session drops connections that go 30s without a
  // complete line. macOS nc has no shutdown-on-EOF flag and blocks until the
  // peer closes; the session closes right after reading the line, but -w
  // bounds the wait in case it ever doesn't, since delivery holds up the
  // comment POST.
  await $`nc -w 2 -U ${session.socket}`.stdinText(lines.join("\n") + "\n")
}

// The harness frames anything arriving on the socket as a message from
// another Claude session. The header is deliberately one line: the prose
// skill explains what these events are and how to reply, so repeating that
// on every delivery only pads the transcript.
export function formatForSession(file: string, port: number, events: string[]): string {
  return [`Prose event for ${file} (port ${port}; handle per /prose skill):`, ...events].join("\n")
}
