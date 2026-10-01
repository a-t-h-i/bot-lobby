/**
 * Lobby notices that reach the web page as toasts. Two sources: the `notice`
 * on an action's API reply, and the feed's LOBBY warnings and errors (info
 * and success stay activity lines, not toasts). A later web server forwards
 * each one on the event stream and bumps the `notices` topic. Process-global
 * like the feed, so a notice raised before the server starts is simply lost.
 */
import type { ActivityKind, LobbyFeed } from "../lobby/feed.ts";

export type NoticeLevel = "info" | "success" | "warning" | "error";

export interface Notice {
  text: string;
  level: NoticeLevel;
}

type NoticeListener = (notice: Notice) => void;

const listeners = new Set<NoticeListener>();

/** Tell every listener; blank text is dropped. */
export function pushNotice(text: string, level: NoticeLevel = "info"): void {
  const body = text.trim();
  if (!body) return;
  for (const listener of [...listeners]) listener({ text: body, level });
}

/** Hear every notice; returns the unsubscribe function. */
export function onNotice(listener: NoticeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The `notice` string on an API reply, when it carries one. */
export function noticeText(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const notice = (result as { notice?: unknown }).notice;
  return typeof notice === "string" && notice.trim() ? notice : undefined;
}

/**
 * Forward the feed's LOBBY warnings and errors as notices. Entries already in
 * the feed when this is called are not replayed, so a rebind does not re-toast
 * the log; returns the unsubscribe function.
 */
export function watchFeed(feed: LobbyFeed): () => void {
  let after = feed.activity.at(-1)?.id ?? 0;
  return feed.onChange(() => {
    for (const entry of feed.activity) {
      if (entry.id <= after) continue;
      if (entry.source === "LOBBY" && (entry.kind === "warning" || entry.kind === "error")) pushNotice(entry.text, kindLevel(entry.kind));
    }
    after = feed.activity.at(-1)?.id ?? after;
  });
}

function kindLevel(kind: ActivityKind): NoticeLevel {
  return kind;
}
