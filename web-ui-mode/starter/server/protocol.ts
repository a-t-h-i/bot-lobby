/**
 * What crosses the wire between the lobby's server and its page. The page
 * imports these as types only, so nothing from the server is bundled into it.
 * In bot-lobby this file becomes `src/webui/protocol.ts` (ARCHITECTURE §5).
 */

/** Every API answer: the result, or why not. */
export type ApiReply<T> = { ok: true; result: T } | { ok: false; error: string; code: ApiErrorCode };

export type ApiErrorCode = "bad_request" | "unauthorized" | "forbidden" | "not_found" | "unsupported" | "too_large" | "conflict" | "failed";

export type ChatRole = "you" | "oracle" | "note";

export interface ChatEntry {
  id: number;
  at: number;
  role: ChatRole;
  /** Markdown, written by a model or a person: the page sanitizes it before it is shown. */
  text: string;
}

export interface ActivityEntry {
  id: number;
  at: number;
  source: string;
  text: string;
  kind: "info" | "success" | "warning" | "error";
  pending: boolean;
}

/** What the Lobby tab shows, read in one call. */
export interface LobbySnapshot {
  workspace: { name: string; branch?: string };
  busy: boolean;
  chat: ChatEntry[];
  /** The oracle's reply while it streams; undefined between replies. */
  reply?: string;
  activity: ActivityEntry[];
}

/** Topics the event stream reports changes on; the page rereads a topic when its version moves. */
export type Topic = "lobby" | "tasks" | "plans" | "quickfix" | "planner" | "sessions" | "metrics" | "git" | "knowledge" | "excalidraw" | "prompts";

/** One message on the event stream (`GET /api/events`, server-sent events). */
export type StreamEvent =
  | { type: "hello"; versions: Partial<Record<Topic, number>> }
  | { type: "changed"; topic: Topic; version: number }
  /** The streaming reply's text so far; sent instead of a whole snapshot so tokens stay cheap. */
  | { type: "reply"; text: string };

/** The calls this starter serves: `POST /api/<name>` with the request as the JSON body. */
export interface Api {
  "lobby.snapshot": { request: Record<string, never>; result: LobbySnapshot };
  "lobby.send": { request: { text: string }; result: { notice?: string } };
  "lobby.abort": { request: Record<string, never>; result: Record<string, never> };
}

export type ApiName = keyof Api;
