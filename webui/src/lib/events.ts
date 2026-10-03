/**
 * `GET /api/events` as an `EventSource`: `hello`, `changed`, `feed` and `reply`
 * events plus the connection state. The browser reconnects on its own (the
 * server asks for 2 s), and a reconnect fires `hello` again so the store
 * rereads. No DOM globals at module load, so `node:test` can inject a source.
 */
import type { LobbyTopic, StreamEvent } from "@protocol"

export type NoticeLevel = "info" | "success" | "warning" | "error"

export type ConnectionState = "live" | "connecting" | "offline"

export interface FeedDelta {
  activity: unknown[]
  thoughts: unknown[]
  chat: unknown[]
}

export interface EventHandlers {
  onHello?: (versions: Partial<Record<LobbyTopic, number>>) => void
  onChanged?: (topic: LobbyTopic, version: number) => void
  onFeed?: (delta: FeedDelta) => void
  onReply?: (text: string) => void
  onNotice?: (text: string, level: NoticeLevel) => void
  onConnection?: (state: ConnectionState) => void
}

/** The slice of `EventSource` the page uses; a fake satisfies it in tests. */
export interface EventSourceLike {
  onopen: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: string }) => void) | null
  readonly readyState: number
  close(): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

const CLOSED = 2

function browserEventSource(url: string): EventSourceLike {
  const ctor = (globalThis as unknown as { EventSource?: new (url: string) => EventSourceLike }).EventSource
  if (!ctor) throw new Error("EventSource is not available in this environment")
  return new ctor(url)
}

function parse(data: string): StreamEvent | undefined {
  try {
    return JSON.parse(data) as StreamEvent
  } catch {
    return undefined
  }
}

function dispatch(event: StreamEvent, handlers: EventHandlers): void {
  switch (event.type) {
    case "hello":
      handlers.onHello?.(event.versions)
      return
    case "changed":
      handlers.onChanged?.(event.topic, event.version)
      return
    case "feed":
      handlers.onFeed?.({ activity: event.activity, thoughts: event.thoughts, chat: event.chat })
      return
    case "reply":
      handlers.onReply?.(event.text)
      return
    case "notice":
      handlers.onNotice?.(event.text, event.level)
  }
}

/** Follow the stream; returns the close function. */
export function openEvents(handlers: EventHandlers, create: EventSourceFactory = browserEventSource): () => void {
  const source = create("/api/events")
  handlers.onConnection?.("connecting")
  source.onopen = () => handlers.onConnection?.("live")
  source.onerror = () => handlers.onConnection?.(source.readyState === CLOSED ? "offline" : "connecting")
  source.onmessage = (message) => {
    const event = parse(message.data)
    if (event) dispatch(event, handlers)
  }
  return () => source.close()
}
