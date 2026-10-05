/**
 * A task's time budget: the minutes the user set (and granted since), the
 * work time spent, and the time each delegation was given. Work time counts
 * while the oracle works on the task — its own turns, which include every
 * agent it runs — and not while it waits on the user (between turns, and
 * while a dialog is open). It lives beside the task's state as budget.json,
 * written by the session that owns the task; every write reads the file
 * afresh, so the clock and the engine never overwrite each other.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { taskDirFor } from "./persistence.ts";
import { readJsonCached } from "./file-cache.ts";
import { clearStaleRuns, updateWork } from "./work-time.ts";

/** What one delegation was given. */
export interface Allotment {
  /** The delegation: a worker run, the scouts, the researcher, the QA gate. */
  id: string;
  who: string;
  what: string;
  /** Minutes given, including any granted after it ran out. */
  minutes: number;
  granted: number;
  startedAt: string;
  endedAt?: string;
  outcome?: "finished" | "out of time" | "stopped";
}

export interface TaskBudget {
  /** Minutes the user set. */
  minutes: number;
  /** Minutes the user granted on top since. */
  granted: number;
  /** Work time spent, in ms. */
  usedMs: number;
  allotments: Allotment[];
}

export const MAX_ALLOTMENTS = 40;
/** Least a worker is given; below this the budget counts as spent. */
export const MIN_ALLOT_MS = 3 * 60_000;
/** Least a scout batch, the researcher or the QA gate is given. */
export const MIN_READ_MS = 2 * 60_000;
/** Kept back for the QA gate until it passes: this share of the budget, at least `QA_RESERVE_MIN_MS`. */
export const QA_RESERVE_SHARE = 0.15;
export const QA_RESERVE_MIN_MS = 5 * 60_000;
/** Time an agent whose time is up has to write its report before it is stopped. */
export const REPORT_GRACE_MS = 2 * 60_000;
/** Longest budget accepted, in minutes. */
export const MAX_BUDGET_MINUTES = 24 * 60;

export function budgetPath(root: string, configDir: string, taskId: string): string {
  return join(taskDirFor(root, configDir, taskId), "budget.json");
}

function isBudget(value: unknown): value is TaskBudget {
  const budget = value as Partial<TaskBudget> | undefined;
  return Boolean(budget && typeof budget.minutes === "number" && typeof budget.usedMs === "number");
}

export function readBudget(root: string, configDir: string, taskId: string): TaskBudget | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(budgetPath(root, configDir, taskId), "utf8"));
    if (!isBudget(value)) return undefined;
    return { minutes: value.minutes, granted: value.granted ?? 0, usedMs: value.usedMs, allotments: Array.isArray(value.allotments) ? value.allotments : [] };
  } catch {
    return undefined;
  }
}

function writeBudget(root: string, configDir: string, taskId: string, budget: TaskBudget): void {
  const path = budgetPath(root, configDir, taskId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...budget, allotments: budget.allotments.slice(-MAX_ALLOTMENTS) }, null, 2)}\n`, "utf8");
}

/** A task's budget as a display reads it every frame: parsed again only when the file changes. */
export function peekBudget(root: string, configDir: string, taskId: string): TaskBudget | undefined {
  const value = readJsonCached(budgetPath(root, configDir, taskId), isBudget);
  return value ? { minutes: value.minutes, granted: value.granted ?? 0, usedMs: value.usedMs, allotments: Array.isArray(value.allotments) ? value.allotments : [] } : undefined;
}

/** Work time spent of the whole, for the lobby's status box; undefined without a budget. */
export function budgetClock(root: string, configDir: string, taskId: string, now = Date.now()): { usedMs: number; totalMs: number } | undefined {
  const budget = peekBudget(root, configDir, taskId);
  return budget ? { usedMs: usedMs(taskId, budget, now), totalMs: (budget.minutes + budget.granted) * 60_000 } : undefined;
}

/** Change a task's budget in place (read afresh, written back); undefined when it has none. */
export function updateBudget(root: string, configDir: string, taskId: string, change: (budget: TaskBudget) => void): TaskBudget | undefined {
  const budget = readBudget(root, configDir, taskId);
  if (!budget) return undefined;
  change(budget);
  try {
    writeBudget(root, configDir, taskId, budget);
  } catch {
    // A read-only tree must never fail a workflow step; the clock just stops being saved.
  }
  return budget;
}

/** Set (or, with 0, remove) a task's budget; time already spent is kept when it changes. */
export function setBudget(root: string, configDir: string, taskId: string, minutes: number): TaskBudget | undefined {
  if (minutes <= 0) {
    rmSync(budgetPath(root, configDir, taskId), { force: true });
    return undefined;
  }
  const current = readBudget(root, configDir, taskId);
  const budget: TaskBudget = current ? { ...current, minutes, granted: 0 } : { minutes, granted: 0, usedMs: 0, allotments: [] };
  writeBudget(root, configDir, taskId, budget);
  return budget;
}

/** Minutes from `90`, `90m`, `90 min`, `1h`, `1.5h`, `1h30`, `1h30m` or `2 hours`; undefined for anything else. */
export function parseMinutes(text: string): number | undefined {
  const match = /^\s*(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)?)?\s*$/i.exec(text);
  if (!match || (!match[1] && !match[2])) return undefined;
  const minutes = Math.round(Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0));
  return minutes > 0 && minutes <= MAX_BUDGET_MINUTES ? minutes : undefined;
}

/** `34m`, `1h 05m`. */
export function formatMinutes(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/* ------------------------------------------------------------ work clock */
/*
 * Every task the session drives has a work clock, budget or not: it keeps the
 * task's work time (work.json, what the lobby shows as "worked") and, when the
 * task has a budget, the time spent of it.
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
    if (spent > 0) updateBudget(clock.root, clock.configDir, taskId, (budget) => { budget.usedMs += spent; });
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

/** Work time spent on a task so far, the running stretch included. */
export function usedMs(taskId: string, budget: TaskBudget, now = Date.now()): number {
  const since = clocks.get(taskId)?.since;
  return budget.usedMs + (since !== undefined ? Math.max(0, now - since) : 0);
}

/** Forget the clocks (tests; a session that ends). */
export function resetClocks(): void {
  clocks.clear();
  turn = false;
  if (flusher) clearInterval(flusher);
  flusher = undefined;
}

/* -------------------------------------------------------------- dividing */

/** Where a budget stands: all of it, spent, left, what is kept for the QA gate, and what the rest may use. */
export interface BudgetState {
  totalMs: number;
  usedMs: number;
  leftMs: number;
  reserveMs: number;
  /** Left once the QA gate's reserve is kept back. */
  windowMs: number;
}

export function budgetState(taskId: string, budget: TaskBudget, qaPassed: boolean, now = Date.now()): BudgetState {
  const totalMs = (budget.minutes + budget.granted) * 60_000;
  const used = usedMs(taskId, budget, now);
  const leftMs = Math.max(0, totalMs - used);
  const reserveMs = qaPassed ? 0 : Math.min(leftMs, Math.max(QA_RESERVE_MIN_MS, totalMs * QA_RESERVE_SHARE));
  return { totalMs, usedMs: used, leftMs, reserveMs, windowMs: Math.max(0, leftMs - reserveMs) };
}

/**
 * What a worker delegation is given: the minutes the oracle asked for (it
 * divides by scope), or an even share of what is left before the QA gate's
 * reserve across the plan's domains still to build; never more than that
 * window. Undefined when the window is too small for any real work.
 */
export function workerAllotment(state: BudgetState, askedMinutes: number | undefined, openSlots: number): { ms: number; note?: string } | undefined {
  if (state.windowMs < MIN_ALLOT_MS) return undefined;
  const asked = askedMinutes && askedMinutes > 0 ? askedMinutes * 60_000 : undefined;
  const wanted = asked ?? state.windowMs / Math.max(1, openSlots);
  const ms = Math.round(Math.min(state.windowMs, Math.max(MIN_ALLOT_MS, wanted)));
  const note = asked && asked > state.windowMs ? `asked for ${formatMinutes(asked)}, but only ${formatMinutes(state.windowMs)} are left before the QA gate's reserve` : undefined;
  return { ms, ...(note ? { note } : {}) };
}

/** What a read-only batch (scouts, the researcher) is given: a share of what is left, within its configured limit. */
export function readerAllotment(state: BudgetState, share: number, limitMs: number): number | undefined {
  if (state.leftMs < MIN_READ_MS) return undefined;
  return Math.round(Math.min(limitMs, state.leftMs, Math.max(MIN_READ_MS, state.leftMs * share)));
}

/** What the QA gate is given: its reserve at least, its configured limit if more is left, never more than is left. */
export function qaAllotment(state: BudgetState, limitMs: number): number | undefined {
  if (state.leftMs < MIN_READ_MS) return undefined;
  return Math.round(Math.min(state.leftMs, Math.max(state.reserveMs, limitMs)));
}

/** The line the oracle and `status` read: `Time budget: 90m (+15m granted) · 34m used · 71m left (14m kept for the QA gate).` */
export function budgetLine(budget: TaskBudget, state: BudgetState): string {
  const granted = budget.granted > 0 ? ` (+${budget.granted}m granted)` : "";
  const reserve = state.reserveMs > 0 ? ` (${formatMinutes(state.reserveMs)} kept for the QA gate)` : "";
  return `Time budget: ${budget.minutes}m${granted} · ${formatMinutes(state.usedMs)} used · ${formatMinutes(state.leftMs)} left${reserve}.`;
}
