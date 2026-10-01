/**
 * `GET /api/events`, the page's server-sent event stream. Says `hello` with
 * every topic's version on connect, then `changed {topic,version}` (at most
 * one per topic per 40 ms), `feed` deltas (entries after the client's last
 * ids, passed as query params) and the streaming `reply` text. At most 8
 * streams; the oldest closes when a ninth opens. A `:ping` every 15 s keeps
 * proxies and phones from closing an idle stream.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { lobbyTopics, type LobbyTopic } from "../lobby/topics.ts";
import type { LobbyService } from "../lobby/service.ts";
import type { StreamEvent } from "./protocol.ts";

/** Concurrent streams; the oldest closes when one more opens. */
export const MAX_STREAMS = 8;
/** Topic changes share one message per topic per this many ms (the lobby's frame). */
export const COALESCE_MS = 40;
/** How often an idle stream says it is alive. */
export const HEARTBEAT_MS = 15_000;

interface Stream {
  res: ServerResponse;
  beat: ReturnType<typeof setInterval>;
  activityAfter: number;
  thoughtsAfter: number;
  chatAfter: number;
}

function frame(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function idOf(entry: unknown): number {
  return typeof (entry as { id?: unknown }).id === "number" ? ((entry as { id: number }).id as number) : 0;
}

/** The event stream hub for one server; re-attached when the service changes. */
export class EventHub {
  private streams: Stream[] = [];
  private pending = new Map<LobbyTopic, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private service: LobbyService | undefined;
  private unsubTopics: (() => void) | undefined;
  private unsubFeed: (() => void) | undefined;
  private lastReply = "";
  private readonly heartbeatMs: number;
  constructor(heartbeatMs: number = HEARTBEAT_MS) {
    this.heartbeatMs = heartbeatMs;
  }

  /** Open streams (one per browser tab watching). */
  clients(): number {
    return this.streams.length;
  }

  /** Follow `service`'s topics and feed; open streams hear `hello` again. */
  attach(service: LobbyService): void {
    this.detach();
    this.service = service;
    this.unsubTopics = lobbyTopics.subscribe((topic, version) => this.changed(topic, version));
    const feed = service.feed;
    this.lastReply = feed.reply;
    this.unsubFeed = feed.onChange(() => this.scheduleFlush());
  }

  /** Stop following the service (streams stay open across a rebind). */
  detach(): void {
    this.unsubTopics?.();
    this.unsubFeed?.();
    this.unsubTopics = undefined;
    this.unsubFeed = undefined;
    this.service = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }

  /** Open a stream; closes the oldest past the cap, says `hello`. */
  add(_req: IncomingMessage, res: ServerResponse, query: { activityAfter?: number; thoughtsAfter?: number; chatAfter?: number }): void {
    if (this.streams.length >= MAX_STREAMS) this.dropOldest();
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    const stream: Stream = {
      res,
      beat: setInterval(() => this.ping(stream), this.heartbeatMs),
      activityAfter: query.activityAfter ?? 0,
      thoughtsAfter: query.thoughtsAfter ?? 0,
      chatAfter: query.chatAfter ?? 0,
    };
    if (typeof stream.beat === "object" && "unref" in stream.beat) (stream.beat as unknown as { unref(): void }).unref();
    this.streams.push(stream);
    res.write(`retry: 2000\n${frame({ type: "hello", versions: lobbyTopics.versions() })}`);
    this.flushFeed(stream);
  }

  /** Forget a stream (its request closed). */
  remove(res: ServerResponse): void {
    const index = this.streams.findIndex((stream) => stream.res === res);
    if (index < 0) return;
    const [stream] = this.streams.splice(index, 1);
    clearInterval(stream!.beat);
  }

  /** Say `hello` again on every open stream (after a rebind). */
  hello(): void {
    for (const stream of [...this.streams]) this.send(stream, frame({ type: "hello", versions: lobbyTopics.versions() }));
  }

  /** Close every stream and stop following the service. */
  close(): void {
    this.detach();
    for (const stream of this.streams) {
      clearInterval(stream.beat);
      try {
        stream.res.end();
      } catch {
        // Already gone; forgetting it is enough.
      }
    }
    this.streams = [];
  }

  private dropOldest(): void {
    const oldest = this.streams.shift();
    if (!oldest) return;
    clearInterval(oldest.beat);
    try {
      oldest.res.end();
    } catch {
      // Already gone; forgetting it is enough.
    }
  }

  private send(stream: Stream, text: string): void {
    try {
      stream.res.write(text);
    } catch {
      this.remove(stream.res);
    }
  }

  private ping(stream: Stream): void {
    this.send(stream, ":ping\n\n");
  }

  /** A topic changed; at most one message per topic per coalescing window. */
  changed(topic: LobbyTopic, version: number): void {
    this.pending.set(topic, version);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flushPending();
      this.flushFeedAll();
    }, COALESCE_MS);
    if (typeof this.timer === "object" && "unref" in this.timer) (this.timer as unknown as { unref(): void }).unref();
  }

  private flushPending(): void {
    const changed = [...this.pending];
    this.pending.clear();
    for (const [topic, version] of changed) {
      const text = frame({ type: "changed", topic, version });
      for (const stream of [...this.streams]) this.send(stream, text);
    }
  }

  private flushFeedAll(): void {
    for (const stream of [...this.streams]) this.flushFeed(stream);
  }

  /** New feed entries past the stream's cursors, and the reply text when it moved. */
  private flushFeed(stream: Stream): void {
    const feed = this.service?.feed;
    if (!feed) return;
    const activity = feed.activity.filter((entry) => entry.id > stream.activityAfter);
    const thoughts = feed.thoughts.filter((entry) => entry.id > stream.thoughtsAfter);
    const chat = feed.chat.filter((entry) => entry.id > stream.chatAfter);
    for (const entry of activity) stream.activityAfter = Math.max(stream.activityAfter, idOf(entry));
    for (const entry of thoughts) stream.thoughtsAfter = Math.max(stream.thoughtsAfter, idOf(entry));
    for (const entry of chat) stream.chatAfter = Math.max(stream.chatAfter, idOf(entry));
    if (activity.length > 0 || thoughts.length > 0 || chat.length > 0) {
      this.send(stream, frame({ type: "feed", activity, thoughts, chat }));
    }
    if (feed.reply !== this.lastReply) {
      this.lastReply = feed.reply;
      this.send(stream, frame({ type: "reply", text: feed.reply }));
    }
  }
}
