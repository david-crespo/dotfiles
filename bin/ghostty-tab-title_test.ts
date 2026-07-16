import { buildSummaryPayload, readUserMessages } from "./ghostty-tab-title.ts"

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
