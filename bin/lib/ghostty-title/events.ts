import { join } from "@std/path"

const STATE_ROOT = join(
  Deno.env.get("XDG_STATE_HOME") ?? join(Deno.env.get("HOME")!, ".local", "state"),
  "ghostty-tab-titles",
)
const LOG_PATH = join(STATE_ROOT, "events.jsonl")

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function logEvent(
  event: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    pid: Deno.pid,
    event,
    ...details,
  })
  await Deno.mkdir(STATE_ROOT, { recursive: true }).catch(() => {})
  await Deno.writeTextFile(LOG_PATH, `${entry}\n`, { append: true }).catch(() => {})
}
