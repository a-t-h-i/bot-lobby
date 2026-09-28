/**
 * A clean slate for the oracle at every task. The session keeps its whole
 * conversation (the lobby, /tree and /resume still show all of it), but the
 * model is sent only what came after the latest task boundary: a task
 * starting in this session, or this session's task ending. So one long
 * session no longer carries every past task into every call; the task in
 * hand reaches the oracle through bot-lobby's system prompt section and its
 * task folder, which do not depend on the conversation.
 *
 * A boundary is a custom entry in the session file, which is never sent to
 * the model: it survives /resume and belongs to the branch it was made on.
 * Subagents (scouts, workers, reviewers, the planning panel, quick fixes)
 * already run as pi processes of their own, each with its own context, and
 * are not touched here.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { relative } from "node:path";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { peekTasks, taskDirFor } from "../state/persistence.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { CLEARED_NOTE, CONTEXT_MARK, lobbyFeed } from "../lobby/feed.ts";
import { isSubagentProcess } from "./quiet.ts";

export { CLEARED_NOTE, CONTEXT_MARK };

export interface ContextMark {
  kind: "start" | "end";
  taskId: string;
  /** Messages from this time on (ms) are what the model is sent. */
  at: number;
}

/** The boundaries on a session branch, oldest first. */
export function contextMarks(entries: readonly unknown[]): ContextMark[] {
  const marks: ContextMark[] = [];
  for (const entry of entries) {
    const mark = asMark(entry);
    if (mark) marks.push(mark);
  }
  return marks;
}

/** A session entry as a boundary, when it is one. */
export function asMark(entry: unknown): ContextMark | undefined {
  const record = entry as { type?: string; customType?: string; data?: Partial<ContextMark> } | undefined;
  if (record?.type !== "custom" || record.customType !== CONTEXT_MARK) return undefined;
  const data = record.data;
  if (!data || typeof data.at !== "number" || typeof data.taskId !== "string" || (data.kind !== "start" && data.kind !== "end")) return undefined;
  return { kind: data.kind, taskId: data.taskId, at: data.at };
}

/** Replies and tool results answer what came before them, so what the model is sent never opens with one. */
const ANSWERS = new Set(["assistant", "toolResult"]);

/**
 * The messages from the boundary on: from the first one at or after it that
 * can open a conversation (a request, a summary, an extension's message).
 * All of them when nothing has come since the boundary (a task that ended
 * mid-run still gets its closing turn).
 */
export function fromBoundary<T extends { role: string; timestamp?: number }>(messages: T[], boundary: number | undefined): T[] {
  if (boundary === undefined) return messages;
  const start = messages.findIndex((message) => typeof message.timestamp === "number" && message.timestamp >= boundary && !ANSWERS.has(message.role));
  return start <= 0 ? messages : messages.slice(start);
}

/** Whether the oracle starts clean at each task (`workflow.freshContext`, on by default). */
export function freshContextOn(): boolean {
  return loadConfig().workflow.freshContext;
}

/** Record a boundary in this session. */
export function markContext(pi: ExtensionAPI, mark: ContextMark): void {
  pi.appendEntry<ContextMark>(CONTEXT_MARK, mark);
  if (mark.kind === "end") lobbyFeed.say("note", CLEARED_NOTE, mark.at);
}

/** The session's newest task: the one its conversation was last about. */
function lastTask(ctx: ExtensionContext, configDir: string): Task | undefined {
  const sessionId = ctx.sessionManager.getSessionId();
  return peekTasks(detectProjectRoot(ctx.cwd, configDir), configDir).find((task) => task.ownerSessionId === sessionId);
}

/** Close the session's task once it has ended (completed or abandoned): the next request starts clean. */
export function closeEndedTask(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string, now = Date.now()): boolean {
  if (isSubagentProcess() || !freshContextOn()) return false;
  const task = lastTask(ctx, configDir);
  if (!task || !TERMINAL_STATES.includes(task.state)) return false;
  if (contextMarks(ctx.sessionManager.getBranch()).some((mark) => mark.kind === "end" && mark.taskId === task.id)) return false;
  markContext(pi, { kind: "end", taskId: task.id, at: now });
  return true;
}

/**
 * The note bot-lobby's system prompt section carries after a task ended and
 * cleared the context: which task it was and where its record is, for when
 * the user refers back to it.
 */
export function previousTaskNote(ctx: ExtensionContext, configDir: string): string | undefined {
  if (!freshContextOn()) return undefined;
  const last = contextMarks(ctx.sessionManager.getBranch()).at(-1);
  if (last?.kind !== "end") return undefined;
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = peekTasks(root, configDir).find((entry) => entry.id === last.taskId);
  if (!task) return undefined;
  const record = relative(ctx.cwd, taskDirFor(root, configDir, task.id)) || ".";
  return [
    `Your previous task, ${task.id} "${task.title}", ended (${task.state}). Its conversation was cleared from your context so the next piece of work starts fresh.`,
    `Its record (request, proposal, plan, decisions, runs) is in ${record}/. Read it only if the user refers back to that task.`,
  ].join("\n");
}

/** Trim what the oracle is sent to its latest boundary, and close tasks as they end. */
export function registerFreshContext(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  pi.on("context", (event, ctx) => {
    if (!freshContextOn()) return undefined;
    const boundary = contextMarks(ctx.sessionManager.getBranch()).at(-1)?.at;
    const messages = fromBoundary(event.messages, boundary);
    return messages.length === event.messages.length ? undefined : { messages };
  });
  // A task's last turn is over: whatever is asked next starts clean.
  pi.on("agent_end", (_event, ctx) => void closeEndedTask(pi, ctx, configDir));
  // It may have ended while the oracle was idle (abandoned or archived from the lobby, finished in another window).
  pi.on("before_agent_start", (_event, ctx) => void closeEndedTask(pi, ctx, configDir));
  // Compacting a conversation the next request drops anyway would only cost a model call.
  pi.on("session_before_compact", (event) => {
    if (event.reason === "manual" || !freshContextOn()) return undefined;
    const last = contextMarks(event.branchEntries).at(-1);
    if (!last) return undefined;
    const since = event.branchEntries.some((entry) => entry.type === "message" && Date.parse(entry.timestamp) >= last.at);
    return since ? undefined : { cancel: true };
  });
}
