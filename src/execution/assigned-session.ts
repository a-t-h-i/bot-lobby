import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

/** Host-authored identity; never populate this from model tool arguments. */
export interface AssignedSession {
  taskDir: string;
  assignmentId: string;
  revision: number;
  evidence?: string[];
  completedWork?: string[];
  needs?: unknown[];
  consumedDiscovery?: number;
}
export interface AssignedSessionState {
  version: 1;
  assignmentId: string;
  revision: number;
  sessionFile: string;
  evidence: string[];
  completedWork: string[];
  needs: unknown[];
  consumedDiscovery: number;
  terminal?: boolean;
}
export class SessionRecoveryError extends Error {
  constructor(message: string) { super(`Assigned session recovery: ${message}`); this.name = "SessionRecoveryError"; }
}

type Entry = Record<string, unknown>;
function object(value: unknown): Entry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SessionRecoveryError("expected an object");
  return value as Entry;
}
const ENTRY_TYPES = new Set(["message", "model_change", "thinking_level_change", "usage", "compaction", "context_edit", "branch_summary", "custom", "custom_message", "label", "session_info"]);
const ROLES = new Set(["system", "user", "assistant", "toolResult", "custom", "bashExecution", "compactionSummary", "branchSummary"]);
function sanitizeSystem(value: unknown): Entry {
  const message = object(value);
  if (message.role !== "system") throw new SessionRecoveryError("invalid system checkpoint role");
  if (message.content !== "") throw new SessionRecoveryError("unsupported nonempty system content; cannot separate declarations from unrelated instructions without losing history");
  const clean: Entry = { ...message };
  delete clean.toolsAdded;
  delete clean.toolsRemoved;
  if (message.sections !== undefined) {
    const sections = { ...object(message.sections) };
    delete sections.tools;
    clean.sections = sections;
  }
  return clean;
}
function ancestors(entry: Entry, entries: Map<string, Entry>): Set<string> {
  const ids = new Set<string>();
  let parent = entry.parentId;
  while (typeof parent === "string") {
    if (ids.has(parent)) throw new SessionRecoveryError("cyclic parent chain");
    ids.add(parent);
    parent = entries.get(parent)?.parentId;
  }
  return ids;
}
function validateReferences(entry: Entry, entries: Map<string, Entry>): void {
  for (const key of ["parentId", "targetId", "fromId", "firstKeptEntryId"]) {
    const ref = entry[key];
    if (ref !== undefined && ref !== null && (typeof ref !== "string" || !entries.has(ref))) throw new SessionRecoveryError(`invalid ${key} at ${entry.id}`);
  }
  const path = ancestors(entry, entries);
  if (entry.type === "compaction" && entry.firstKeptEntryId !== entry.id && !path.has(String(entry.firstKeptEntryId))) throw new SessionRecoveryError(`invalid compaction retention at ${entry.id}`);
  if (entry.type === "context_edit" && !path.has(String(entry.targetId))) throw new SessionRecoveryError(`invalid context edit target at ${entry.id}`);
}

function sessionRows(source: string): Entry[] {
  let rows: Entry[];
  try { rows = source.trimEnd().split("\n").map((line) => object(JSON.parse(line))); }
  catch (error) { throw new SessionRecoveryError(`malformed JSONL (${error instanceof Error ? error.message : "parse failure"})`); }
  const header = rows[0];
  if (header?.type !== "session" || header.version !== 3 || typeof header.id !== "string" || typeof header.cwd !== "string") throw new SessionRecoveryError("unsupported or corrupt session header; version 3 required");
  return rows;
}
function indexedEntries(rows: Entry[]): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const entry of rows.slice(1)) {
    if (!ENTRY_TYPES.has(String(entry.type)) || typeof entry.id !== "string" || entries.has(entry.id) || !(entry.parentId === null || typeof entry.parentId === "string")) throw new SessionRecoveryError("unsupported or malformed entry");
    entries.set(entry.id, entry);
  }
  return entries;
}

/** Only declaration-bearing system payloads change; graph and conversation stay intact. */
export function sanitizeSession(source: string): string {
  const rows = sessionRows(source);
  const entries = indexedEntries(rows);
  for (const entry of entries.values()) {
    validateReferences(entry, entries);
    if (entry.type === "message") {
      const message = object(entry.message);
      if (!ROLES.has(String(message.role))) throw new SessionRecoveryError("unsupported message role");
      if (message.role === "system") entry.message = sanitizeSystem(message);
    }
    if (entry.type === "compaction" && entry.systemMessage !== undefined) entry.systemMessage = sanitizeSystem(entry.systemMessage);
    if (entry.type === "context_edit") {
      const target = entries.get(String(entry.targetId));
      if (target?.type === "message" && object(target.message).role === "system") throw new SessionRecoveryError("unsupported context edit of system payload; history retained");
    }
  }
  return `${rows.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

function atomicWrite(path: string, contents: string): void {
  const temporary = `${path}.rewrite`;
  if (existsSync(temporary) && (!lstatSync(temporary).isFile() || lstatSync(temporary).isSymbolicLink())) throw new SessionRecoveryError("invalid owned rewrite file");
  const fd = openSync(temporary, "w", 0o600);
  try { writeFileSync(fd, contents, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
}
function sessionPaths(assignment: Pick<AssignedSession, "taskDir" | "assignmentId">) {
  if (!assignment.assignmentId.trim()) throw new SessionRecoveryError("assignment identity is required");
  const key = createHash("sha256").update(assignment.assignmentId).digest("hex");
  const dir = join(resolve(assignment.taskDir), "sessions", key);
  return { dir, file: join(dir, "conversation.jsonl"), state: join(dir, "state.json"), lock: join(dir, "lock") };
}
/** Explicit deterministic path; never Pi's interactive session lookup. */
export function assignedSessionFile(assignment: Pick<AssignedSession, "taskDir" | "assignmentId">): string {
  return sessionPaths(assignment).file;
}
function readState(path: string): AssignedSessionState {
  try {
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error("invalid metadata file");
    const state = object(JSON.parse(readFileSync(path, "utf8")));
    if (state.version !== 1 || typeof state.assignmentId !== "string" || !state.assignmentId.trim() || typeof state.sessionFile !== "string" || !Number.isSafeInteger(state.revision) || Number(state.revision) < 1 || !Number.isSafeInteger(state.consumedDiscovery) || Number(state.consumedDiscovery) < 0 || !Array.isArray(state.evidence) || !state.evidence.every(value => typeof value === "string") || !Array.isArray(state.completedWork) || !state.completedWork.every(value => typeof value === "string") || !Array.isArray(state.needs) || (state.terminal !== undefined && typeof state.terminal !== "boolean")) throw new Error("invalid metadata");
    return state as unknown as AssignedSessionState;
  } catch { throw new SessionRecoveryError("missing or corrupt state.json; restore task-owned metadata, do not start fresh"); }
}

type SessionPaths = ReturnType<typeof sessionPaths>;
function ownerRecord(path: string): { token: string; pid: number; host: string } {
  try {
    const owner = object(JSON.parse(readFileSync(join(path, "owner.json"), "utf8")));
    if (typeof owner.token !== "string" || !owner.token || !Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0 || owner.host !== hostname()) throw new Error("ambiguous owner");
    return owner as { token: string; pid: number; host: string };
  } catch { throw new SessionRecoveryError("locked conversation has missing/corrupt/foreign owner metadata; explicit repair required"); }
}
function ownerDead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}
/** All lock mutations share a guard, including release, so stale reclamation cannot delete a successor. */
function guarded<T>(paths: SessionPaths, action: () => T): T {
  const guard = `${paths.lock}.guard`;
  try { mkdirSync(guard); }
  catch { throw new SessionRecoveryError("conversation lock recovery is busy or interrupted; retry or explicitly repair its guard"); }
  try { return action(); } finally { rmSync(guard, { recursive: true }); }
}
function sessionLock(paths: SessionPaths) {
  const token = randomUUID();
  guarded(paths, () => {
    if (existsSync(paths.lock)) {
      if (!lstatSync(paths.lock).isDirectory() || lstatSync(paths.lock).isSymbolicLink()) throw new SessionRecoveryError("invalid conversation lock");
      const owner = ownerRecord(paths.lock);
      if (!ownerDead(owner.pid)) throw new SessionRecoveryError("conversation is locked by a live or unverifiable owner");
      rmSync(paths.lock, { recursive: true });
    }
    mkdirSync(paths.lock);
    writeFileSync(join(paths.lock, "owner.json"), JSON.stringify({ token, pid: process.pid, host: hostname() }), { mode: 0o600 });
  });
  let released = false;
  return {
    active: () => !released,
    release: () => {
      if (released) return;
      guarded(paths, () => {
        if (ownerRecord(paths.lock).token !== token) throw new SessionRecoveryError("conversation lock ownership changed");
        rmSync(paths.lock, { recursive: true });
        released = true;
      });
    },
  };
}
function initialState(paths: SessionPaths, assignment: AssignedSession, cwd: string): AssignedSessionState {
  if ([paths.file, `${paths.file}.rewrite`, `${paths.state}.rewrite`].some(existsSync)) throw new SessionRecoveryError("conversation or interrupted creation exists without metadata; explicit repair required");
  const state: AssignedSessionState = { version: 1, assignmentId: assignment.assignmentId, revision: assignment.revision, sessionFile: paths.file, evidence: [], completedWork: [], needs: [], consumedDiscovery: 0 };
  // Metadata first: an interrupted creation must not silently become a fresh session.
  atomicWrite(paths.state, JSON.stringify(state));
  atomicWrite(paths.file, `${JSON.stringify({ type: "session", version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: resolve(cwd) })}\n`);
  return state;
}
function restoredState(paths: SessionPaths, assignment: AssignedSession, cwd: string, fresh: boolean): AssignedSessionState {
  if (fresh) return initialState(paths, assignment, cwd);
  const state = readState(paths.state);
  if (state.assignmentId !== assignment.assignmentId || state.sessionFile !== paths.file || state.revision > assignment.revision) throw new SessionRecoveryError("identity/path mismatch or superseded revision");
  if (state.terminal) { cleanupBodies(paths); throw new SessionRecoveryError("assignment is terminal; cleanup retried"); }
  if (!existsSync(paths.file)) throw new SessionRecoveryError("conversation is missing; restore it, do not start fresh");
  if (lstatSync(paths.file).isSymbolicLink() || !lstatSync(paths.file).isFile()) throw new SessionRecoveryError("invalid owned conversation file");
  const source = readFileSync(paths.file, "utf8");
  if (sessionRows(source)[0]!.cwd !== resolve(cwd)) throw new SessionRecoveryError("conversation project scope changed; restore its original worktree");
  atomicWrite(paths.file, sanitizeSession(source));
  return state;
}
function revisedState(state: AssignedSessionState, assignment: AssignedSession): AssignedSessionState {
  return { ...state, revision: assignment.revision, evidence: assignment.evidence ?? state.evidence, completedWork: assignment.completedWork ?? state.completedWork, needs: assignment.needs ?? state.needs, consumedDiscovery: Math.max(state.consumedDiscovery, assignment.consumedDiscovery ?? 0) };
}

/** Lock spans sanitation and subprocess lifetime; only demonstrated owner death permits reclamation. */
export function openAssignedSession(assignment: AssignedSession, cwd: string) {
  if (!Number.isSafeInteger(assignment.revision) || assignment.revision < 1) throw new SessionRecoveryError("revision must be a positive integer");
  if (assignment.consumedDiscovery !== undefined && (!Number.isSafeInteger(assignment.consumedDiscovery) || assignment.consumedDiscovery < 0)) throw new SessionRecoveryError("consumed discovery must be a nonnegative integer");
  const paths = sessionPaths(assignment);
  const sessions = join(paths.dir, "..");
  mkdirSync(sessions, { recursive: true, mode: 0o700 });
  if (lstatSync(sessions).isSymbolicLink() || !lstatSync(sessions).isDirectory()) throw new SessionRecoveryError("invalid owned sessions directory");
  let fresh = false;
  try { mkdirSync(paths.dir, { mode: 0o700 }); fresh = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (lstatSync(paths.dir).isSymbolicLink() || !lstatSync(paths.dir).isDirectory()) throw new SessionRecoveryError("invalid session directory");
  const lock = sessionLock(paths);
  try {
    const state = revisedState(restoredState(paths, assignment, cwd, fresh), assignment);
    atomicWrite(paths.state, JSON.stringify(state));
    const save = () => {
      if (!lock.active()) throw new SessionRecoveryError("cannot save metadata after releasing the conversation lock");
      atomicWrite(paths.state, JSON.stringify(state));
    };
    return { file: paths.file, state, release: lock.release, save };
  } catch (error) { lock.release(); throw error; }
}
function cleanupBodies(paths: ReturnType<typeof sessionPaths>): void {
  for (const path of [paths.file, `${paths.file}.rewrite`, `${paths.state}.rewrite`]) rmSync(path, { force: true });
}
/** Terminal cleanup does not parse or recreate conversation bodies. Metadata survives every retry. */
export function cleanupAssignedSession(assignment: AssignedSession, _cwd?: string): void {
  const paths = sessionPaths(assignment);
  if (lstatSync(paths.dir).isSymbolicLink() || !lstatSync(paths.dir).isDirectory()) throw new SessionRecoveryError("invalid owned session directory");
  const lock = sessionLock(paths);
  try {
    const state = readState(paths.state);
    if (state.assignmentId !== assignment.assignmentId) throw new SessionRecoveryError("cleanup assignment identity mismatch");
    state.terminal = true;
    atomicWrite(paths.state, JSON.stringify(state));
    cleanupBodies(paths);
  } finally { lock.release(); }
}
/** Host calls only after persisting terminal task state. No cancellation or crash cleanup. */
export function cleanupTaskAssignedSessions(taskDir: string): void {
  const sessions = join(resolve(taskDir), "sessions");
  if (!existsSync(sessions)) return;
  if (lstatSync(sessions).isSymbolicLink() || !lstatSync(sessions).isDirectory()) throw new SessionRecoveryError("invalid owned sessions directory");
  const issues: string[] = [];
  for (const entry of readdirSync(sessions, { withFileTypes: true })) {
    try {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) throw new SessionRecoveryError(`unexpected session entry ${entry.name}`);
      const state = readState(join(sessions, entry.name, "state.json"));
      const assignment = { taskDir, assignmentId: state.assignmentId, revision: state.revision };
      if (sessionPaths(assignment).dir !== join(sessions, entry.name)) throw new SessionRecoveryError("session directory identity mismatch");
      cleanupAssignedSession(assignment);
    } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  }
  if (issues.length) throw new SessionRecoveryError(`terminal cleanup incomplete: ${issues.join("; ")}`);
}
