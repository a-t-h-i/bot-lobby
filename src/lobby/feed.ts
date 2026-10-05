/**
 * What the lobby narrates: an activity log of plain-words tool steps from the
 * Master and every subagent, a single place for thoughts, and the conversation
 * with the Master stripped of tool rows and thinking. Bounded ring buffers in
 * one module-level store (like the task state in ui.ts), so every event source can
 * write without a reference to the lobby, and the lobby repaints on `version`.
 */
import type { AgentRun } from "../schemas/findings.ts";
import { agentName } from "../pi/run-summary.ts";
import { markdownBlocks } from "./blocks.ts";

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
/** Messages the conversation keeps in memory; earlier ones are loaded from the session when scrolled to. */
export const MAX_CHAT = 100;
/** Longest thought kept; a streaming thought keeps its newest text. */
export const MAX_THOUGHT_TEXT = 4000;
/** The streaming reply kept: several panes' worth; past it, whole blocks are dropped from its start. */
export const MAX_REPLY_TEXT = 8000;

function bounded<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(-max) : list;
}

export class LobbyFeed {
  activity: ActivityEntry[] = [];
  thoughts: ThoughtEntry[] = [];
  chat: ChatEntry[] = [];
  /** The oracle's reply while it streams; cleared when the message ends. */
  reply = "";
  /** Earlier messages than `chat` holds exist in the session (loaded only when scrolled back to). */
  chatOlder = false;
  version = 0;
  private nextId = 1;
  private readonly listeners = new Set<() => void>();
  /** Last step reported per run, so repeated run updates log each step once. */
  private readonly runSteps = new Map<string, string>();
  private readonly runThoughts = new Map<string, string>();
  /** The live whole thought of each piece of work still under way (a run, a quick fix, a review), by its key. */
  private readonly liveThoughts = new Map<string, number>();
  private readonly runStatus = new Map<string, AgentRun["status"]>();
  /** Runs already reported as switched to their fallback model. */

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
    this.pushActivity({ id: this.nextId++, at, source, text, kind, pending: false });
    this.touch();
  }

  /** Open an in-flight step; `key` lets `end` settle exactly this one. */
  begin(source: string, text: string, key?: string, at = Date.now()): void {
    this.pushActivity({ id: this.nextId++, at, source, text, kind: "info", pending: true, ...(key ? { key } : {}) });
    this.touch();
  }

  /** Append in place (a busy agent logs many steps a second), dropping the oldest past the limit. */
  private pushActivity(entry: ActivityEntry): void {
    this.activity.push(entry);
    if (this.activity.length > MAX_ACTIVITY) this.activity.splice(0, this.activity.length - MAX_ACTIVITY);
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
    // The source's own streaming entry, even when another agent's thought landed after it.
    const keyed = new Set(this.liveThoughts.values());
    const last = [...this.thoughts].reverse().find((entry) => entry.live && entry.source === source && !keyed.has(entry.id));
    if (last) {
      const text = last.text + delta;
      last.text = text.length > MAX_THOUGHT_TEXT ? trimThought(text) : text;
    } else {
      this.thoughts = bounded([...this.thoughts, { id: this.nextId++, at, source, text: delta.slice(-MAX_THOUGHT_TEXT), live: true }], MAX_THOUGHTS);
    }
    this.touch();
  }

  /** Close the live thought of `source`, replacing it with the final text when given. */
  thinkEnd(source: string, text?: string): void {
    const keyed = new Set(this.liveThoughts.values());
    const last = [...this.thoughts].reverse().find((entry) => entry.source === source && entry.live && !keyed.has(entry.id));
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

  /**
   * A whole thought from work still under way (`key`: its run, quick fix or
   * review): live, so the Thinking orb takes its agent's colour, until the
   * same work's next thought or `settleThought(key)` when it ends.
   */
  liveThought(source: string, text: string, key: string, at = Date.now()): void {
    const body = text.trim();
    if (!body) return;
    this.settleThought(key, false);
    const entry: ThoughtEntry = { id: this.nextId++, at, source, text: body.slice(-MAX_THOUGHT_TEXT), live: true };
    this.thoughts = bounded([...this.thoughts, entry], MAX_THOUGHTS);
    this.liveThoughts.set(key, entry.id);
    this.touch();
  }

  /** The work behind `key` has ended: its last thought is no longer live. */
  settleThought(key: string, touch = true): void {
    const id = this.liveThoughts.get(key);
    if (id === undefined) return;
    this.liveThoughts.delete(key);
    const entry = this.thoughts.find((thought) => thought.id === id);
    if (!entry?.live) return;
    entry.live = false;
    if (touch) this.touch();
  }

  /** Stream the oracle's reply text as it arrives. */
  replyDelta(delta: string): void {
    this.reply = trimReply(this.reply + delta);
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
    this.chat.push({ id: this.nextId++, at, role, text: body });
    if (this.chat.length > MAX_CHAT) {
      this.chat.splice(0, this.chat.length - MAX_CHAT);
      this.chatOlder = true;
    }
    this.touch();
  }

  /** Replace the conversation (seeding from the session when the lobby first opens); only the newest `MAX_CHAT` are kept. */
  seedChat(entries: ReadonlyArray<{ role: ChatRole; text: string; at?: number }>): void {
    const kept = entries.filter((entry) => entry.text.trim());
    this.chatOlder = kept.length > MAX_CHAT;
    this.chat = kept.slice(-MAX_CHAT).map((entry) => ({ id: this.nextId++, at: entry.at ?? 0, role: entry.role, text: entry.text.trim() }));
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
        // Live while the run goes on: the orb shows who is thinking, not only the oracle.
        if (run.status === "running") this.liveThought(source, run.thought, key, at);
        else this.thought(source, run.thought, at);
      }
      if (run.status !== "running") this.settleThought(key);
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
    this.chatOlder = false;
    this.reply = "";
    this.runSteps.clear();
    this.runThoughts.clear();
    this.liveThoughts.clear();
    this.runStatus.clear();
    this.touch();
  }
}

/** A streaming thought past `MAX_THOUGHT_TEXT` cut to three quarters of it from a word's start, so its start then holds still a while. */
function trimThought(text: string): string {
  const cut = text.slice(-Math.floor(MAX_THOUGHT_TEXT * 0.75));
  const space = cut.search(/\s/);
  return space >= 0 && space < 80 ? cut.slice(space + 1) : cut;
}

/**
 * A streaming reply past `max` characters cut down to three quarters of that
 * (so its start then holds still for a while) by dropping whole Markdown
 * blocks from its start, so what is left renders as it did (a cut inside a
 * code block would turn the rest of the reply inside out). A single block
 * longer than that keeps its end, and its opening fence if it is code.
 */
export function trimReply(text: string, max = MAX_REPLY_TEXT): string {
  if (text.length <= max) return text;
  const target = Math.floor(max * 0.75);
  const blocks = markdownBlocks(text);
  let length = text.length;
  let first = 0;
  // Each dropped block takes the blank line after it too.
  while (first < blocks.length - 1 && length > target) length -= blocks[first++]!.length + 2;
  if (length <= target) return blocks.slice(first).join("\n\n");
  const last = blocks.at(-1) ?? text;
  const opener = /^ {0,3}(?:`{3,}|~{3,}).*\n/.exec(last)?.[0] ?? "";
  const rest = last.slice(opener.length);
  const cut = rest.slice(-(target - opener.length));
  // From a line start, so no line (or code) is shown half cut.
  const line = cut.indexOf("\n");
  return `${opener}${line >= 0 && line < cut.length - 1 ? cut.slice(line + 1) : cut}`;
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
export function chatText(role: "user" | "assistant", text: string): Array<{ role: ChatRole; text: string }> {
  const body = text.trim();
  if (!body) return [];
  if (role === "assistant") return [{ role: "oracle", text: body }];
  // bot-lobby's kickoff: the task starting, then what the user asked for, in their words.
  const kickoff = /^A bot-lobby task is active: (\S+)\nTitle: (.*)/.exec(body);
  if (kickoff) {
    const request = /\nRequest: ([\s\S]*?)(?:\nState: |$)/.exec(body)?.[1]?.trim();
    // A request the oracle routed to the team is already in the conversation, under the routing note.
    const shown = /\nRouted: /.test(body);
    return [{ role: "note", text: `task started · ${kickoff[2]}` }, ...(request && !shown ? [{ role: "you" as const, text: request }] : [])];
  }
  // A new request the classifier read as a quick fix, before the oracle confirms where it goes.
  const routing = /^bot-lobby: a new request, not a task yet\.\nRequest: ([\s\S]*?)\nRead: /.exec(body);
  if (routing) return [{ role: "you", text: routing[1]!.trim() }, { role: "note", text: "reads as a quick fix · the oracle confirms where it goes" }];
  const comment = /^The user left (?:a comment|\d+ comments) on (the approved plan|the proposal) of (\S+) from the lobby:/.exec(body);
  if (comment) return [{ role: "note", text: `your comment on ${comment[1]} went to the oracle` }];
  return [{ role: "you", text: body }];
}

/** The session entry bot-lobby leaves where the oracle's context starts over (see pi/fresh-context.ts). */
export const CONTEXT_MARK = "bot-lobby-context";

/** What the conversation shows where a task's end cleared the oracle's context. */
export const CLEARED_NOTE = "context cleared · the next request starts fresh";

/** Whether a session entry is where a finished task cleared the oracle's context. */
export function isClearedMark(entry: unknown): boolean {
  const record = entry as { type?: string; customType?: string; data?: { kind?: unknown } } | undefined;
  return record?.type === "custom" && record.customType === CONTEXT_MARK && record.data?.kind === "end";
}

/** Session entries (`{ type: "message", message }`) as conversation entries, oldest first. */
export function chatFromEntries(entries: readonly unknown[], max = MAX_CHAT): Array<{ role: ChatRole; text: string; at?: number }> {
  const chat: Array<{ role: ChatRole; text: string; at?: number }> = [];
  for (const entry of entries) {
    const record = entry as { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
    if (isClearedMark(entry)) {
      const at = record.timestamp ? Date.parse(record.timestamp) : Number.NaN;
      chat.push({ role: "note", text: CLEARED_NOTE, ...(Number.isFinite(at) ? { at } : {}) });
      continue;
    }
    if (record?.type !== "message") continue;
    const role = record.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const at = record.timestamp ? Date.parse(record.timestamp) : undefined;
    for (const line of chatText(role, textOf(record.message?.content))) chat.push({ ...line, ...(at !== undefined && Number.isFinite(at) ? { at } : {}) });
  }
  return chat.slice(-max);
}

/** The parts of pi's agent events the lobby narrates; the same shape in process and over RPC. */
export interface AgentEventLike {
  type: string;
  toolName?: string;
  args?: unknown;
  toolCallId?: string;
  isError?: boolean;
  assistantMessageEvent?: { type: string; delta?: string; content?: string };
  message?: { role?: string; content?: unknown; stopReason?: string; errorMessage?: string };
}

/**
 * One of a Master's agent events into a feed: tool calls become plain-words
 * activity, thinking goes to the thinking pane, the reply streams, and
 * finished messages join the conversation (a failed turn says so there too).
 */
export function narrateEvent(feed: LobbyFeed, event: AgentEventLike, describe: (toolName: string, args: unknown) => string): void {
  switch (event.type) {
    case "tool_execution_start":
      feed.begin("MASTER", describe(event.toolName ?? "tool", event.args), event.toolCallId);
      return;
    case "tool_execution_end":
      if (event.toolCallId) feed.end(event.toolCallId, event.isError === true);
      return;
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update?.type === "thinking_delta" && update.delta) feed.thinkDelta("MASTER", update.delta);
      else if (update?.type === "thinking_end") feed.thinkEnd("MASTER", update.content);
      else if (update?.type === "text_delta" && update.delta) feed.replyDelta(update.delta);
      return;
    }
    case "message_end": {
      const message = event.message ?? {};
      if (message.role === "assistant") {
        feed.replyEnd();
        feed.thinkEnd("MASTER");
        if (message.stopReason === "error") {
          const error = (message.errorMessage ?? "the model call failed").split("\n")[0]!;
          feed.say("note", `✗ the oracle's turn failed: ${error}`);
          feed.log("MASTER", `turn failed — ${error}`, "error");
        }
      }
      if (message.role !== "user" && message.role !== "assistant") return;
      for (const line of chatText(message.role, textOf(message.content))) feed.say(line.role, line.text);
      return;
    }
    case "agent_end":
      feed.replyEnd();
      return;
    default:
      return;
  }
}
