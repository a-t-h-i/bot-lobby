/**
 * What crosses the wire between the lobby's loopback server and its page.
 * The page imports this file with `import type` only, so nothing from the
 * server is ever bundled into it.
 */
import type { LobbyTopic } from "../lobby/topics.ts";
import type { WebPrompt } from "../lobby/prompt-hub.ts";
import type { DialogAnswer, SessionDialog } from "../lobby/sessions.ts";
import type { LiveSession } from "../lobby/view.ts";
import type { TaskRow } from "../lobby/tabs/tasks.ts";
import type { PlanComment } from "../state/comments.ts";
import type { PanelMember } from "../schemas/configuration.ts";
import type { MemberState, PanelNote, PanelQuestion, PlannerMessage } from "../lobby/planner.ts";
import type { QuickFixJob } from "../lobby/quickfix.ts";

export type { WebPrompt };
export type { LobbyTopic };
export type { DialogAnswer, SessionDialog, TaskRow, PlanComment };
export type { LiveSession };
export type { PanelMember, MemberState, PanelNote, PanelQuestion, PlannerMessage, QuickFixJob };

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
  track?: { path: "fast" | "full"; size: string };
  domains: string[];
  git?: { branch: string; from?: string };
  progress?: { done: number; total: number };
  currentStep?: string;
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

/** One background session as `sessions.list` describes it. */
export interface BackgroundSessionInfo {
  key: string;
  name: string;
  status: string;
  busy: boolean;
  alive: boolean;
  sessionId?: string;
  planId?: string;
  /** Questions it waits on you for. */
  waiting: number;
  dialogs: SessionDialog[];
}

/** One message on the event stream (`GET /api/events`, server-sent events). */
export type StreamEvent =
  | { type: "hello"; versions: Partial<Record<LobbyTopic, number>> }
  | { type: "changed"; topic: LobbyTopic; version: number }
  | { type: "feed"; activity: unknown[]; thoughts: unknown[]; chat: unknown[] }
  | { type: "reply"; text: string };

/** The planning session as `planner.get` describes it. */
export interface PlannerSnapshot {
  /** Seats on the panel next round. */
  seats: PanelMember[];
  /** What each seat of the latest round did. */
  members: MemberState[];
  /** The whole conversation, oldest first. */
  messages: PlannerMessage[];
  /** The oracle's current draft plan, when it wrote one. */
  draft?: string;
  /** The latest round's questions, attributed. */
  questions: PanelQuestion[];
  /** What each seat said the plan must respect. */
  notes: PanelNote[];
  /** Rounds run so far. */
  round: number;
  /** Rounds before the oracle finalizes alone; 0 = unlimited. */
  limit: number;
  /** Whether `planner.retry` has something to redo. */
  retryable: boolean;
  /** Whether the panel is thinking now. */
  busy: boolean;
}

/** One issue a planning session can start from. */
export interface PlannerSeedInfo {
  issue: { number: number; title: string; url?: string };
  body: string;
}

/** The calls the server answers: `POST /api/<name>` with the request as the JSON body. */
export interface Api {
  "status.get": { request: Record<string, never>; result: StatusInfo };
  "lobby.snapshot": { request: Record<string, never>; result: LobbySnapshot };
  "lobby.history": { request: { before?: number }; result: { entries: unknown[]; hasOlder: boolean } };
  "lobby.send": { request: { text: string }; result: { notice?: string } };
  "lobby.abort": { request: Record<string, never>; result: Record<string, never> };
  "tasks.list": { request: Record<string, never>; result: { rows: TaskRow[] } };
  "tasks.archived": { request: Record<string, never>; result: { rows: TaskRow[] } };
  "tasks.comments": { request: { taskId: string }; result: { comments: PlanComment[] } };
  "tasks.comment": { request: { taskId: string; text: string }; result: { notice?: string } };
  "tasks.archive": { request: { taskId: string }; result: { notice: string } };
  "tasks.restore": { request: { taskId: string }; result: { notice: string } };
  "tasks.delete": { request: { taskId: string; where: "list" | "archive" }; result: { notice: string } };
  "tasks.auto": { request: { taskId: string; on: boolean }; result: { notice: string; on: boolean } };
  "tasks.message": { request: { taskId: string; text: string }; result: { notice: string } };
  "plans.start": { request: { planId: string; where: "here" | "session"; auto?: boolean }; result: { notice: string; key?: string } };
  "plans.discard": { request: { planId: string }; result: { notice: string } };
  "sessions.list": { request: Record<string, never>; result: { background: BackgroundSessionInfo[]; live: LiveSession[] } };
  "sessions.chat": { request: { key?: string; sessionId?: string; before?: number }; result: { entries: unknown[]; hasOlder: boolean } };
  "sessions.start": { request: { request?: string; planId?: string; auto?: boolean }; result: { notice: string; key?: string } };
  "sessions.stop": { request: { key: string }; result: { notice: string } };
  "sessions.message": { request: { key?: string; sessionId?: string; text: string }; result: { notice?: string } };
  "sessions.switch": { request: { key?: string; sessionId?: string; claimTaskId?: string }; result: { notice: string } };
  "sessions.answer": { request: { key: string; dialogId: string; answer: DialogAnswer }; result: { notice: string } };
  "prompts.list": { request: Record<string, never>; result: { prompts: WebPrompt[] } };
  "prompts.answer": { request: { id: string; answer: unknown }; result: { notice?: string } };
  "prompts.dismiss": { request: { id: string }; result: Record<string, never> };
  "planner.get": { request: Record<string, never>; result: PlannerSnapshot };
  "planner.new": { request: { seed?: PlannerSeedInfo; seats?: PanelMember[] }; result: { notice: string } };
  "planner.send": { request: { text: string }; result: { notice: string } };
  "planner.toggleSeat": { request: { member: PanelMember }; result: { notice: string; seated: boolean } };
  "planner.retry": { request: Record<string, never>; result: { notice: string } };
  "planner.commentLine": { request: { line: string; text: string }; result: { notice: string } };
  "planner.answer": { request: Record<string, never>; result: { notice: string } };
  "planner.save": { request: Record<string, never>; result: { notice: string } };
  "quickfix.list": { request: Record<string, never>; result: { jobs: QuickFixJob[] } };
  "quickfix.submit": { request: { text: string }; result: { notice: string; id: string } };
  "quickfix.cancel": { request: { id: string }; result: { notice: string } };
  "quickfix.runAnyway": { request: { id: string }; result: { notice: string } };
  "quickfix.movedToTask": { request: { id: string }; result: { notice: string; key?: string } };
}

export type ApiName = keyof Api;
