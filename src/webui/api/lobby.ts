/**
 * The Lobby tab over HTTP: one snapshot (task header, runs, newest chat,
 * streaming reply, activity, thoughts, older-chat flag), older chat history,
 * sending text to the oracle, and stopping its turn. Bounds come from the
 * feed module, so the page sees exactly what the terminal keeps.
 */
import { MAX_ACTIVITY, MAX_CHAT, MAX_THOUGHTS } from "../../lobby/feed.ts";
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";
import type { LobbySnapshot } from "../protocol.ts";

function taskOf(ctx: ApiContext): LobbySnapshot["task"] {
  const task = ctx.service.zen().task;
  if (!task) return undefined;
  return { id: task.id, title: task.title, state: task.state };
}

/** What the Lobby tab shows, read in one call. */
export function lobbySnapshot(ctx: ApiContext): LobbySnapshot {
  const service = ctx.service;
  const feed = service.feed;
  const reply = feed.reply;
  return {
    ...(taskOf(ctx) ? { task: taskOf(ctx)! } : {}),
    runs: [...service.zen().runs],
    chat: feed.chat.slice(-MAX_CHAT).map((entry) => ({ id: entry.id, at: entry.at, role: entry.role, text: entry.text })),
    ...(reply ? { reply } : {}),
    activity: feed.activity.slice(-MAX_ACTIVITY).map((entry) => ({
      id: entry.id,
      at: entry.at,
      source: entry.source,
      text: entry.text,
      kind: entry.kind,
      pending: entry.pending,
    })),
    thoughts: feed.thoughts.slice(-MAX_THOUGHTS).map((entry) => ({
      id: entry.id,
      at: entry.at,
      source: entry.source,
      text: entry.text,
      live: entry.live,
    })),
    hasOlderChat: feed.chatOlder,
  };
}

/** Older chat from the session file, before `before` (newest 50, oldest first). */
export function lobbyHistory(body: { before?: number }, ctx: ApiContext): { entries: unknown[]; hasOlder: boolean } {
  const all = [...ctx.service.chatHistory()];
  const older = body.before === undefined ? all : all.filter((entry) => entry.id < body.before!);
  const entries = older.slice(-50);
  return { entries, hasOlder: older.length > entries.length };
}

/** Text for the oracle; a notice when it was not simply sent. */
export function lobbySend(body: { text: string }, ctx: ApiContext): { notice?: string } {
  if (!body.text.trim()) return { notice: "type something first" };
  const notice = ctx.service.toOracle(body.text);
  return notice ? { notice } : {};
}

/** Stop the oracle's turn. */
export function lobbyAbort(ctx: ApiContext): Record<string, never> {
  try {
    ctx.service.abortMaster();
  } catch (error) {
    fail(500, "failed", (error as Error).message);
  }
  return {};
}
