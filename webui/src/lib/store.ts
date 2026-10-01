/**
 * The page's topic state: one record per lobby topic plus the connection and
 * sign-in state. Framework-agnostic and free of `window`/`document` so it runs
 * under `node:test` unchanged; a React hook reads it in a later step.
 */
import type { LobbySnapshot, LobbyTopic } from "@protocol"

export type ConnectionState = "live" | "connecting" | "offline"

/** One topic's cached answer. `stale` is set when it changed while unused. */
export interface TopicRecord<T = unknown> {
  version: number
  data: T | undefined
  loading: boolean
  error: string | undefined
  stale: boolean
}

export interface StoreStatus {
  connection: ConnectionState
  signedOut: boolean
}

export interface FeedDelta {
  activity?: unknown[]
  thoughts?: unknown[]
  chat?: unknown[]
}

export type TopicReader = (topic: LobbyTopic) => Promise<unknown>

/** Feed caps mirror the server's, so a patched snapshot never grows unbounded. */
const CAPS = { activity: 400, thoughts: 40, chat: 100 } as const

interface Identified {
  id: number
}

function mergeById<T extends Identified>(current: T[] | undefined, incoming: unknown[], cap: number): T[] {
  const base = current ?? []
  const known = new Set(base.map((entry) => entry.id))
  const added = (incoming as T[]).filter((entry) => typeof entry?.id === "number" && !known.has(entry.id))
  return [...base, ...added].slice(-cap)
}

/** One version per topic, reread only while a screen uses it. */
export class LobbyStore {
  private readonly records = new Map<LobbyTopic, TopicRecord>()
  private readonly listeners = new Set<() => void>()
  private readonly reads = new Map<LobbyTopic, number>()
  private used = new Set<LobbyTopic>()
  private reader: TopicReader | undefined
  private currentStatus: StoreStatus = { connection: "connecting", signedOut: false }

  /** The record for `topic`, created with defaults on first ask. */
  get(topic: LobbyTopic): TopicRecord {
    const existing = this.records.get(topic)
    if (existing) return existing
    const record: TopicRecord = { version: 0, data: undefined, loading: false, error: undefined, stale: false }
    this.records.set(topic, record)
    return record
  }

  /** The connection and sign-in state. */
  status(): StoreStatus {
    return { ...this.currentStatus }
  }

  /** Hear every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Declare the topics the current screen shows and how to load them. */
  markUsed(topics: LobbyTopic[], reader: TopicReader): void {
    this.reader = reader
    const added = topics.filter((topic) => !this.used.has(topic))
    this.used = new Set(topics)
    for (const topic of added) void this.read(topic)
  }

  /** A fresh `hello` (first connect or reconnect): reread every used topic. */
  onHello(versions: Partial<Record<LobbyTopic, number>>): void {
    for (const topic of this.used) {
      const version = versions[topic]
      if (version !== undefined) this.get(topic).version = version
      void this.read(topic)
    }
  }

  /** A changed topic: reread it when in use, otherwise remember it is stale. */
  onChanged(topic: LobbyTopic, version: number): void {
    const record = this.get(topic)
    record.version = version
    if (this.used.has(topic)) void this.read(topic)
    else record.stale = true
    this.notify()
  }

  /** Append the stream's new feed entries onto the `lobby` snapshot. */
  onFeedDelta(delta: FeedDelta): void {
    const data = this.get("lobby").data as LobbySnapshot | undefined
    if (!data) return
    this.get("lobby").data = {
      ...data,
      activity: mergeById(data.activity, delta.activity ?? [], CAPS.activity),
      thoughts: mergeById(data.thoughts, delta.thoughts ?? [], CAPS.thoughts),
      chat: mergeById(data.chat, delta.chat ?? [], CAPS.chat),
    }
    this.notify()
  }

  /** Patch the streaming reply onto the `lobby` snapshot. */
  onReplyDelta(text: string): void {
    const record = this.get("lobby")
    const data = record.data as LobbySnapshot | undefined
    if (!data) return
    record.data = { ...data, reply: text }
    this.notify()
  }

  /** Merge connection and sign-in state. */
  onStatus(state: Partial<StoreStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...state }
    this.notify()
  }

  private async read(topic: LobbyTopic): Promise<void> {
    const reader = this.reader
    if (!reader) return
    const token = (this.reads.get(topic) ?? 0) + 1
    this.reads.set(topic, token)
    const record = this.get(topic)
    record.loading = true
    record.error = undefined
    this.notify()
    try {
      const data = await reader(topic)
      if (this.reads.get(topic) !== token) return
      this.apply(record, data)
    } catch (error) {
      if (this.reads.get(topic) !== token) return
      record.loading = false
      record.error = error instanceof Error ? error.message : String(error)
    }
    this.notify()
  }

  private apply(record: TopicRecord, data: unknown): void {
    record.data = data
    record.loading = false
    record.stale = false
    record.error = undefined
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export function createLobbyStore(): LobbyStore {
  return new LobbyStore()
}

/** The page-wide store; the API layer marks it signed out on a 401. */
export const lobbyStore = createLobbyStore()
