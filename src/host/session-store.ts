/**
 * The Orchestrator's sessions on disk, one JSONL file each, in pi's session
 * format (a `session` header line, then entries with id / parentId /
 * timestamp), so the Lobby's chat history and the saved-sessions list read
 * them the way they read pi's files, and old pi sessions can be carried over.
 * Each file also remembers which harness session it drives (`harness` entry),
 * so a daemon restart resumes the same Claude Code / Codex / ACP session.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SessionEntry, SessionManager } from "./api.ts";

export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
}

/** Which harness session a Lobby session drives. */
export interface HarnessLink {
  harness: string;
  sessionId: string;
}

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part && typeof part === "object" && (part as { type?: string }).type === "text" ? String((part as { text?: unknown }).text ?? "") : "")).join("");
}

function readEntries(path: string): SessionEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: SessionEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SessionEntry);
    } catch {
      // A torn last line (a crash mid-write) is skipped.
    }
  }
  return out;
}

/** One session file: appends entries and answers the engine's SessionManager questions. */
export class SessionFile implements SessionManager {
  readonly id: string;
  readonly path: string;
  private entries: SessionEntry[];
  private leaf: string | undefined;

  private constructor(readonly dir: string, readonly cwd: string, path: string, id: string, entries: SessionEntry[]) {
    this.path = path;
    this.id = id;
    this.entries = entries;
    this.leaf = [...entries].reverse().find((entry) => entry.type !== "session")?.id;
  }

  /** A new, empty session in `dir`. Nothing is written until the first entry. */
  static create(dir: string, cwd: string): SessionFile {
    const id = randomUUID();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new SessionFile(dir, cwd, join(dir, `${stamp}_${id}.jsonl`), id, []);
    return file;
  }

  /** An existing session file. */
  static open(path: string, cwd: string): SessionFile {
    const entries = readEntries(path);
    const header = entries.find((entry) => entry.type === "session");
    const id = typeof header?.id === "string" ? header.id : randomUUID();
    return new SessionFile(join(path, ".."), typeof header?.cwd === "string" ? header.cwd : cwd, path, id, entries.filter((entry) => entry.type !== "session"));
  }

  private write(entry: SessionEntry): void {
    if (!existsSync(this.path)) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      appendFileSync(this.path, `${JSON.stringify({ type: "session", version: 3, id: this.id, timestamp: new Date().toISOString(), cwd: this.cwd })}\n`, { mode: 0o600 });
    }
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }

  append(entry: Omit<SessionEntry, "id" | "parentId" | "timestamp">): SessionEntry {
    const full: SessionEntry = { ...entry, id: shortId(), parentId: this.leaf ?? null, timestamp: new Date().toISOString() } as SessionEntry;
    this.entries.push(full);
    this.leaf = full.id;
    this.write(full);
    return full;
  }

  appendMessage(role: "user" | "assistant", content: unknown, extra: Record<string, unknown> = {}): SessionEntry {
    return this.append({ type: "message", message: { role, content, timestamp: Date.now(), ...extra } });
  }

  appendCustom(customType: string, data: unknown): SessionEntry {
    return this.append({ type: "custom", customType, data });
  }

  setName(name: string): void {
    this.append({ type: "session_info", name });
  }

  name(): string | undefined {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]!;
      if (entry.type === "session_info" && typeof entry.name === "string") return entry.name;
    }
    return undefined;
  }

  /** The harness session this Lobby session drives, if a turn has run. */
  harness(): HarnessLink | undefined {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]!;
      if (entry.type === "custom" && entry.customType === "bot-lobby-harness") return entry.data as HarnessLink;
    }
    return undefined;
  }

  setHarness(link: HarnessLink): void {
    const current = this.harness();
    if (current?.harness === link.harness && current.sessionId === link.sessionId) return;
    this.appendCustom("bot-lobby-harness", link);
  }

  getSessionId(): string {
    return this.id;
  }

  getSessionFile(): string | undefined {
    return existsSync(this.path) ? this.path : undefined;
  }

  getSessionDir(): string {
    return this.dir;
  }

  getBranch(): SessionEntry[] {
    return [...this.entries];
  }

  getLeafId(): string | undefined {
    return this.leaf;
  }

  buildContextEntries(): SessionEntry[] {
    return this.getBranch();
  }
}

/** Every saved session in `dir`, newest first. */
export async function listSessions(cwd: string, dir: string): Promise<SessionInfo[]> {
  if (!existsSync(dir)) return [];
  const out: SessionInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    const entries = readEntries(path);
    const header = entries.find((entry) => entry.type === "session");
    if (!header) continue;
    if (typeof header.cwd === "string" && header.cwd && header.cwd !== cwd) continue;
    const messages = entries.filter((entry) => entry.type === "message" && (entry.message?.role === "user" || entry.message?.role === "assistant"));
    const texts = messages.map((entry) => textOf(entry.message?.content));
    const firstUser = messages.find((entry) => entry.message?.role === "user");
    let named: string | undefined;
    for (const entry of entries) if (entry.type === "session_info" && typeof entry.name === "string") named = entry.name;
    const stat = statSync(path);
    out.push({
      path,
      id: String(header.id ?? name),
      cwd: typeof header.cwd === "string" ? header.cwd : cwd,
      ...(named ? { name: named } : {}),
      created: new Date(typeof header.timestamp === "string" ? header.timestamp : stat.birthtime),
      modified: stat.mtime,
      messageCount: messages.length,
      firstMessage: firstUser ? textOf(firstUser.message?.content) : "",
      allMessagesText: texts.join("\n"),
    });
  }
  return out.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}
