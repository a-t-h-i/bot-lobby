/**
 * Derived zen-scene metrics: plan progress, per-slot status/percent and a short
 * LOG of real run transitions.
 *
 * Pure by construction: the only clock input is the `now` argument, and nothing
 * here reads the wall clock, a random source or the environment. Every
 * percentage is an estimate and is labelled as one.
 */
import type { AgentRun } from "../schemas/findings.ts";
import type { Task } from "../schemas/task.ts";
import { SLOT_IDS, SLOT_LABELS, type SlotId, type SlotState } from "./mascot-art.ts";
import { currentStepIndex, formatDuration, latestWorkerRun, planChecklist, planSteps, type PlanStep } from "./zen.ts";

export type { SlotId, SlotState };

/** One agent column: its latest run status plus an estimated percent. */
export interface SlotView {
  id: SlotId;
  label: string;
  status: SlotState;
  percent: number;
}

/** One LOG line: a real run transition, or the oracle's task-creation row. */
export interface LogRow {
  time: string;
  label: string;
  status: SlotState | "oracle";
}

export interface SceneMetrics {
  done: number;
  total: number;
  progress: number;
  etaLabel: string;
  elapsedLabel: string;
  slots: SlotView[];
  log: LogRow[];
}

/** LOG rows drawn: one oracle row plus the five most recent runs. */
export const LOG_CAP = 6;

/**
 * A running slot that is not on the current plan step has no measured progress,
 * so it reports a time stub that saturates just below the ceiling: ten minutes
 * of its own work reads as 95% and never as "done".
 */
const STUB_CEILING = 95;
const STUB_FULL_MS = 600_000;

const ORACLE_LABEL = "ORACLE";

/** Short domain tags keep a researcher's source domain inside the 8-column LOG label. */
const DOMAIN_TAGS: Record<AgentRun["domain"], string> = { designer: "DES", backend: "BE", qa: "QA" };

/** Latest run state per slot: running -> working, success -> done, everything else -> failed. */
export function runStatus(status: AgentRun["status"]): SlotState {
  if (status === "running") return "working";
  return status === "success" ? "done" : "failed";
}

/** The column a run belongs to; a researcher reports under RESEARCH from any domain. */
function slotOf(run: AgentRun): SlotId {
  if (run.role === "researcher") return "research";
  if (run.domain === "backend") return "dev";
  return run.domain === "designer" ? "design" : "qa";
}

function latestRunFor(runs: AgentRun[], id: SlotId): AgentRun | undefined {
  let latest: AgentRun | undefined;
  for (const run of runs) {
    if (slotOf(run) !== id) continue;
    if (!latest || Date.parse(run.startedAt) >= Date.parse(latest.startedAt)) latest = run;
  }
  return latest;
}

/** The slot working the current plan step, or undefined when no worker run matches one. */
function activeSlot(plan: string, runs: AgentRun[]): SlotId | undefined {
  const run = latestWorkerRun(runs);
  const index = currentStepIndex(planSteps(plan), run?.instruction);
  return run && index >= 0 ? slotOf(run) : undefined;
}

function planProgress(steps: readonly PlanStep[]): { done: number; total: number; progress: number } {
  const done = steps.filter((step) => step.status === "done").length;
  const total = steps.length;
  return { done, total, progress: total > 0 ? Math.round((done / total) * 100) : 0 };
}

function elapsedMs(run: AgentRun, now: number): number {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return Math.max(0, end - Date.parse(run.startedAt));
}

/** Running, not the active slot: an estimate from how long its own run has been going. */
function stubPercent(run: AgentRun, now: number): number {
  return Math.min(STUB_CEILING, Math.round((elapsedMs(run, now) / STUB_FULL_MS) * 100));
}

/**
 * Estimated percent. The active slot carries the plan's own progress, a slot
 * whose run succeeded reads 100, a running slot that is not active reads a time
 * stub, and everything else reads 0.
 */
function slotPercent(id: SlotId, run: AgentRun | undefined, active: SlotId | undefined, progress: number, now: number): number {
  if (active === id) return progress;
  if (!run) return 0;
  if (run.status === "success") return 100;
  return run.status === "running" ? stubPercent(run, now) : 0;
}

/** Always an estimate: "ETA —" until a plan step is done, then "ETA ~<duration>". */
function estimateLabel(done: number, total: number, elapsed: number): string {
  if (total === 0 || done === 0) return "ETA —";
  return `ETA ~${formatDuration((elapsed * (total - done)) / done)}`;
}

/** Local HH:MM of a timestamp, using the process locale's time zone. */
function localClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "--:--";
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

function runLabel(run: AgentRun): string {
  return run.role === "researcher" ? `RES/${DOMAIN_TAGS[run.domain]}` : SLOT_LABELS[slotOf(run)];
}

/** Oldest first: the oracle's task-creation row, then the most recent runs. */
function logRows(task: Task, runs: AgentRun[]): LogRow[] {
  const recent = [...runs]
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .slice(-(LOG_CAP - 1))
    .map((run) => ({ time: localClock(run.startedAt), label: runLabel(run), status: runStatus(run.status) }));
  return [{ time: localClock(task.createdAt), label: ORACLE_LABEL, status: "oracle" as const }, ...recent];
}

export function sceneMetrics(task: Task, runs: AgentRun[], now: number): SceneMetrics {
  const plan = task.plan ?? "";
  const summary = planProgress(planChecklist(plan, runs));
  const active = activeSlot(plan, runs);
  const created = Date.parse(task.createdAt);
  const elapsed = Number.isFinite(created) ? Math.max(0, now - created) : 0;
  const slots = SLOT_IDS.map((id) => {
    const run = latestRunFor(runs, id);
    return {
      id,
      label: SLOT_LABELS[id],
      status: run ? runStatus(run.status) : ("idle" as const),
      percent: slotPercent(id, run, active, summary.progress, now),
    };
  });
  return {
    ...summary,
    etaLabel: estimateLabel(summary.done, summary.total, elapsed),
    elapsedLabel: formatDuration(elapsed),
    slots,
    log: logRows(task, runs),
  };
}
