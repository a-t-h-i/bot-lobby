/**
 * Plan comments: notes the user leaves on a task's approved plan (or its
 * proposal) from the lobby, in any pi session. They live beside the task as an
 * append-only JSON-lines log, never inside state.json, because the owning
 * session rewrites state.json at the end of every workflow step and would
 * silently drop a comment written by another session in the meantime.
 *
 * Each line is one event: a comment, its delivery to the owning Master, or the
 * Master addressing it with an amended plan. Reading folds the events.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { taskDir } from "../knowledge/paths.ts";
import { dataRoot } from "./project.ts";

export type CommentStatus = "open" | "delivered" | "addressed";

export interface PlanComment {
  id: string;
  taskId: string;
  text: string;
  createdAt: string;
  /** The pi session that wrote the comment, when known. */
  by?: string;
  status: CommentStatus;
  deliveredAt?: string;
  addressedAt?: string;
}

type CommentEvent =
  | { kind: "comment"; id: string; text: string; at: string; by?: string }
  | { kind: "delivered"; id: string; at: string }
  | { kind: "addressed"; id: string; at: string };

/** Longest comment kept; the Master gets it verbatim. */
export const MAX_COMMENT_CHARS = 2000;

export function commentsPath(root: string, configDir: string, taskId: string): string {
  return join(taskDir(dataRoot(root, configDir), taskId), "comments.jsonl");
}

function append(path: string, event: CommentEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

function readEvents(path: string): CommentEvent[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const events: CommentEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as CommentEvent;
      if (event && typeof event.id === "string" && typeof event.kind === "string") events.push(event);
    } catch {
      // A torn line from a crashed writer is skipped, never fatal.
    }
  }
  return events;
}

/** Fold the event log into comments, oldest first. */
export function foldComments(taskId: string, events: readonly CommentEvent[]): PlanComment[] {
  const byId = new Map<string, PlanComment>();
  for (const event of events) {
    if (event.kind === "comment") {
      if (byId.has(event.id)) continue;
      byId.set(event.id, { id: event.id, taskId, text: event.text, createdAt: event.at, ...(event.by ? { by: event.by } : {}), status: "open" });
      continue;
    }
    const comment = byId.get(event.id);
    if (!comment) continue;
    if (event.kind === "delivered" && comment.status === "open") {
      comment.status = "delivered";
      comment.deliveredAt = event.at;
    } else if (event.kind === "addressed" && comment.status !== "addressed") {
      comment.status = "addressed";
      comment.addressedAt = event.at;
    }
  }
  return [...byId.values()];
}

export function readPlanComments(root: string, configDir: string, taskId: string): PlanComment[] {
  return foldComments(taskId, readEvents(commentsPath(root, configDir, taskId)));
}

/** Record a new comment; blank text is refused. */
export function addPlanComment(root: string, configDir: string, taskId: string, text: string, by?: string, now = new Date()): PlanComment {
  const body = text.trim().slice(0, MAX_COMMENT_CHARS);
  if (!body) throw new Error("a plan comment needs some text");
  const at = now.toISOString();
  const id = `C-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  append(commentsPath(root, configDir, taskId), { kind: "comment", id, text: body, at, ...(by ? { by } : {}) });
  return { id, taskId, text: body, createdAt: at, ...(by ? { by } : {}), status: "open" };
}

export function markCommentsDelivered(root: string, configDir: string, taskId: string, ids: readonly string[], now = new Date()): void {
  const path = commentsPath(root, configDir, taskId);
  for (const id of ids) append(path, { kind: "delivered", id, at: now.toISOString() });
}

export function markCommentsAddressed(root: string, configDir: string, taskId: string, ids: readonly string[], now = new Date()): void {
  const path = commentsPath(root, configDir, taskId);
  for (const id of ids) append(path, { kind: "addressed", id, at: now.toISOString() });
}

/** Comments the owning Master has not been told about yet. */
export function undeliveredComments(comments: readonly PlanComment[]): PlanComment[] {
  return comments.filter((comment) => comment.status === "open");
}

/** Comments the plan does not reflect yet: new or delivered but not addressed. */
export function pendingComments(comments: readonly PlanComment[]): PlanComment[] {
  return comments.filter((comment) => comment.status !== "addressed");
}

/**
 * The message the owning Master receives for new comments: plan comments ask
 * for an amended plan, comments before a plan exists ask for a new proposal.
 */
export function commentMessage(taskId: string, comments: readonly PlanComment[], hasPlan: boolean): string {
  const noun = comments.length === 1 ? "a comment" : `${comments.length} comments`;
  const target = hasPlan ? "the approved plan" : "the proposal";
  const lines = comments.map((comment) => `- ${comment.text.replace(/\s*\n\s*/g, " ")}`);
  const ask = hasPlan
    ? "Amend the plan to address them: call orchestrate action=plan with the full revised plan (it replaces the current one and marks these comments addressed), then continue the work. If a comment needs no change, say why."
    : "Take them into account: revise the proposal and call orchestrate action=propose again.";
  return [`The user left ${noun} on ${target} of ${taskId} from the lobby:`, ...lines, "", ask].join("\n");
}
