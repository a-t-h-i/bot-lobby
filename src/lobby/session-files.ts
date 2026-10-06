/**
 * Other sessions' conversations, read from their saved pi session files. A
 * task another terminal drives has no live feed in this window, so the lobby
 * shows what its session file holds: the current branch's user and assistant
 * messages. Files are read as they grow — only the bytes appended since the
 * last look — and only what the conversation needs is kept: each entry's
 * parent, and the text of user and assistant messages (never tool output).
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { chatText, CLEARED_NOTE, isClearedMark, MAX_CHAT, textOf, type ChatEntry } from "./feed.ts";

/** What a session log keeps of one entry: its parent, and its conversation lines if it is a message. */
interface LogNode {
  parentId?: string;
  chat?: ChatEntry[];
}

/** Bytes read at most per look, so a huge file is caught up over a few frames rather than in one. */
const READ_CHUNK = 4 * 1024 * 1024;

let logIds = 0;

/**
 * One session file, followed as it grows. Its entries form a tree (pi
 * branches); the conversation is the branch that ends at the newest entry.
 * The newest messages are kept ready; the whole history is walked only when
 * asked for.
 */
export class SessionLog {
  readonly path: string;
  private offset = 0;
  private leaf?: string;
  private readonly nodes = new Map<string, LogNode>();
  private recentCache?: { max: number; entries: ChatEntry[]; older: boolean };

  constructor(path: string) {
    this.path = path;
  }

  /** Read what was appended since the last look; true when the conversation may have changed. */
  update(): boolean {
    let size: number;
    try {
      size = statSync(this.path).size;
    } catch {
      return false;
    }
    if (size < this.offset) this.reset();
    if (size === this.offset) return false;
    let changed = false;
    let fd: number | undefined;
    try {
      fd = openSync(this.path, "r");
      while (this.offset < size) {
        const length = Math.min(READ_CHUNK, size - this.offset);
        const buffer = Buffer.alloc(length);
        const read = readSync(fd, buffer, 0, length, this.offset);
        // Only whole lines: a line still being written (or a character cut in two) waits for the next look.
        const end = buffer.lastIndexOf(0x0a, read - 1);
        if (end < 0) break;
        for (const line of buffer.toString("utf8", 0, end).split("\n")) changed = this.add(line) || changed;
        this.offset += end + 1;
        if (length === READ_CHUNK) break;
      }
    } catch {
      // Unreadable for now; the next look tries again.
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (changed) this.recentCache = undefined;
    return changed;
  }

  private reset(): void {
    this.offset = 0;
    this.leaf = undefined;
    this.nodes.clear();
    this.recentCache = undefined;
  }

  private add(line: string): boolean {
    if (!line.trim()) return false;
    let entry: { type?: string; id?: unknown; parentId?: unknown; timestamp?: unknown; message?: { role?: string; content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      return false;
    }
    if (typeof entry?.id !== "string") return false;
    const node: LogNode = typeof entry.parentId === "string" ? { parentId: entry.parentId } : {};
    const role = entry.message?.role;
    const parsed = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    const at = Number.isFinite(parsed) ? parsed : 0;
    if (entry.type === "message" && (role === "user" || role === "assistant")) {
      const chat = chatText(role, textOf(entry.message?.content)).map((part) => ({ id: ++logIds, at, role: part.role, text: part.text }));
      if (chat.length > 0) node.chat = chat;
    } else if (isClearedMark(entry)) {
      node.chat = [{ id: ++logIds, at, role: "note", text: CLEARED_NOTE }];
    }
    this.nodes.set(entry.id, node);
    this.leaf = entry.id;
    return true;
  }

  /** The conversation's messages from the newest back, visiting at most `max`; whether any are left before them. */
  private walk(max: number): { entries: ChatEntry[]; older: boolean } {
    const parts: ChatEntry[][] = [];
    let count = 0;
    let older = false;
    const seen = new Set<string>();
    for (let id = this.leaf; id && !seen.has(id); id = this.nodes.get(id)?.parentId) {
      seen.add(id);
      const chat = this.nodes.get(id)?.chat;
      if (!chat) continue;
      if (count >= max) {
        older = true;
        break;
      }
      parts.push(chat);
      count += chat.length;
    }
    const entries = parts.reverse().flat();
    return { entries: entries.length > max ? entries.slice(-max) : entries, older: older || entries.length > max };
  }

  /** The newest `max` messages (kept until the file changes), and whether earlier ones exist. */
  recent(max = MAX_CHAT): { entries: ChatEntry[]; older: boolean } {
    if (this.recentCache?.max !== max) this.recentCache = { max, ...this.walk(max) };
    return this.recentCache;
  }

  /** Every message of the conversation, oldest first (for scrolling back through it). */
  history(): ChatEntry[] {
    return this.walk(Number.POSITIVE_INFINITY).entries;
  }
}

/** How the cache finds session files: pi's session list, id → path. */
export type SessionLister = () => Promise<ReadonlyArray<{ id: string; path: string }>>;

/** How often the id → path map is refreshed while someone looks. */
export const LIST_REFRESH_MS = 5000;

/** Session files followed at once; the least recently looked at is let go past this. */
export const MAX_LOGS = 8;

/**
 * Chats of sessions by id, each followed through a `SessionLog` (only new
 * bytes read). Finding a file is async (pi lists sessions from disk), so the
 * first look returns nothing and `onChange` fires once new files are known.
 */
export class SessionChats {
  private paths = new Map<string, string>();
  private listing?: Promise<void>;
  private listedAt = Number.NEGATIVE_INFINITY;
  private readonly logs = new Map<string, SessionLog>();

  private readonly list: SessionLister;
  private readonly onChange: () => void;
  private readonly now: () => number;

  constructor(list: SessionLister, onChange: () => void = () => {}, now: () => number = Date.now) {
    this.list = list;
    this.onChange = onChange;
    this.now = now;
  }

  /** A session's file, asking pi's list at once when it is not known yet. */
  async locate(sessionId: string): Promise<string | undefined> {
    const known = this.paths.get(sessionId);
    if (known) return known;
    try {
      for (const session of await this.list()) this.paths.set(session.id, session.path);
    } catch {
      return undefined;
    }
    return this.paths.get(sessionId);
  }

  /** Tell the cache where a session's file is (a background session reports it). */
  remember(sessionId: string, path: string): void {
    this.paths.set(sessionId, path);
  }

  /** The session's log, following its file (the least recently used let go past `MAX_LOGS`). */
  private log(sessionId: string): SessionLog | undefined {
    const path = this.paths.get(sessionId);
    if (!path) {
      // A file's path never changes, so pi's list is only read (at most every few seconds) for sessions not found yet.
      if (this.now() - this.listedAt >= LIST_REFRESH_MS) this.refresh();
      return undefined;
    }
    let log = this.logs.get(sessionId);
    if (!log || log.path !== path) log = new SessionLog(path);
    this.logs.delete(sessionId);
    this.logs.set(sessionId, log);
    if (this.logs.size > MAX_LOGS) this.logs.delete(this.logs.keys().next().value!);
    log.update();
    return log;
  }

  /** The newest messages of a session's conversation (the same objects until its file grows). */
  chat(sessionId: string): ChatEntry[] {
    return this.log(sessionId)?.recent().entries ?? [];
  }

  /** Whether the session has messages earlier than `chat` returns. */
  hasOlder(sessionId: string): boolean {
    return this.log(sessionId)?.recent().older ?? false;
  }

  /** The session's whole conversation, oldest first. */
  history(sessionId: string): ChatEntry[] {
    return this.log(sessionId)?.history() ?? [];
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
