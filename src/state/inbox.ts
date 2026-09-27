/**
 * The task inbox: messages for a task's oracle written from any pi session
 * (the lobby of another window talking to a task it does not drive). Like plan
 * comments they live beside the task as an append-only JSON-lines log, never
 * inside state.json, and the session that owns the task delivers them to its
 * Master and records the delivery.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { taskDirFor } from "./persistence.ts";

export interface InboxMessage {
  id: string;
  taskId: string;
  text: string;
  createdAt: string;
  /** The pi session that wrote it. */
  by?: string;
  delivered: boolean;
}

type InboxEvent =
  | { kind: "message"; id: string; text: string; at: string; by?: string }
  | { kind: "delivered"; id: string; at: string };

/** Longest message kept; the Master gets it verbatim. */
export const MAX_INBOX_CHARS = 4000;

export function inboxPath(root: string, configDir: string, taskId: string): string {
  return join(taskDirFor(root, configDir, taskId), "inbox.jsonl");
}

function append(path: string, event: InboxEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

function readEvents(path: string): InboxEvent[] {
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const events: InboxEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as InboxEvent;
      if (event && typeof event.id === "string" && typeof event.kind === "string") events.push(event);
    } catch {
      // A torn line from a crashed writer is skipped, never fatal.
    }
  }
  return events;
}

/** The task's messages, oldest first, with whether each reached the oracle. */
export function readInbox(root: string, configDir: string, taskId: string): InboxMessage[] {
  const byId = new Map<string, InboxMessage>();
  for (const event of readEvents(inboxPath(root, configDir, taskId))) {
    if (event.kind === "message" && !byId.has(event.id)) {
      byId.set(event.id, { id: event.id, taskId, text: event.text, createdAt: event.at, ...(event.by ? { by: event.by } : {}), delivered: false });
    } else if (event.kind === "delivered") {
      const message = byId.get(event.id);
      if (message) message.delivered = true;
    }
  }
  return [...byId.values()];
}

/** Leave a message for the task's oracle; returns it. */
export function sendToInbox(root: string, configDir: string, taskId: string, text: string, by?: string, now = new Date()): InboxMessage {
  const body = text.trim().slice(0, MAX_INBOX_CHARS);
  if (!body) throw new Error("a message needs some text");
  const id = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  append(inboxPath(root, configDir, taskId), { kind: "message", id, text: body, at: now.toISOString(), ...(by ? { by } : {}) });
  return { id, taskId, text: body, createdAt: now.toISOString(), ...(by ? { by } : {}), delivered: false };
}

export function markInboxDelivered(root: string, configDir: string, taskId: string, ids: readonly string[], now = new Date()): void {
  for (const id of ids) append(inboxPath(root, configDir, taskId), { kind: "delivered", id, at: now.toISOString() });
}

/** The message the owning session sends its Master for undelivered inbox messages. */
export function inboxMessage(messages: readonly InboxMessage[]): string {
  if (messages.length === 1) return messages[0]!.text;
  return messages.map((message) => message.text).join("\n\n");
}
