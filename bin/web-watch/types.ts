/**
 * A single thing surfaced by a watcher. `id` must be stable across runs so the
 * diff stage can tell new items from already-seen ones.
 */
export interface Item {
  /** Stable identifier, unique within a watcher. */
  id: string
  /** One-line summary, used for notification titles. */
  title: string
  /** Fuller content handed to the LLM relevance/summarize stage. */
  body?: string
  /** Link back to the source item, if there is one. */
  url?: string
}

/**
 * A source to watch. For now a watcher only knows how to fetch its current
 * items; diffing, relevance gating, and notification live in the harness.
 * Per-source properties (poll cadence, relevance gate, interest profile) will
 * be added here as later stages are built.
 */
export interface Watcher {
  /** Unique, stable name; also keys this watcher's persisted state. */
  name: string
  /** Return the current set of items at the source. */
  fetch(): Promise<Item[]>
}
