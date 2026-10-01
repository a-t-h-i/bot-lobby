/**
 * What crosses the wire between the lobby's loopback server and its page.
 * The page imports this file with `import type` only, so nothing from the
 * server is ever bundled into it.
 */
import type { LobbyTopic } from "../lobby/topics.ts";
import type { WebPrompt } from "../lobby/prompt-hub.ts";

export type { WebPrompt };
export type { LobbyTopic };

/** Every API answer: the result, or why not. */
export type ApiReply<T> = { ok: true; result: T } | { ok: false; error: string; code: ErrorCode };

/** Machine codes for API failures, each with its own HTTP status. */
export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "unsupported"
  | "too_large"
  | "conflict"
  | "question_withdrawn"
  | "rate_limited"
  | "failed";

/** HTTP status for an error code. */
export function statusFor(code: ErrorCode): number {
  switch (code) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
    case "question_withdrawn":
      return 409;
    case "too_large":
      return 413;
    case "unsupported":
      return 415;
    case "rate_limited":
      return 429;
    case "failed":
      return 500;
  }
}

/** One tab as the status call describes it. */
export interface TabInfo {
  id: string;
  label: string;
  key: string;
}

/** One shortcut as the status call describes it. */
export interface KeyInfo {
  action: string;
  key: string;
  label: string;
  help: string;
}

/** `status.get`: everything the page shell needs before it reads a tab. */
export interface StatusInfo {
  workspace: { name: string; branch?: string };
  branch?: string;
  sessionId?: string;
  sessionName?: string;
  busy: boolean;
  /** Pi itself is asking in the terminal; the page waits. */
  terminalDialog: boolean;
  port: number;
  issuesEnabled: boolean;
  tabs: TabInfo[];
  keys: KeyInfo[];
  windows: Array<{ name: string; url: string }>;
}

/** One task header as the lobby snapshot carries it. */
export interface SnapshotTask {
  id: string;
  title: string;
  state: string;
}

/** What the Lobby tab shows, read in one call. */
export interface LobbySnapshot {
  task?: SnapshotTask;
  runs: unknown[];
  /** Newest chat messages (at most 100), oldest first. */
  chat: Array<{ id: number; at: number; role: string; text: string }>;
  /** The oracle's reply while it streams; absent between replies. */
  reply?: string;
  /** Newest activity entries (at most 400), oldest first. */
  activity: Array<{ id: number; at: number; source: string; text: string; kind: string; pending: boolean }>;
  /** Newest thoughts (at most 40), oldest first. */
  thoughts: Array<{ id: number; at: number; source: string; text: string; live: boolean }>;
  /** Earlier chat exists in the session (loaded through `lobby.history`). */
  hasOlderChat: boolean;
}

/** One message on the event stream (`GET /api/events`, server-sent events). */
export type StreamEvent =
  | { type: "hello"; versions: Partial<Record<LobbyTopic, number>> }
  | { type: "changed"; topic: LobbyTopic; version: number }
  | { type: "feed"; activity: unknown[]; thoughts: unknown[]; chat: unknown[] }
  | { type: "reply"; text: string };

/** The calls the server answers: `POST /api/<name>` with the request as the JSON body. */
export interface Api {
  "status.get": { request: Record<string, never>; result: StatusInfo };
  "lobby.snapshot": { request: Record<string, never>; result: LobbySnapshot };
  "lobby.history": { request: { before?: number }; result: { entries: unknown[]; hasOlder: boolean } };
  "lobby.send": { request: { text: string }; result: { notice?: string } };
  "lobby.abort": { request: Record<string, never>; result: Record<string, never> };
  "prompts.list": { request: Record<string, never>; result: { prompts: WebPrompt[] } };
  "prompts.answer": { request: { id: string; answer: unknown }; result: { notice?: string } };
  "prompts.dismiss": { request: { id: string }; result: Record<string, never> };
}

export type ApiName = keyof Api;
