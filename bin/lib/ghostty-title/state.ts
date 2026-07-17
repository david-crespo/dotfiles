// Atomic persistent state for sessions, terminal mappings, and summaries.
import { join } from "@std/path"

export interface SessionState {
  terminalId: string
  label: string
  cwd?: string
  state?: string
  promptSequence: number
  version: number
  /** Read-only compatibility with the pre-sequencing state format. */
  summary?: string
}

export interface TerminalMetadata {
  lastTabId?: string
  shellLabel?: string
  version: number
}

export interface StatePaths {
  root: string
  sessions: string
  terminalSessions: string
  summaries: string
  terminalMetadata: string
}

export function statePaths(root: string): StatePaths {
  return {
    root,
    sessions: join(root, "sessions"),
    // Retained for migration compatibility. This is a latest-visible-session
    // index, not an indication that an agent process is still running.
    terminalSessions: join(root, "terminal-sessions"),
    summaries: join(root, "summaries"),
    terminalMetadata: join(root, "terminal-metadata"),
  }
}

export class StateStore {
  private ensured = false

  constructor(readonly paths: StatePaths) {}

  async ensure(): Promise<void> {
    if (this.ensured) return
    await Promise.all([
      Deno.mkdir(this.paths.sessions, { recursive: true }),
      Deno.mkdir(this.paths.terminalSessions, { recursive: true }),
      Deno.mkdir(this.paths.summaries, { recursive: true }),
      Deno.mkdir(this.paths.terminalMetadata, { recursive: true }),
    ])
    await this.sweepStale()
    this.ensured = true
  }

  async sweepStale(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = Date.now() - maxAgeMs
    await Promise.all([
      sweepDirectory(this.paths.sessions, cutoff),
      sweepDirectory(this.paths.terminalSessions, cutoff),
      sweepDirectory(this.paths.summaries, cutoff, true),
      sweepDirectory(this.paths.terminalMetadata, cutoff),
    ])
  }

  async readSession(sessionId: string): Promise<SessionState | undefined> {
    const state = await readJson<SessionState>(join(this.paths.sessions, sessionId))
    return state
      ? {
        ...state,
        promptSequence: state.promptSequence ?? 0,
        version: state.version ?? 0,
      }
      : undefined
  }

  async writeSession(sessionId: string, state: SessionState): Promise<void> {
    await atomicWrite(join(this.paths.sessions, sessionId), JSON.stringify(state))
  }

  async updateSession(
    sessionId: string,
    update: (current: SessionState) => SessionState,
  ): Promise<SessionState | undefined> {
    const current = await this.readSession(sessionId)
    if (!current) return undefined
    const next = update(current)
    await this.writeSession(sessionId, { ...next, version: current.version + 1 })
    return { ...next, version: current.version + 1 }
  }

  async claim(terminalId: string, sessionId: string): Promise<void> {
    await atomicWrite(join(this.paths.terminalSessions, terminalId), `${sessionId}\n`)
  }

  async release(terminalId: string, sessionId?: string): Promise<boolean> {
    const path = join(this.paths.terminalSessions, terminalId)
    if (sessionId && (await this.sessionForTerminal(terminalId)) !== sessionId) return false
    return await Deno.remove(path).then(() => true).catch(() => false)
  }

  async sessionForTerminal(terminalId: string): Promise<string | undefined> {
    const path = join(this.paths.terminalSessions, terminalId)
    const sessionId = await Deno.readTextFile(path).then((s) => s.trim()).catch(() => "")
    if (!sessionId || !(await this.readSession(sessionId))) {
      await Deno.remove(path).catch(() => {})
      return undefined
    }
    return sessionId
  }

  async readMetadata(terminalId: string): Promise<TerminalMetadata> {
    return (await readJson<TerminalMetadata>(
      join(this.paths.terminalMetadata, terminalId),
    )) ?? { version: 0 }
  }

  async writeMetadata(
    terminalId: string,
    patch: Partial<Omit<TerminalMetadata, "version">>,
  ): Promise<TerminalMetadata> {
    const current = await this.readMetadata(terminalId)
    const next = { ...current, ...patch, version: current.version + 1 }
    await atomicWrite(join(this.paths.terminalMetadata, terminalId), JSON.stringify(next))
    return next
  }

  async writeSummary(sessionId: string, sequence: number, summary: string): Promise<void> {
    const dir = join(this.paths.summaries, sessionId)
    await Deno.mkdir(dir, { recursive: true })
    const path = join(dir, String(sequence))
    await Deno.writeTextFile(path, summary, { createNew: true }).catch((error) => {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error
    })
  }

  async readSummary(sessionId: string, sequence: number): Promise<string | undefined> {
    const value = await Deno.readTextFile(
      join(this.paths.summaries, sessionId, String(sequence)),
    ).catch(() => "")
    if (value) return value
    if (sequence === 0) return (await this.readSession(sessionId))?.summary
    return undefined
  }

  async latestSummary(
    sessionId: string,
    beforeSequence = Number.POSITIVE_INFINITY,
  ): Promise<string | undefined> {
    const dir = join(this.paths.summaries, sessionId)
    const entries = await Array.fromAsync(Deno.readDir(dir)).catch(() =>
      [] as Deno.DirEntry[]
    )
    const sequence = entries
      .filter((entry) => entry.isFile)
      .map((entry) => Number(entry.name))
      .filter((value) => Number.isInteger(value) && value < beforeSequence)
      .toSorted((a, b) => b - a)[0]
    if (sequence !== undefined) return await this.readSummary(sessionId, sequence)
    return beforeSequence > 0 ? (await this.readSession(sessionId))?.summary : undefined
  }

  async versionToken(terminalIds: string[]): Promise<string> {
    const tokens = await Promise.all(terminalIds.map(async (terminalId) => {
      const metadata = await this.readMetadata(terminalId)
      const sessionId = await this.sessionForTerminal(terminalId)
      if (!sessionId) {
        return `${terminalId}:_:${metadata.version}:${metadata.shellLabel ?? ""}`
      }
      const session = await this.readSession(sessionId)
      if (!session) {
        return `${terminalId}:_:${metadata.version}:${metadata.shellLabel ?? ""}`
      }
      const summary = await this.readSummary(sessionId, session.promptSequence)
      return `${terminalId}:${sessionId}:${session.version}:${
        summary ?? ""
      }:${metadata.version}:${metadata.shellLabel ?? ""}`
    }))
    return tokens.join("|")
  }

  async listSessions(): Promise<Array<{ id: string; state: SessionState; mtime: Date }>> {
    const entries = await Array.fromAsync(Deno.readDir(this.paths.sessions)).catch(
      () => [] as Deno.DirEntry[],
    )
    return (await Promise.all(
      entries.filter((entry) => entry.isFile).map(async (entry) => {
        const path = join(this.paths.sessions, entry.name)
        const [state, stat] = await Promise.all([
          this.readSession(entry.name),
          Deno.stat(path).catch(() => undefined),
        ])
        return state && stat?.mtime
          ? { id: entry.name, state, mtime: stat.mtime }
          : undefined
      }),
    )).filter((entry) => entry !== undefined)
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const raw = await Deno.readTextFile(path).catch(() => "")
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.tmp-${Deno.pid}-${crypto.randomUUID()}`
  await Deno.writeTextFile(temporary, contents, { createNew: true })
  try {
    await Deno.rename(temporary, path)
  } catch (error) {
    await Deno.remove(temporary).catch(() => {})
    throw error
  }
}

async function sweepDirectory(
  directory: string,
  cutoff: number,
  recursive = false,
): Promise<void> {
  const entries = await Array.fromAsync(Deno.readDir(directory)).catch(
    () => [] as Deno.DirEntry[],
  )
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile && !(recursive && entry.isDirectory)) return
    const path = join(directory, entry.name)
    const stat = await Deno.stat(path).catch(() => undefined)
    if (stat?.mtime && stat.mtime.getTime() < cutoff) {
      await Deno.remove(path, { recursive: entry.isDirectory }).catch(() => {})
    }
  }))
}
