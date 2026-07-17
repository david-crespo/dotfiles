// Transcript adapters and asynchronous summary generation.
import $ from "@david/dax"

const MESSAGE_WINDOW = 5
const MAX_MESSAGE_CHARS = 2000
const MIN_RELEVANT_CHARS = 20
const SKIP_COMMANDS = new Set(["/clear", "/compact", "/resume"])

type TranscriptEvent = Record<string, unknown>
type TranscriptFormat = "claude" | "codex"

export interface SummaryPayload {
  priorSummary: string
  firstMessage: string
  recentMessages: string[]
}

export function sanitizeTitle(title: string): string {
  // deno-lint-ignore no-control-regex
  return title.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function truncateMessage(value: string): string {
  return value.length <= MAX_MESSAGE_CHARS ? value : value.slice(0, MAX_MESSAGE_CHARS) + "…"
}

function extractUserText(content: string): string | undefined {
  const trimmed = content.trim()
  if (!trimmed) return undefined
  if (!trimmed.startsWith("<")) return trimmed
  const bashMatch = trimmed.match(/^<bash-input>([\s\S]*?)<\/bash-input>/)
  if (bashMatch) {
    const command = bashMatch[1].trim()
    return command ? `$ ${command}` : undefined
  }
  const match = trimmed.match(
    /^<command-name>([^<]+)<\/command-name>(?:[\s\S]*?<command-args>([^<]*)<\/command-args>)?/,
  )
  if (!match) return undefined
  const name = match[1].trim()
  if (SKIP_COMMANDS.has(name)) return undefined
  const args = match[2]?.trim()
  return args ? `${name} ${args}` : name
}

function detectTranscriptFormat(events: TranscriptEvent[]): TranscriptFormat | undefined {
  for (const event of events) {
    if (event.type === "user") return "claude"
    if (event.type !== "response_item") continue
    const payload = event.payload as Record<string, unknown> | undefined
    if (payload?.type === "message" && payload.role === "user") return "codex"
  }
  return undefined
}

function claudeUserText(event: TranscriptEvent): string | undefined {
  if (event.type !== "user") return undefined
  const message = event.message as { content?: unknown } | undefined
  return typeof message?.content === "string" ? extractUserText(message.content) : undefined
}

function codexUserText(event: TranscriptEvent): string | undefined {
  if (event.type !== "response_item") return undefined
  const payload = event.payload as Record<string, unknown> | undefined
  if (payload?.type !== "message" || payload.role !== "user") return undefined
  if (!Array.isArray(payload.content)) return undefined
  const text = payload.content.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const part = item as Record<string, unknown>
    return part.type === "input_text" && typeof part.text === "string" ? [part.text] : []
  }).join("\n")
  return extractUserText(text)
}

export async function readUserMessages(transcriptPath: string): Promise<string[]> {
  const raw = await Deno.readTextFile(transcriptPath).catch(() => "")
  if (!raw) return []
  const events = raw.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as TranscriptEvent]
    } catch {
      return []
    }
  })
  const format = detectTranscriptFormat(events)
  if (!format) return []
  const readText = format === "claude" ? claudeUserText : codexUserText
  return events.flatMap((event) => {
    const text = readText(event)
    return text ? [truncateMessage(text)] : []
  })
}

export async function buildSummaryPayload(
  transcriptPath: string,
  priorSummary?: string,
  extraPrompt?: string,
): Promise<SummaryPayload | undefined> {
  const transcriptMessages = await readUserMessages(transcriptPath)
  const promptText = extraPrompt ? extractUserText(extraPrompt) : undefined
  const all = promptText && transcriptMessages.at(-1) !== promptText
    ? [...transcriptMessages, truncateMessage(promptText)]
    : transcriptMessages
  const relevant = all.filter((message) => message.length > MIN_RELEVANT_CHARS)
  if (relevant.length === 0) return undefined
  return {
    priorSummary: priorSummary ?? "",
    firstMessage: relevant[0],
    recentMessages: relevant.slice(-MESSAGE_WINDOW),
  }
}

const SYSTEM_PROMPT = `
You track what the user is working on and produce a label for their terminal tab.

Inputs: a prior summary, the session's first user message (sets overall
context), and the most recent user messages. The input is a JSON object with
keys "priorSummary", "firstMessage", and "recentMessages".

Prefer keeping the prior summary unchanged if it's still accurate. Only
change the summary if the theme of the work has substantially changed.
Prefer short, concrete labels. When the messages name a filename, tool,
symbol, feature, or bug, prefer that noun. Do not invent specifics.

Output only the label, no punctuation, no quotes.`

export async function generateSummary(payload: SummaryPayload): Promise<string> {
  const output = await $`ai --system ${SYSTEM_PROMPT} --model haiku --raw --ephemeral`
    .stdinText(JSON.stringify(payload))
    .text()
    .catch(() => "")
  return sanitizeTitle(output).slice(0, 100)
}
