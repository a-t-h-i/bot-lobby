/**
 * What a lobby window is doing, kept on disk so the next pi process can carry
 * on after a crash or an unexpected stop (a closed terminal, a kill).
 *
 * Each window running the lobby keeps one record: the pi session it runs, the
 * background sessions it drives, and whether each was in the middle of a turn.
 * A window that quits on purpose removes it; one that stops any other way
 * leaves it behind, and the next window to start in the project takes it over
 * (`claimStoppedWindows`). Each session's planning panel and quick-fix queue
 * are kept beside it, by session, so they carry on as well.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataRoot } from "./project.ts";
import { processAlive } from "./presence.ts";

/** A background session a window drives, as the next window relaunches it. */
export interface BackgroundRecord {
  sessionId: string;
  sessionFile: string;
  name: string;
  /** Its oracle was in the middle of a turn (or waiting on a question). */
  working: boolean;
}

export interface WindowRecord {
  pid: number;
  /** Tells this process's record from a dead one that had the same pid. */
  token: string;
  /** The pi session the window runs. */
  sessionId: string;
  sessionFile?: string;
  /** The window's oracle was in the middle of a turn. */
  working: boolean;
  background: BackgroundRecord[];
  startedAt: string;
  updatedAt: string;
}

/** What each kept session state holds. */
export type SessionStateKind = "planner" | "quickfix";

/** This process's token: written into its record, so a later process with the same pid is not mistaken for it. */
const TOKEN = randomBytes(8).toString("hex");

export function recoveryDir(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "lobby");
}

function windowsDir(root: string, configDir: string): string {
  return join(recoveryDir(root, configDir), "windows");
}

/** Session ids become file names: keep them to safe characters. */
function safe(id: string): string | undefined {
  return /^[\w.-]+$/.test(id) ? id : undefined;
}

/** Write through a temp file and a rename, so a crash mid-write never leaves half a file. */
function writeAtomic(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), "utf8");
  renameSync(tmp, path);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function windowPath(root: string, configDir: string, pid = process.pid, token = TOKEN): string {
  return join(windowsDir(root, configDir), `${pid}-${token}.json`);
}

/** Record (or refresh) what this window runs. */
export function writeWindow(root: string, configDir: string, record: Omit<WindowRecord, "pid" | "token" | "updatedAt" | "startedAt"> & { startedAt?: string }, now = new Date()): void {
  writeAtomic(windowPath(root, configDir), { pid: process.pid, token: TOKEN, startedAt: record.startedAt ?? now.toISOString(), ...record, updatedAt: now.toISOString() });
}

/** This window quit on purpose: nothing of it is left to carry on. */
export function removeWindow(root: string, configDir: string): void {
  rmSync(windowPath(root, configDir), { force: true });
}

function isWindowRecord(value: unknown): value is WindowRecord {
  const record = value as WindowRecord;
  return Boolean(record) && typeof record.pid === "number" && typeof record.token === "string" && typeof record.sessionId === "string" && Array.isArray(record.background);
}

/** Whether a record belongs to a process that is gone: another pid that is not running, or this pid from before. */
export function windowStopped(record: Pick<WindowRecord, "pid" | "token">, alive: (pid: number) => boolean = processAlive): boolean {
  if (record.pid === process.pid) return record.token !== TOKEN;
  return !alive(record.pid);
}

/** Windows in this project that stopped without quitting, newest first, unclaimed. */
export function stoppedWindows(root: string, configDir: string, alive: (pid: number) => boolean = processAlive): WindowRecord[] {
  const dir = windowsDir(root, configDir);
  if (!existsSync(dir)) return [];
  const found: WindowRecord[] = [];
  for (const file of readdirSync(dir)) {
    if (!/^\d+-[a-f0-9]+\.json$/.test(file)) continue;
    const record = readJson(join(dir, file));
    if (!isWindowRecord(record)) {
      rmSync(join(dir, file), { force: true });
      continue;
    }
    if (windowStopped(record, alive)) found.push(record);
  }
  return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Take over the windows that stopped without quitting: each record is moved
 * out of the way first, so two windows starting at once never both carry on
 * the same work. Returns the records this process took.
 */
export function claimStoppedWindows(root: string, configDir: string, alive: (pid: number) => boolean = processAlive): WindowRecord[] {
  const claimed: WindowRecord[] = [];
  for (const record of stoppedWindows(root, configDir, alive)) {
    const path = windowPath(root, configDir, record.pid, record.token);
    try {
      renameSync(path, `${path}.claimed-${process.pid}`);
    } catch {
      continue;
    }
    rmSync(`${path}.claimed-${process.pid}`, { force: true });
    claimed.push(record);
  }
  return claimed;
}

function statePath(root: string, configDir: string, kind: SessionStateKind, sessionId: string): string | undefined {
  const id = safe(sessionId);
  return id ? join(recoveryDir(root, configDir), `${kind}-${id}.json`) : undefined;
}

/** A session's kept planning panel or quick-fix queue, or undefined. */
export function readSessionState(root: string, configDir: string, kind: SessionStateKind, sessionId: string): unknown {
  const path = statePath(root, configDir, kind, sessionId);
  return path && existsSync(path) ? readJson(path) : undefined;
}

export function writeSessionState(root: string, configDir: string, kind: SessionStateKind, sessionId: string, value: unknown): void {
  const path = statePath(root, configDir, kind, sessionId);
  if (path) writeAtomic(path, value);
}

export function removeSessionState(root: string, configDir: string, kind: SessionStateKind, sessionId: string): void {
  const path = statePath(root, configDir, kind, sessionId);
  if (path) rmSync(path, { force: true });
}

/** Hand a stopped session's kept state to the session carrying it on. */
export function moveSessionState(root: string, configDir: string, kind: SessionStateKind, from: string, to: string): boolean {
  const source = statePath(root, configDir, kind, from);
  const target = statePath(root, configDir, kind, to);
  if (!source || !target || source === target || !existsSync(source)) return false;
  try {
    renameSync(source, target);
    return true;
  } catch {
    return false;
  }
}
