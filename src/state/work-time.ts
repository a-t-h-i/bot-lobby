/**
 * How long a task's agents have actually worked on it, and which worker runs
 * are under way. Work time is the oracle's turns on the task — which include
 * every agent it runs — and not the time it waits on the user (between turns,
 * and while a dialog is open); the work clock in budget.ts measures it. The
 * session that owns the task keeps it beside the task's state as work.json,
 * refreshed while it works, so every window can show the time ticking and
 * mark the steps being worked on. A file its owner stopped refreshing (the
 * session ended or crashed) reads as stopped.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { taskDirFor } from "./persistence.ts";

/** A worker run under way: the step it works on is found from its instruction. */
export interface ActiveRun {
  runId: string;
  instruction: string;
  startedAt: string;
}

export interface WorkTime {
  /** Work time folded in so far, in ms. */
  workedMs: number;
  /** While the agents work: since when the current stretch counts. */
  runningSince?: string;
  active: ActiveRun[];
  /** When the owning session last wrote it. */
  updatedAt: string;
}

/** The clock as a reader sees it at one moment. */
export interface WorkProjection {
  workedMs: number;
  /** Still counting: the reader adds the time that passes. */
  running: boolean;
  active: ActiveRun[];
}

/** A file older than this is no longer being kept (the owner refreshes it every 30s while it works). */
export const WORK_FRESH_MS = 75_000;

export function workPath(root: string, configDir: string, taskId: string): string {
  return join(taskDirFor(root, configDir, taskId), "work.json");
}

function isWork(value: unknown): value is WorkTime {
  const work = value as Partial<WorkTime> | undefined;
  return Boolean(work && typeof work.workedMs === "number" && typeof work.updatedAt === "string");
}

export function readWork(root: string, configDir: string, taskId: string): WorkTime | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(workPath(root, configDir, taskId), "utf8"));
    if (!isWork(value)) return undefined;
    return { workedMs: value.workedMs, ...(value.runningSince ? { runningSince: value.runningSince } : {}), active: Array.isArray(value.active) ? value.active : [], updatedAt: value.updatedAt };
  } catch {
    return undefined;
  }
}

/** Change a task's work time in place (read afresh, written back atomically), starting it when there is none. */
export function updateWork(root: string, configDir: string, taskId: string, change: (work: WorkTime) => void, now = new Date()): void {
  const work = readWork(root, configDir, taskId) ?? { workedMs: 0, active: [], updatedAt: now.toISOString() };
  change(work);
  work.updatedAt = now.toISOString();
  try {
    const path = workPath(root, configDir, taskId);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(work, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
  } catch {
    // A read-only tree must never fail the workflow; the time just stops being saved.
  }
}

/** What a reader shows now: a stale file counts up to its last refresh and nothing in it is running. */
export function projectWork(work: WorkTime | undefined, now = Date.now()): WorkProjection | undefined {
  if (!work) return undefined;
  const updated = Date.parse(work.updatedAt);
  const fresh = Number.isFinite(updated) && now - updated <= WORK_FRESH_MS;
  const since = work.runningSince ? Date.parse(work.runningSince) : Number.NaN;
  const end = fresh ? now : updated;
  const stretch = Number.isFinite(since) && Number.isFinite(end) ? Math.max(0, end - since) : 0;
  return { workedMs: Math.max(0, work.workedMs) + stretch, running: fresh && Number.isFinite(since), active: fresh ? [...work.active] : [] };
}

/** A task's work time as a reader sees it now; undefined for a task with none (one from before it was kept). */
export function taskWork(root: string, configDir: string, taskId: string, now = Date.now()): WorkProjection | undefined {
  return projectWork(readWork(root, configDir, taskId), now);
}

/* ------------------------------------------------------ worker runs */

/** Worker runs this process has written as under way, per task: the file changes only when a run starts or ends. */
const noted = new Map<string, Set<string>>();

/** A worker run of the task started or ended: the steps it works on read as active while it runs. */
export function noteWorkerRun(root: string, configDir: string, taskId: string, run: { runId: string; instruction?: string; startedAt: string; status: string }): void {
  const running = run.status === "running";
  const ids = noted.get(taskId) ?? new Set<string>();
  if (running === ids.has(run.runId)) return;
  if (running) ids.add(run.runId);
  else ids.delete(run.runId);
  noted.set(taskId, ids);
  updateWork(root, configDir, taskId, (work) => {
    work.active = work.active.filter((entry) => entry.runId !== run.runId);
    if (running) work.active.push({ runId: run.runId, instruction: run.instruction ?? "", startedAt: run.startedAt });
  });
}

/** This process starts keeping a task's time: runs a crashed session left marked as under way are not. */
export function clearStaleRuns(root: string, configDir: string, taskId: string): void {
  if ((noted.get(taskId)?.size ?? 0) > 0) return;
  const work = readWork(root, configDir, taskId);
  if (work && work.active.length > 0) updateWork(root, configDir, taskId, (next) => { next.active = []; });
}

/** Forget the runs noted (tests). */
export function resetNotedRuns(): void {
  noted.clear();
}
