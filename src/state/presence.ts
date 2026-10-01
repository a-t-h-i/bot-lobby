/**
 * Which pi sessions are running in this project right now. Every interactive
 * or headless session with bot-lobby loaded (never a subagent) keeps a small
 * heartbeat file beside the tasks, refreshed on its owner clock and removed
 * when it ends; the lobby reads them to list the live sessions it can view,
 * message or switch to. A heartbeat older than a few beats, or from a process
 * that is gone, does not count.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "./project.ts";

export interface Presence {
  sessionId: string;
  pid: number;
  /** The pi session's name (a task's title once it starts one). */
  name?: string;
  /** The saved session file, so another window can switch to it once it ends. */
  sessionFile?: string;
  /** The task it drives, if any. */
  taskId?: string;
  /** The loopback web UI's port, while this session's server runs. */
  webPort?: number;
  /** `tui` for a terminal, `rpc` for a session another window started in the background. */
  mode: string;
  updatedAt: string;
}

/** A heartbeat older than this means the session is gone (its owner clock ticks every few seconds). */
export const PRESENCE_TTL_MS = 15_000;
/** A heartbeat this old is removed even if its process still runs (it switched sessions without saying so). */
const FORGET_MS = 10 * 60_000;

export function presenceDir(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "sessions");
}

/** Session ids become file names: keep them to safe characters. */
function safeId(sessionId: string): string | undefined {
  return /^[\w.-]+$/.test(sessionId) ? sessionId : undefined;
}

function presencePath(root: string, configDir: string, sessionId: string): string | undefined {
  const id = safeId(sessionId);
  return id ? join(presenceDir(root, configDir), `${id}.json`) : undefined;
}

/** Record (or refresh) this session's heartbeat; atomic, so readers never see half a file. */
export function writePresence(root: string, configDir: string, presence: Omit<Presence, "updatedAt">, now = new Date()): void {
  const path = presencePath(root, configDir, presence.sessionId);
  if (!path) return;
  mkdirSync(presenceDir(root, configDir), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...presence, updatedAt: now.toISOString() }), "utf8");
  renameSync(tmp, path);
}

export function removePresence(root: string, configDir: string, sessionId: string): void {
  const path = presencePath(root, configDir, sessionId);
  if (path) rmSync(path, { force: true });
}

/** Whether a process is running: signal 0 checks without touching it (EPERM still means it exists). */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The sessions running in this project, newest heartbeat first. Heartbeats
 * of processes that are gone are removed; merely late ones are skipped.
 */
export function livePresence(root: string, configDir: string, now = Date.now(), alive: (pid: number) => boolean = processAlive): Presence[] {
  const dir = presenceDir(root, configDir);
  if (!existsSync(dir)) return [];
  const live: Presence[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
    let presence: Presence;
    try {
      presence = JSON.parse(readFileSync(join(dir, file), "utf8")) as Presence;
    } catch {
      continue;
    }
    if (typeof presence?.sessionId !== "string" || typeof presence.pid !== "number") continue;
    const age = now - Date.parse(presence.updatedAt);
    // Gone, or so long silent that its process has moved on to another session: clear it away.
    if (!alive(presence.pid) || !(age < FORGET_MS)) {
      rmSync(join(dir, file), { force: true });
      continue;
    }
    if (age > PRESENCE_TTL_MS) continue;
    live.push(presence);
  }
  return live.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
