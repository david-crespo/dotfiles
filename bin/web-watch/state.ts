import { ensureDir } from "@std/fs"
import { join } from "@std/path"

/**
 * Where per-watcher seen-ID state lives. This is regenerable cache, never
 * versioned — losing it just means the next run re-seeds a baseline.
 */
export function stateDir(): string {
  const base = Deno.env.get("XDG_STATE_HOME") ??
    join(Deno.env.get("HOME")!, ".local", "state")
  return join(base, "web-watch")
}

const stateFile = (name: string) => join(stateDir(), `${name}.json`)

interface StateFile {
  seen: string[]
}

/**
 * The set of item IDs already seen for a watcher, or null if it has no state
 * yet. null means first run: the caller should seed a baseline rather than
 * treat every current item as new.
 */
export async function loadSeen(name: string): Promise<Set<string> | null> {
  try {
    const data = JSON.parse(await Deno.readTextFile(stateFile(name))) as StateFile
    return new Set(data.seen)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null
    throw err
  }
}

/** Persist the set of seen item IDs for a watcher. */
export async function saveSeen(name: string, ids: Iterable<string>): Promise<void> {
  await ensureDir(stateDir())
  const data: StateFile = { seen: [...ids].sort() }
  await Deno.writeTextFile(stateFile(name), JSON.stringify(data, null, 2) + "\n")
}
