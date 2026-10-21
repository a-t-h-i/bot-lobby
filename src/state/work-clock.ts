/**
 * A task's work clock. Work time counts while the oracle works on the task —
 * its own turns, which include every agent it runs — and not while it waits
 * on the user (between turns, and while a dialog is open). It is saved beside
 * the task's state as work.json (see work-time.ts) by the session that owns
 * the task. Nothing here limits how long an agent or a task may run.
 */
import { clearStaleRuns, updateWork } from "./work-time.ts";

/** `34m`, `1h 05m`. */
export function formatMinutes(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/* ------------------------------------------------------------ work clock */
/*
 * Every task the session drives has a work clock: it keeps the task's work
 * time (work.json, what the lobby shows as "worked"). It measures; it never
 * limits how long anything runs.
 */

interface Clock {
  root: string;
  configDir: string;
  /** The oracle's turn on the task is running. */
  running: boolean;
  /** Dialogs open: the user is being asked, so the clock waits. */
  waits: number;
  /** Since when the current stretch counts, while it does. */
  since?: number;
}

/** Work clocks of the tasks this process drives. */
const clocks = new Map<string, Clock>();
/** How often a running clock is saved, so other windows see time pass (and see it is still kept). */
export const CLOCK_FLUSH_MS = 30_000;
let flusher: ReturnType<typeof setInterval> | undefined;
/** The oracle's turn is running in this process. */
let turn = false;

/** Fold the stretch that counted into the saved totals, and start a new one if it still counts. */
function settle(taskId: string, clock: Clock, now = Date.now()): void {
  let spent = 0;
  if (clock.since !== undefined) {
    spent = Math.max(0, now - clock.since);
    clock.since = undefined;
  }
  if (clock.running && clock.waits === 0) clock.since = now;
  const since = clock.since;
  updateWork(clock.root, clock.configDir, taskId, (work) => {
    work.workedMs += spent;
    if (since !== undefined) work.runningSince = new Date(since).toISOString();
    else delete work.runningSince;
  }, new Date(now));
}

function ensureFlusher(): void {
  if (flusher) return;
  flusher = setInterval(() => {
    for (const [taskId, clock] of clocks) if (clock.running) settle(taskId, clock);
  }, CLOCK_FLUSH_MS);
  flusher.unref();
}

/** The oracle's turn started: a task it drives, or starts within the turn, is being worked on. */
export function turnStarted(): void {
  turn = true;
}

/** The oracle started a turn on a task (or took one up within it): its clock runs. */
export function startClock(root: string, configDir: string, taskId: string): void {
  let clock = clocks.get(taskId);
  if (!clock) {
    clock = { root, configDir, running: false, waits: 0 };
    clocks.set(taskId, clock);
    clearStaleRuns(root, configDir, taskId);
  }
  if (clock.running) return;
  clock.running = true;
  settle(taskId, clock);
  ensureFlusher();
}

/**
 * The task the session drives now, after a step that may have started, ended or taken over one: while
 * a turn runs, its clock runs and any other task's stops.
 */
export function clockTask(root: string, configDir: string, taskId: string | undefined): void {
  for (const [id, clock] of clocks) {
    if (id === taskId || !clock.running) continue;
    clock.running = false;
    settle(id, clock);
  }
  if (taskId && turn) startClock(root, configDir, taskId);
}

/** The oracle's turn ended: the clocks stop until the next one. */
export function stopClocks(): void {
  turn = false;
  for (const [taskId, clock] of clocks) {
    if (!clock.running && clock.since === undefined) continue;
    clock.running = false;
    settle(taskId, clock);
  }
}

/** The user is being asked: every clock waits (nested dialogs each call this and `resumeClocks`). */
export function pauseClocks(): void {
  for (const [taskId, clock] of clocks) {
    clock.waits += 1;
    settle(taskId, clock);
  }
}

export function resumeClocks(): void {
  for (const [taskId, clock] of clocks) {
    clock.waits = Math.max(0, clock.waits - 1);
    settle(taskId, clock);
  }
}

/** Run `ask` (a dialog) with every clock stopped: time spent waiting on the user is not the task's. */
export async function whileAsking<T>(ask: () => Promise<T>): Promise<T> {
  pauseClocks();
  try {
    return await ask();
  } finally {
    resumeClocks();
  }
}

/** Forget the clocks (tests; a session that ends). */
export function resetClocks(): void {
  clocks.clear();
  turn = false;
  if (flusher) clearInterval(flusher);
  flusher = undefined;
}
