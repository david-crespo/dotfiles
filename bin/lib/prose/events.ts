export type UserInput = {
  kind: "message" | "comment" | "dellm"
  text?: string
  selection?: string
  prefix?: string
  suffix?: string
  embed?: string
  replyTo?: string
}

export type ActivityInput = {
  kind: "activity"
  phase: "start" | "progress" | "reply" | "done" | "needs-reply" | "error"
  requestIds: string[]
  workId?: string
  text?: string
}

export type Event = (UserInput | ActivityInput) & {
  id: string
  seq: number
  ts: string
  file: string
}
export type RequestState = {
  id: string
  status: "waiting" | "working" | "done" | "needs-reply" | "error" | "interrupted"
  workId?: string
  updatedAt: string
}
export type FeedSnapshot = {
  type: "conversation"
  file: string
  events: Event[]
  requests: RequestState[]
  agentConnected: boolean
}

export class InputError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("Expected a JSON object")
  }
  return value as Record<string, unknown>
}
function string(body: Record<string, unknown>, key: string, required = false, max = 20000) {
  const value = body[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new InputError(`Invalid ${key}`)
  }
  return value
}
function identifier(body: Record<string, unknown>, key: string, required = false) {
  const value = string(body, key, required, 128)
  if (value !== undefined && !/^[\w-]+$/.test(value)) throw new InputError(`Invalid ${key}`)
  return value
}

export function parseUser(value: unknown): UserInput {
  const body = record(value)
  const kind = body.kind
  if (kind !== "message" && kind !== "comment" && kind !== "dellm") {
    throw new InputError("Invalid message kind")
  }
  return {
    kind,
    text: string(body, "text", kind !== "dellm"),
    ...(kind === "message" ? {} : {
      selection: string(body, "selection", true),
      prefix: string(body, "prefix") ?? "",
      suffix: string(body, "suffix") ?? "",
      embed: string(body, "embed", false, 4000),
    }),
    replyTo: identifier(body, "replyTo"),
  }
}

export function parseActivity(value: unknown): ActivityInput {
  const body = record(value)
  const phase = body.phase as ActivityInput["phase"]
  if (!["start", "progress", "reply", "done", "needs-reply", "error"].includes(phase)) {
    throw new InputError("Invalid activity phase")
  }
  const ids = body.requestIds ?? []
  if (!Array.isArray(ids) || ids.length > 100) throw new InputError("Invalid requestIds")
  const requestIds = [...new Set(ids.map((id) => identifier({ id }, "id", true)!))]
  if (phase !== "reply" && requestIds.length === 0) {
    throw new InputError("requestIds are required")
  }
  return {
    kind: "activity",
    phase,
    requestIds,
    workId: identifier(body, "workId", requestIds.length > 0),
    text: string(body, "text", ["reply", "needs-reply", "error"].includes(phase)),
  }
}

// One append-only log is both the conversation history and the recovery source.
export class ActivityLog {
  events: Event[] = []
  requests = new Map<string, RequestState>()
  private constructor(private path: string, public file: string) {}

  static async open(path: string, file: string) {
    const log = new ActivityLog(path, file)
    let source: string
    try {
      source = await Deno.readTextFile(path)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return log
      throw error
    }
    for (const line of source.split("\n")) {
      if (line.trim()) log.apply(JSON.parse(line))
    }
    for (const state of log.requests.values()) {
      if (state.status === "working") state.status = "interrupted"
    }
    return log
  }

  private apply(event: Event) {
    this.events.push(event)
    if (event.kind !== "activity") {
      this.requests.set(event.id, { id: event.id, status: "waiting", updatedAt: event.ts })
      return
    }
    for (const id of event.requestIds) {
      const state = this.requests.get(id)
      if (!state) continue
      if (event.phase === "start") {
        state.status = "working"
        state.workId = event.workId
      } else if (["done", "needs-reply", "error"].includes(event.phase)) {
        state.status = event.phase as RequestState["status"]
      }
      state.updatedAt = event.ts
    }
  }

  // Callers serialize appends; the server runs them through one mutation queue.
  async append(input: UserInput | ActivityInput): Promise<Event> {
    if (input.kind === "activity") {
      for (const id of input.requestIds) {
        const state = this.requests.get(id)
        if (!state) throw new InputError(`Unknown request: ${id}`, 404)
        if (state.status === "done") {
          throw new InputError(`Request already finished: ${id}`, 409)
        }
        if (
          input.phase !== "start" &&
          (state.workId !== input.workId || state.status !== "working")
        ) {
          throw new InputError(`Start this work before updating request: ${id}`, 409)
        }
      }
    } else if (input.replyTo && !this.requests.has(input.replyTo)) {
      throw new InputError("Unknown replyTo request", 404)
    }
    const event = {
      ...input,
      id: crypto.randomUUID(),
      seq: this.events.length + 1,
      ts: new Date().toISOString(),
      file: this.file,
    } as Event
    await Deno.writeTextFile(this.path, JSON.stringify(event) + "\n", { append: true })
    this.apply(event)
    return event
  }

  snapshot(agentConnected: boolean): FeedSnapshot {
    return {
      type: "conversation",
      file: this.file,
      events: this.events,
      requests: [...this.requests.values()],
      agentConnected,
    }
  }
}
