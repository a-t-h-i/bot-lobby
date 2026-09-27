/**
 * Other sessions' conversations, read from their saved pi session files. A
 * task another terminal drives has no live feed in this window, so the lobby
 * shows what its session file holds: the current branch's user and assistant
 * messages, reread whenever the file changes.
 */
import { readFileSync, statSync } from "node:fs";
import { chatFromEntries, MAX_CHAT, type ChatEntry } from "./feed.ts";

interface EntryLike {
  type?: string;
  id?: string;
  parentId?: string | null;
}

/** The entries on the branch that ends at the newest entry, oldest first (a session file is a tree). */
export function currentBranch(entries: readonly unknown[]): unknown[] {
  const byId = new Map<string, EntryLike>();
  let leaf: EntryLike | undefined;
  for (const entry of entries) {
    const record = entry as EntryLike;
    if (!record || typeof record.id !== "string") continue;
    byId.set(record.id, record);
    leaf = record;
  }
  const branch: unknown[] = [];
  const seen = new Set<string>();
  for (let entry = leaf; entry?.id && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
    seen.add(entry.id);
    branch.push(entry);
  }
  return branch.reverse();
}

/** Parse a session file's JSON lines, skipping torn ones. */
export function parseEntries(text: string): unknown[] {
  const entries: unknown[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A line being written right now; the next read has it.
    }
  }
  return entries;
}

/** The conversation a session file holds, as the lobby's chat entries. */
export function chatFromFile(text: string, max = MAX_CHAT): ChatEntry[] {
  return chatFromEntries(currentBranch(parseEntries(text)), max).map((line, index) => ({ id: index + 1, at: line.at ?? 0, role: line.role, text: line.text }));
}

/** How the cache finds session files: pi's session list, id → path. */
export type SessionLister = () => Promise<ReadonlyArray<{ id: string; path: string }>>;

/** How often the id → path map is refreshed while someone looks. */
export const LIST_REFRESH_MS = 5000;

/**
 * Chats of sessions by id, cached per file and reread only when its size or
 * mtime changes. Finding a file is async (pi lists sessions from disk), so the
 * first look returns nothing and `onChange` fires once new files are known.
 */
export class SessionChats {
  private paths = new Map<string, string>();
  private listing?: Promise<void>;
  private listedAt = Number.NEGATIVE_INFINITY;
  private readonly chats = new Map<string, { stamp: string; chat: ChatEntry[] }>();

  private readonly list: SessionLister;
  private readonly onChange: () => void;
  private readonly now: () => number;

  constructor(list: SessionLister, onChange: () => void = () => {}, now: () => number = Date.now) {
    this.list = list;
    this.onChange = onChange;
    this.now = now;
  }

  /** Tell the cache where a session's file is (a background session reports it). */
  remember(sessionId: string, path: string): void {
    this.paths.set(sessionId, path);
  }

  chat(sessionId: string): ChatEntry[] {
    const path = this.paths.get(sessionId);
    if (!path) {
      // A file's path never changes, so pi's list is only read (at most every few seconds) for sessions not found yet.
      if (this.now() - this.listedAt >= LIST_REFRESH_MS) this.refresh();
      return [];
    }
    let stamp: string;
    try {
      const stat = statSync(path);
      stamp = `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return this.chats.get(sessionId)?.chat ?? [];
    }
    const cached = this.chats.get(sessionId);
    if (cached?.stamp === stamp) return cached.chat;
    let chat: ChatEntry[];
    try {
      chat = chatFromFile(readFileSync(path, "utf8"));
    } catch {
      return cached?.chat ?? [];
    }
    this.chats.set(sessionId, { stamp, chat });
    return chat;
  }

  private refresh(): void {
    if (this.listing) return;
    this.listedAt = this.now();
    this.listing = this.list()
      .then((sessions) => {
        const before = this.paths.size;
        for (const session of sessions) this.paths.set(session.id, session.path);
        if (this.paths.size !== before) this.onChange();
      })
      .catch(() => {})
      .finally(() => {
        this.listing = undefined;
      });
  }
}
