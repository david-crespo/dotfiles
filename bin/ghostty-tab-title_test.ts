import { buildSummaryPayload, readUserMessages } from "./ghostty-tab-title.ts"
import { buildTabTitle, formatActivity, TabRenderer } from "./lib/ghostty-title/policy.ts"
import type {
  GhosttyRouting,
  TabSnapshot,
  TitleWriteResult,
} from "./lib/ghostty-title/routing.ts"
import { statePaths, StateStore } from "./lib/ghostty-title/state.ts"

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`)
  }
}

async function withTranscript(lines: unknown[], fn: (path: string) => Promise<void>) {
  const path = await Deno.makeTempFile({ suffix: ".jsonl" })
  try {
    await Deno.writeTextFile(path, lines.map((line) => JSON.stringify(line)).join("\n"))
    await fn(path)
  } finally {
    await Deno.remove(path)
  }
}

Deno.test("reads Claude user messages", async () => {
  await withTranscript([
    { type: "system", message: { content: "ignore" } },
    { type: "user", message: { content: "Implement Ghostty titles for Codex" } },
  ], async (path) => {
    assertEquals(await readUserMessages(path), ["Implement Ghostty titles for Codex"])
  })
})

Deno.test("reads Codex user response items without event duplicates", async () => {
  await withTranscript([
    { type: "session_meta", payload: {} },
    { type: "event_msg", payload: { type: "user_message", message: "duplicate" } },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Implement Ghostty titles for Codex" }],
      },
    },
  ], async (path) => {
    assertEquals(await readUserMessages(path), ["Implement Ghostty titles for Codex"])
  })
})

Deno.test("includes a Codex hook prompt not yet present in the transcript", async () => {
  await withTranscript([{
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Implement Ghostty titles for Codex" }],
    },
  }], async (path) => {
    assertEquals(
      await buildSummaryPayload(
        path,
        "Ghostty titles",
        "Verify resume and split-pane behavior in the Codex CLI",
      ),
      {
        priorSummary: "Ghostty titles",
        firstMessage: "Implement Ghostty titles for Codex",
        recentMessages: [
          "Implement Ghostty titles for Codex",
          "Verify resume and split-pane behavior in the Codex CLI",
        ],
      },
    )
  })
})

async function withStore(fn: (store: StateStore) => Promise<void>) {
  const root = await Deno.makeTempDir()
  try {
    const store = new StateStore(statePaths(root))
    await store.ensure()
    await fn(store)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

async function addSession(
  store: StateStore,
  sessionId: string,
  terminalId: string,
  label: string,
  options: { state?: string; sequence?: number; summary?: string } = {},
) {
  const sequence = options.sequence ?? 0
  await store.writeSession(sessionId, {
    terminalId,
    label,
    state: options.state,
    promptSequence: sequence,
    version: 1,
  })
  await store.claim(terminalId, sessionId)
  if (options.summary) await store.writeSummary(sessionId, sequence, options.summary)
}

Deno.test("uses one separator and groups consecutive duplicate labels", async () => {
  assertEquals(formatActivity("🌀", "title policy"), "🌀 title policy")
  await withStore(async (store) => {
    await addSession(store, "one", "a", "dotfiles", { summary: "routing" })
    await addSession(store, "two", "b", "dotfiles", { state: "🌀", summary: "tests" })
    assertEquals(
      (await buildTabTitle(store, ["b", "a"])).title,
      "dotfiles | 🌀 tests | routing",
    )
  })
})

Deno.test("ignores missing and stale terminal mappings", async () => {
  await withStore(async (store) => {
    await addSession(store, "valid", "a", "one")
    await store.claim("b", "missing")
    assertEquals((await buildTabTitle(store, ["b", "a", "c"])).title, "one")
    assertEquals(await store.sessionForTerminal("b"), undefined)
  })
})

Deno.test("renders only the current prompt sequence summary", async () => {
  await withStore(async (store) => {
    await addSession(store, "session", "a", "repo", {
      sequence: 1,
      summary: "first prompt",
    })
    await store.updateSession("session", (state) => ({ ...state, promptSequence: 2 }))
    assertEquals((await buildTabTitle(store, ["a"])).title, "repo")
    await store.writeSummary("session", 2, "second prompt")
    assertEquals((await buildTabTitle(store, ["a"])).title, "repo | second prompt")
    // A late sequence-one writer cannot overwrite sequence two.
    assertEquals(await store.readSummary("session", 1), "first prompt")
  })
})

class FakeRouting implements GhosttyRouting {
  tabs = new Map<string, string[]>()
  writes: Array<{ tabId: string; title: string }> = []
  beforeFirstWrite?: () => Promise<void>

  snapshotForTerminal(terminalId: string): Promise<TabSnapshot | undefined> {
    for (const [tabId, terminalIds] of this.tabs) {
      if (terminalIds.includes(terminalId)) {
        return Promise.resolve({ tabId, terminalIds: [...terminalIds] })
      }
    }
    return Promise.resolve(undefined)
  }

  snapshotForTab(tabId: string): Promise<TabSnapshot | undefined> {
    const terminalIds = this.tabs.get(tabId)
    return Promise.resolve(
      terminalIds ? { tabId, terminalIds: [...terminalIds] } : undefined,
    )
  }

  async setTitle(snapshot: TabSnapshot, title: string): Promise<TitleWriteResult> {
    if (this.beforeFirstWrite) {
      const callback = this.beforeFirstWrite
      this.beforeFirstWrite = undefined
      await callback()
    }
    const current = await this.snapshotForTerminal(snapshot.terminalIds[0])
    if (!current) return "not-found"
    if (current.tabId !== snapshot.tabId) return "moved"
    this.writes.push({ tabId: snapshot.tabId, title })
    return "set"
  }
}

Deno.test("retries when aggregate state changes during a title write", async () => {
  await withStore(async (store) => {
    await addSession(store, "one", "a", "repo", { state: "🌀" })
    const routing = new FakeRouting()
    routing.tabs.set("tab", ["a"])
    routing.beforeFirstWrite = async () => {
      await store.updateSession("one", (state) => ({ ...state, state: "" }))
    }
    await new TabRenderer(store, routing).renderForTerminal("a")
    assertEquals(routing.writes.map(({ title }) => title), ["repo | 🌀", "repo"])
  })
})

Deno.test("repairs old and new tabs after a mapped terminal moves", async () => {
  await withStore(async (store) => {
    await addSession(store, "one", "a", "one")
    await addSession(store, "two", "b", "two")
    await store.writeMetadata("a", { lastTabId: "old" })
    const routing = new FakeRouting()
    routing.tabs.set("old", ["b"])
    routing.tabs.set("new", ["a"])
    await new TabRenderer(store, routing).renderForTerminal("a")
    assertEquals(routing.writes, [
      { tabId: "old", title: "two" },
      { tabId: "new", title: "one" },
    ])
  })
})

Deno.test("a new session replaces the visible session for one terminal", async () => {
  await withStore(async (store) => {
    await addSession(store, "old", "a", "old")
    await addSession(store, "new", "a", "new")
    assertEquals((await buildTabTitle(store, ["a"])).title, "new")
    assertEquals((await store.readSession("old"))?.label, "old")
  })
})

Deno.test("releasing one terminal preserves the other aggregate segment", async () => {
  await withStore(async (store) => {
    await addSession(store, "one", "a", "one")
    await addSession(store, "two", "b", "two")
    await store.release("a")
    assertEquals((await buildTabTitle(store, ["a", "b"], "shell-a")).title, "two")
    await store.release("b")
    assertEquals((await buildTabTitle(store, ["a", "b"], "shell-a")).title, "shell-a")
  })
})

Deno.test("an exited idle session remains mapped and visible", async () => {
  await withStore(async (store) => {
    await addSession(store, "session", "a", "repo", { state: "🌀" })
    await store.updateSession("session", (state) => ({ ...state, state: "" }))
    assertEquals(await store.sessionForTerminal("a"), "session")
    assertEquals((await buildTabTitle(store, ["a"])).title, "repo")
  })
})

Deno.test("legacy session state keeps its summary and gains sequence defaults", async () => {
  await withStore(async (store) => {
    await Deno.writeTextFile(
      `${store.paths.sessions}/legacy`,
      JSON.stringify({ terminalId: "a", label: "repo", summary: "legacy title" }),
    )
    await store.claim("a", "legacy")
    assertEquals((await store.readSession("legacy"))?.promptSequence, 0)
    assertEquals((await buildTabTitle(store, ["a"])).title, "repo | legacy title")
  })
})

Deno.test("a resumed session reclaims its terminal after shell activity", async () => {
  await withStore(async (store) => {
    await addSession(store, "session", "a", "repo")
    await store.release("a")
    assertEquals((await buildTabTitle(store, ["a"], "shell")).title, "shell")
    await store.claim("a", "session")
    assertEquals((await buildTabTitle(store, ["a"], "shell")).title, "repo")
  })
})

Deno.test("stale session and index files are swept", async () => {
  await withStore(async (store) => {
    await addSession(store, "stale", "a", "repo")
    const old = new Date(0)
    await Deno.utime(`${store.paths.sessions}/stale`, old, old)
    await Deno.utime(`${store.paths.terminalSessions}/a`, old, old)
    await store.sweepStale(1)
    assertEquals(await store.readSession("stale"), undefined)
    assertEquals(await store.sessionForTerminal("a"), undefined)
  })
})
