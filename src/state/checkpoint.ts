import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { BookmarkRecord } from "../knowledge/bookmarks.ts";
import type { Task } from "../schemas/task.ts";

const MAX_REFS = 16;
const MAX_FILE_BYTES = 256 * 1024;
export type CheckpointReferenceKind = "file" | "bookmark" | "artifact" | "ownership" | "delivery";
export type CheckpointAuthorize = (kind: CheckpointReferenceKind, ref: string) => boolean;
export interface CheckpointList<T> { items: T[]; omitted: number }
export interface CheckpointSource { path: string; fingerprint: string }
export interface CheckpointTaskRef { ref: string; fingerprint: string; result?: string }
export interface CheckpointOptions {
  assignment?: string;
  bookmarks?: readonly BookmarkRecord[];
  changedFiles?: readonly string[];
  artifactRefs?: readonly string[];
  ownershipRefs?: readonly string[];
  deliveryRefs?: readonly string[];
  authorize?: CheckpointAuthorize;
}
export interface TaskCheckpoint {
  version: 1;
  taskId: string;
  cwd: string;
  assignment: string;
  objective: { preview: string; omittedChars: number };
  constraints: { plan: CheckpointTaskRef; approvedPlan: CheckpointTaskRef; amendments: CheckpointList<CheckpointTaskRef> };
  completedRunIds: CheckpointList<string>;
  nextAction: { state: Task["state"]; paused: boolean };
  blockers: CheckpointList<CheckpointTaskRef>;
  questions: CheckpointList<string>;
  bookmarks: CheckpointList<BookmarkRecord>;
  artifacts: CheckpointList<string>;
  ownership: CheckpointList<string>;
  delivery: CheckpointList<string>;
  verification: { evidence: CheckpointList<CheckpointTaskRef>; sources: CheckpointList<CheckpointSource> };
}
export interface CheckpointContext {
  task: Task;
  cwd: string;
  assignment?: string;
  authorize: CheckpointAuthorize;
}
export interface ReconciledCheckpoint {
  status: "current" | "stale-context";
  /** Even unchanged hashes are not proof that a recorded claim remains correct. */
  sources: Array<CheckpointSource & { status: "unchanged" | "changed-or-unavailable" }>;
  evidence: Array<CheckpointTaskRef & { status: "recorded" | "changed-or-unavailable" }>;
  bookmarks: BookmarkRecord[];
  artifacts: string[];
  /** References must be checked against the live desk; they never recreate claims or delivery. */
  ownership: string[];
  delivery: string[];
  requiresBookmarkRevalidation: true;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
}

function list<T>(items: readonly T[], max = MAX_REFS): CheckpointList<T> {
  return { items: items.slice(-max), omitted: Math.max(0, items.length - max) };
}

function refs(items: readonly string[] = []): CheckpointList<string> {
  const valid = items.filter((ref) => ref.length > 0 && ref.length <= 512);
  const bounded = list(valid);
  return { ...bounded, omitted: bounded.omitted + items.length - valid.length };
}

function taskRef(ref: string, value: unknown): CheckpointTaskRef {
  return { ref, fingerprint: hash(value) };
}

function assignment(task: Task, explicit?: string): string {
  return hash([explicit ?? null, task.request || task.title, task.plan, task.approvedPlan, task.amendments, task.domains]);
}

function canonical(cwd: string): string {
  try { return realpathSync(cwd); } catch { return ""; }
}

function allowed(authorize: CheckpointAuthorize | undefined, kind: CheckpointReferenceKind, ref: string): boolean {
  try { return authorize?.(kind, ref) === true; } catch { return false; }
}

/** No symlink component, sibling worktree escape, directory, or oversized source is read. */
function sourcePath(cwd: string, input: string): string | undefined {
  if (!cwd || input.length > 512) return undefined;
  const path = resolve(cwd, input);
  const local = relative(cwd, path);
  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local)) return undefined;
  try { return realpathSync(path) === path ? path : undefined; } catch { return undefined; }
}

function fingerprint(path: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES) return undefined;
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    return count <= MAX_FILE_BYTES ? createHash("sha256").update(bytes.subarray(0, count)).digest("hex") : undefined;
  } catch { return undefined; } finally { if (fd !== undefined) closeSync(fd); }
}

function sources(cwd: string, options: CheckpointOptions): CheckpointList<CheckpointSource> {
  const inputs = options.changedFiles ?? [];
  const kept: CheckpointSource[] = [];
  for (const input of inputs.slice(-MAX_REFS)) {
    const path = sourcePath(cwd, input);
    if (!path || !allowed(options.authorize, "file", path)) continue;
    const digest = fingerprint(path);
    if (digest) kept.push({ path, fingerprint: digest });
  }
  return { items: kept, omitted: inputs.length - kept.length };
}

function bookmarks(records: readonly BookmarkRecord[] = []): CheckpointList<BookmarkRecord> {
  const valid = records.filter((record) => [record.ref, record.recipient, record.sourceVersion, record.at].every((value) => value.length <= 512));
  const bounded = list(valid);
  return { items: bounded.items.map((record) => ({ ref: record.ref, recipient: record.recipient, authority: record.authority, sourceVersion: record.sourceVersion, revision: record.revision, at: record.at, reason: record.reason.slice(0, 140), pinned: record.pinned, excluded: record.excluded, notes: record.notes })), omitted: bounded.omitted + records.length - valid.length };
}

function evidence(task: Task): CheckpointList<CheckpointTaskRef> {
  const records: CheckpointTaskRef[] = task.reviewRecords.slice(-8).map((record, i) => ({ ...taskRef(`task.reviewRecords[${Math.max(0, task.reviewRecords.length - 8) + i}]`, record), result: record.verdict }));
  if (task.lint) records.push({ ...taskRef("task.lint", task.lint), result: task.lint.state });
  if (task.goalCheck) records.push({ ...taskRef("task.goalCheck", task.goalCheck), result: task.goalCheck.verdict });
  return { ...list(records), omitted: Math.max(0, task.reviewRecords.length - 8) };
}

/** Derived data only: the existing Task persistence is the sole checkpoint store. */
export function captureCheckpoint(task: Task, cwd: string, options: CheckpointOptions = {}): TaskCheckpoint {
  const objective = task.request || task.title;
  return {
    version: 1, taskId: task.id, cwd: canonical(cwd), assignment: assignment(task, options.assignment),
    objective: { preview: objective.slice(0, 800), omittedChars: Math.max(0, objective.length - 800) },
    constraints: { plan: taskRef("task.plan", task.plan), approvedPlan: taskRef("task.approvedPlan", task.approvedPlan), amendments: list(task.amendments.map((value, i) => taskRef(`task.amendments[${i}]`, value)), 8) },
    completedRunIds: list((task.workerRuns ?? []).filter((run) => run.status !== "running").map((run) => run.runId).filter((id) => id.length <= 512), 8),
    nextAction: { state: task.state, paused: task.paused },
    blockers: list(task.blockers.map((value, i) => taskRef(`task.blockers[${i}]`, value)), 8),
    questions: refs(task.blockingRequestIds), bookmarks: bookmarks(options.bookmarks),
    artifacts: refs(options.artifactRefs), ownership: refs(options.ownershipRefs), delivery: refs(options.deliveryRefs),
    verification: { evidence: evidence(task), sources: sources(canonical(cwd), options) },
  };
}

function currentSources(checkpoint: TaskCheckpoint, context: CheckpointContext): ReconciledCheckpoint["sources"] {
  const cwd = canonical(context.cwd);
  return checkpoint.verification.sources.items.slice(-MAX_REFS).filter((source) => allowed(context.authorize, "file", source.path)).map((source) => {
    const path = sourcePath(cwd, source.path);
    const unchanged = path && fingerprint(path) === source.fingerprint;
    return { ...source, status: unchanged ? "unchanged" : "changed-or-unavailable" };
  });
}

/** Task-state comparison only; it makes no claim about the current checkout or access. */
export function checkpointTaskStatus(checkpoint: TaskCheckpoint, task: Task): "current-task-state" | "stale-task-state" {
  return checkpoint.version === 1 && checkpoint.taskId === task.id && checkpoint.assignment === assignment(task) && checkpoint.nextAction.state === task.state && checkpoint.nextAction.paused === task.paused ? "current-task-state" : "stale-task-state";
}

/**
 * Run marks from a persisted checkpoint, readable only through the caller's live access
 * callback: a revoked or absent checkpoint reads as empty, never as stale truth.
 */
export function persistedRunMarks(checkpoint: TaskCheckpoint | undefined, authorize: (ref: string) => boolean): string[] {
  return checkpoint ? checkpoint.completedRunIds.items.filter((mark) => authorize(mark)) : [];
}

/** Recorded decisions remain direct task context, never relevance-ranked evidence. */
export function settledDecisions(task: Task): string {
  const decisions = [...new Set(task.decisions.map((entry) => `${entry.domain}: ${entry.text}`))];
  return decisions.length ? `Settled task decisions (reuse unless new evidence invalidates the premise):\n${decisions.map((entry) => `- ${entry}`).join("\n")}` : "";
}

export function checkpointSummary(task: Task): string {
  const checkpoint = task.checkpoint;
  if (!checkpoint) return "";
  return `Task-state checkpoint: ${checkpointTaskStatus(checkpoint, task)}; ${checkpoint.completedRunIds.items.length} completed run references (${checkpoint.completedRunIds.omitted} omitted). Current files, permissions, bookmarks, artifacts, delivery and live ownership still require revalidation; no claims or completed actions are restored.`;
}

/** Read-only reconciliation. Saved text is never executed, opened as knowledge, or treated as instructions. */
export function reconcileCheckpoint(checkpoint: TaskCheckpoint, context: CheckpointContext): ReconciledCheckpoint {
  const cwd = canonical(context.cwd);
  const current = checkpoint.version === 1 && !!cwd && checkpoint.cwd === cwd && checkpoint.taskId === context.task.id && checkpoint.assignment === assignment(context.task, context.assignment) && checkpoint.nextAction.state === context.task.state && checkpoint.nextAction.paused === context.task.paused;
  const result: ReconciledCheckpoint = { status: current ? "current" : "stale-context", sources: [], evidence: [], bookmarks: [], artifacts: [], ownership: [], delivery: [], requiresBookmarkRevalidation: true };
  if (!current) return result;
  result.sources = currentSources(checkpoint, context);
  const liveEvidence = evidence(context.task).items;
  result.evidence = checkpoint.verification.evidence.items.slice(-MAX_REFS).map((ref) => ({ ...ref, status: liveEvidence.some((live) => live.ref === ref.ref && live.fingerprint === ref.fingerprint) ? "recorded" : "changed-or-unavailable" }));
  result.bookmarks = checkpoint.bookmarks.items.slice(-MAX_REFS).filter((record) => allowed(context.authorize, "bookmark", record.ref));
  result.artifacts = checkpoint.artifacts.items.slice(-MAX_REFS).filter((ref) => allowed(context.authorize, "artifact", ref));
  result.ownership = checkpoint.ownership.items.slice(-MAX_REFS).filter((ref) => allowed(context.authorize, "ownership", ref));
  result.delivery = checkpoint.delivery.items.slice(-MAX_REFS).filter((ref) => allowed(context.authorize, "delivery", ref));
  return result;
}
