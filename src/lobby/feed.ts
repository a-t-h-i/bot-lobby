/**
 * What the lobby narrates: an activity log of plain-words tool steps from the
 * Master and every subagent, a single place for thoughts, and the conversation
 * with the Master stripped of tool rows and thinking. Bounded ring buffers in
 * one module-level store (like the zen widget state), so every event source can
 * write without a reference to the lobby, and the lobby repaints on `version`.
 */
import type { AgentRun } from "../schemas/findings.ts";
import { agentName } from "../pi/run-summary.ts";

export type ActivityKind = "info" | "success" | "warning" | "error";

export interface ActivityEntry {
  id: number;
  at: number;
  /** Who acted: MASTER, DEV, DESIGN, QA, RESEARCH, QUICK FIX, PLANNER, LOBBY. */
  source: string;
  text: string;
  kind: ActivityKind;
  /** Still in flight; rendered with an ellipsis until it settles. */
  pending: boolean;
  /** Correlates a start with its end (a tool call id or a run id). */
  key?: string;
}

export interface ThoughtEntry {
  id: number;
  at: number;
  source: string;
  text: string;
  /** The Master's thought still streaming. */
  live: boolean;
}

export type ChatRole = "you" | "oracle" | "note";

export interface ChatEntry {
  id: number;
  at: number;
  role: ChatRole;
  text: string;
}

export const MAX_ACTIVITY = 400;
export const MAX_THOUGHTS = 40;
export const MAX_CHAT = 200;
/** Longest thought kept; a streaming thought keeps its newest text. */
export const MAX_THOUGHT_TEXT = 4000;

function bounded<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(-max) : list;
}

export class LobbyFeed {
  activity: ActivityEntry[] = [];
  thoughts: ThoughtEntry[] = [];
  chat: ChatEntry[] = [];
  /** The oracle's reply while it streams; cleared when the message ends. */
  reply = "";
  version = 0;
  private nextId = 1;
  private readonly listeners = new Set<() => void>();
  /** Last step reported per run, so repeated run updates log each step once. */
  private readonly runSteps = new Map<string, string>();
  private readonly runThoughts = new Map<string, string>();
  private readonly runStatus = new Map<string, AgentRun["status"]>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private touch(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Settle every pending entry of `source` (optionally only the one keyed `key`). */
  private settle(source: string | undefined, key: string | undefined, kind?: ActivityKind): boolean {
    let changed = false;
    for (const entry of this.activity) {
      if (!entry.pending) continue;
      if (key !== undefined ? entry.key !== key : entry.source !== source) continue;
      entry.pending = false;
      if (kind) entry.kind = kind;
      changed = true;
    }
    return changed;
  }

  /** A one-off entry that is already done (a receipt, a transition, a note). */
  log(source: string, text: string, kind: ActivityKind = "info", at = Date.now()): void {
    this.activity = bounded([...this.activity, { id: this.nextId++, at, source, text, kind, pending: false }], MAX_ACTIVITY);
    this.touch();
  }

  /** Open an in-flight step; `key` lets `end` settle exactly this one. */
  begin(source: string, text: string, key?: string, at = Date.now()): void {
    this.activity = bounded([...this.activity, { id: this.nextId++, at, source, text, kind: "info", pending: true, ...(key ? { key } : {}) }], MAX_ACTIVITY);
    this.touch();
  }

  /** Settle the step opened with `key`; an error marks it. */
  end(key: string, isError = false): void {
    if (this.settle(undefined, key, isError ? "error" : undefined)) this.touch();
  }

  /** The next step of an agent that reports one step at a time: the previous one settles. */
  step(source: string, text: string, key: string, at = Date.now()): void {
    this.settle(undefined, key);
    this.begin(source, text, key, at);
  }

  /** Stream the Master's (or any source's) live thought. */
  thinkDelta(source: string, delta: string, at = Date.now()): void {
    const last = this.thoughts.at(-1);
    if (last && last.live && last.source === source) {
      const text = last.text + delta;
      last.text = text.length > MAX_THOUGHT_TEXT ? text.slice(-MAX_THOUGHT_TEXT) : text;
    } else {
      this.thoughts = bounded([...this.thoughts, { id: this.nextId++, at, source, text: delta.slice(-MAX_THOUGHT_TEXT), live: true }], MAX_THOUGHTS);
    }
    this.touch();
  }

  /** Close the live thought of `source`, replacing it with the final text when given. */
  thinkEnd(source: string, text?: string): void {
    const last = [...this.thoughts].reverse().find((entry) => entry.source === source && entry.live);
    if (!last) {
      if (text?.trim()) this.thought(source, text);
      return;
    }
    last.live = false;
    if (text?.trim()) last.text = text.trim().slice(-MAX_THOUGHT_TEXT);
    if (!last.text.trim()) this.thoughts = this.thoughts.filter((entry) => entry !== last);
    this.touch();
  }

  /** A finished thought from an agent that reports whole thoughts (subagents). */
  thought(source: string, text: string, at = Date.now()): void {
    const body = text.trim();
    if (!body) return;
    this.thoughts = bounded([...this.thoughts, { id: this.nextId++, at, source, text: body.slice(-MAX_THOUGHT_TEXT), live: false }], MAX_THOUGHTS);
    this.touch();
  }

  /** Stream the oracle's reply text as it arrives. */
  replyDelta(delta: string): void {
    this.reply = (this.reply + delta).slice(-MAX_THOUGHT_TEXT);
    this.touch();
  }

  /** The streamed reply is over; `say` records the final message. */
  replyEnd(): void {
    if (!this.reply) return;
    this.reply = "";
    this.touch();
  }

  say(role: ChatRole, text: string, at = Date.now()): void {
    const body = text.trim();
    if (!body) return;
    this.chat = bounded([...this.chat, { id: this.nextId++, at, role, text: body }], MAX_CHAT);
    this.touch();
  }

  /** Replace the conversation (seeding from the session when the lobby first opens). */
  seedChat(entries: ReadonlyArray<{ role: ChatRole; text: string; at?: number }>): void {
    this.chat = bounded(entries.filter((entry) => entry.text.trim()).map((entry) => ({ id: this.nextId++, at: entry.at ?? 0, role: entry.role, text: entry.text.trim() })), MAX_CHAT);
    this.touch();
  }

  /**
   * Fold streamed subagent run updates into the log: each new plain-words step
   * opens an entry (settling the previous one), each new thought lands in the
   * thinking pane, and a finished run settles with its outcome.
   */
  runs(runs: readonly AgentRun[], at = Date.now()): void {
    for (const run of runs) {
      const source = agentName(run);
      const key = run.runId;
      const before = this.runStatus.get(key);
      this.runStatus.set(key, run.status);
      if (before === undefined) this.log(source, `started as ${run.role}`, "info", at);
      if (run.step && this.runSteps.get(key) !== run.step) {
        this.runSteps.set(key, run.step);
        this.step(source, run.step, key, at);
      }
      if (run.thought && this.runThoughts.get(key) !== run.thought) {
        this.runThoughts.set(key, run.thought);
        this.thought(source, run.thought, at);
      }
      if (run.status !== "running" && before !== run.status) {
        this.settle(undefined, key);
        const kind: ActivityKind = run.status === "success" ? (run.wrappedUp ? "warning" : "success") : run.status === "cancelled" ? "warning" : "error";
        this.log(source, `${run.role} ${run.status === "success" ? "finished" : run.status}${run.error ? ` — ${run.error.split("\n")[0]}` : ""}`, kind, at);
      }
    }
  }

  clear(): void {
    this.activity = [];
    this.thoughts = [];
    this.chat = [];
    this.reply = "";
    this.runSteps.clear();
    this.runThoughts.clear();
    this.runStatus.clear();
    this.touch();
  }
}

/** The process-wide lobby feed; the Master session is the only writer that matters. */
export const lobbyFeed = new LobbyFeed();

/** The text parts of a message's content, joined; thinking and tool calls are dropped. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => typeof part === "object" && part !== null && (part as { type?: string }).type === "text" && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
}

/** The long kickoff message bot-lobby sends reads as a short note in the conversation. */
export function chatText(role: "user" | "assistant", text: string): { role: ChatRole; text: string } | undefined {
  const body = text.trim();
  if (!body) return undefined;
  if (role === "assistant") return { role: "oracle", text: body };
  const kickoff = /^A bot-lobby task is active: (\S+)\nTitle: (.*)/.exec(body);
  if (kickoff) return { role: "note", text: `task ${kickoff[1]} started — ${kickoff[2]}` };
  const comment = /^The user left (?:a comment|\d+ comments) on (the approved plan|the proposal) of (\S+) from the lobby:/.exec(body);
  if (comment) return { role: "note", text: `plan comment sent to the oracle for ${comment[2]}` };
  return { role: "you", text: body };
}

/** Session entries (`{ type: "message", message }`) as conversation entries, oldest first. */
export function chatFromEntries(entries: readonly unknown[], max = MAX_CHAT): Array<{ role: ChatRole; text: string; at?: number }> {
  const chat: Array<{ role: ChatRole; text: string; at?: number }> = [];
  for (const entry of entries) {
    const record = entry as { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
    if (record?.type !== "message") continue;
    const role = record.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const line = chatText(role, textOf(record.message?.content));
    if (!line) continue;
    const at = record.timestamp ? Date.parse(record.timestamp) : undefined;
    chat.push({ ...line, ...(at !== undefined && Number.isFinite(at) ? { at } : {}) });
  }
  return chat.slice(-max);
}
