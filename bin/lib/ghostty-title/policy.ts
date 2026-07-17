import type { GhosttyRouting, TabSnapshot } from "./routing.ts"
import type { StateStore } from "./state.ts"

export interface RenderedTab {
  title?: string
  versionToken: string
}

export function formatActivity(state?: string, summary?: string): string | undefined {
  const activity = [state, summary].filter(Boolean).join(" ")
  return activity || undefined
}

export async function buildTabTitle(
  store: StateStore,
  terminalIds: string[],
  fallbackLabel?: string,
): Promise<RenderedTab> {
  const entries = (await Promise.all(terminalIds.map(async (terminalId) => {
    const sessionId = await store.sessionForTerminal(terminalId)
    if (!sessionId) return undefined
    const session = await store.readSession(sessionId)
    if (!session || session.terminalId !== terminalId) return undefined
    const summary = await store.readSummary(sessionId, session.promptSequence)
    return { label: session.label, activity: formatActivity(session.state, summary) }
  }))).filter((entry) => entry !== undefined)
  const components = entries.flatMap((entry, index) => [
    ...(index === 0 || entries[index - 1].label !== entry.label ? [entry.label] : []),
    ...(entry.activity ? [entry.activity] : []),
  ])
  const title = components.join(" | ") || fallbackLabel
  return { title, versionToken: await store.versionToken(terminalIds) }
}

export class TabRenderer {
  constructor(
    private readonly store: StateStore,
    private readonly routing: GhosttyRouting,
    private readonly retryLimit = 3,
  ) {}

  async renderForTerminal(terminalId: string, fallbackLabel?: string): Promise<void> {
    const previousTabId = (await this.store.readMetadata(terminalId)).lastTabId
    const current = await this.routing.snapshotForTerminal(terminalId)

    if (previousTabId && previousTabId !== current?.tabId) {
      await this.renderTab(previousTabId)
    }
    if (!current) return
    await this.renderSnapshot(current, fallbackLabel)
    await this.store.writeMetadata(terminalId, { lastTabId: current.tabId })
  }

  async renderTab(tabId: string, fallbackLabel?: string): Promise<void> {
    const snapshot = await this.routing.snapshotForTab(tabId)
    if (snapshot) await this.renderSnapshot(snapshot, fallbackLabel)
  }

  private async renderSnapshot(
    initial: TabSnapshot,
    fallbackLabel?: string,
  ): Promise<void> {
    let snapshot: TabSnapshot | undefined = initial
    for (let attempt = 0; snapshot && attempt < this.retryLimit; attempt++) {
      const shellFallback = fallbackLabel ?? await this.shellFallback(snapshot.terminalIds)
      const rendered = await buildTabTitle(this.store, snapshot.terminalIds, shellFallback)
      if (!rendered.title) return
      const result = await this.routing.setTitle(snapshot, rendered.title)
      const latest = await this.routing.snapshotForTab(snapshot.tabId)
      if (result === "set" && latest) {
        const latestToken = await this.store.versionToken(latest.terminalIds)
        if (
          latestToken === rendered.versionToken &&
          arraysEqual(latest.terminalIds, snapshot.terminalIds)
        ) return
      }
      snapshot = latest
    }
  }

  private async shellFallback(terminalIds: string[]): Promise<string | undefined> {
    for (const terminalId of terminalIds) {
      const label = (await this.store.readMetadata(terminalId)).shellLabel
      if (label) return label
    }
    return undefined
  }
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}
