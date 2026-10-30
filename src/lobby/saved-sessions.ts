/**
 * The project's saved sessions, as the sidebar keeps them: every pi session
 * with something said in it stays listed (newest first) until the user
 * archives it, which is remembered in the project's data folder, or deletes
 * its file. Pure apart from the archive file, so the tests read the same list.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataRoot } from "../state/project.ts";

/** A saved session the sidebar can switch to. */
export interface SavedSession {
  sessionId: string;
  name: string;
  /** When it last changed, ms since the epoch. */
  at: number;
  archived?: boolean;
}

/** What pi's session list says of a session file. */
export interface SessionFileInfo {
  id: string;
  path: string;
  name?: string;
  firstMessage?: string;
  modified: Date;
  messageCount: number;
}

/** Longest name drawn from a session's first message. */
const NAME_FROM_MESSAGE = 60;

export function archivedSessionsFile(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "sessions", "archived.json");
}

export function readArchivedSessions(file: string): Set<string> {
  if (!existsSync(file)) return new Set();
  try {
    const ids = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeArchivedSessions(file: string, ids: ReadonlySet<string>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify([...ids].sort(), null, 2)}\n`);
}

/** A session's name: the one it was given, else the start of its first message. */
export function savedName(info: Pick<SessionFileInfo, "name" | "firstMessage">): string {
  const named = info.name?.replace(/\s+/g, " ").trim();
  if (named) return named;
  const first = (info.firstMessage ?? "").replace(/\s+/g, " ").trim();
  if (!first) return "Untitled session";
  return first.length > NAME_FROM_MESSAGE ? `${first.slice(0, NAME_FROM_MESSAGE - 1).trimEnd()}…` : first;
}

/**
 * The saved sessions to list, newest first: those with messages, one per id, except the ones `shown` already
 * (this window, its background sessions, live ones in other terminals). Archived ones come back marked.
 */
export function savedSessions(files: readonly SessionFileInfo[], shown: ReadonlySet<string>, archived: ReadonlySet<string>): SavedSession[] {
  const byId = new Map<string, SavedSession>();
  for (const file of files) {
    if (file.messageCount === 0 || shown.has(file.id)) continue;
    const at = file.modified.getTime();
    const known = byId.get(file.id);
    if (known && known.at >= at) continue;
    byId.set(file.id, { sessionId: file.id, name: savedName(file), at, ...(archived.has(file.id) ? { archived: true } : {}) });
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}
