/**
 * Derived zen-scene metrics: plan progress, per-slot status/percent and a short
 * LOG of real run transitions.
 *
 * Pure by construction: the only clock input is the `now` argument, and nothing
 * here reads the wall clock, a random source or the environment. Percentages
 * are plan-derived measurements; the ETA alone is an estimate and is labelled.
 */
import type { AgentRun } from "../schemas/findings.ts";
import type { Task } from "../schemas/task.ts";
import { SLOT_IDS, SLOT_LABELS, type SlotId, type SlotState } from "./mascot-art.ts";
import { currentStepIndex, formatDuration, latestWorkerRun, planSteps } from "./zen.ts";

export type { SlotId, SlotState };

/** One agent column: its latest run status plus a plan-derived percent. */
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

function planSummary(steps: readonly string[], current: number): { done: number; total: number; progress: number } {
  const done = current > 0 ? current : 0;
  const total = steps.length;
  return { done, total, progress: total > 0 ? Math.round((done / total) * 100) : 0 };
}

/** Percent guarded against non-finite input so a malformed timestamp can never render a NaN. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Measured percent only: a succeeded slot reads 100, a working slot reads the
 * plan step its own latest worker instruction targets (or the shared plan
 * progress when nothing matches), and every other state reads 0.
 */
function measuredPercent(status: SlotState, runs: AgentRun[], id: SlotId, steps: readonly string[], fallback: number): number {
  if (status === "done") return 100;
  if (status !== "working") return 0;
  const own = latestWorkerRun(runs.filter((run) => slotOf(run) === id));
  const index = currentStepIndex(steps, own?.instruction);
  return index >= 0 && steps.length > 0 ? clampPercent((index / steps.length) * 100) : clampPercent(fallback);
}

function slotView(id: SlotId, runs: AgentRun[], steps: readonly string[], fallback: number): SlotView {
  const run = latestRunFor(runs, id);
  const status: SlotState = run ? runStatus(run.status) : "idle";
  return { id, label: SLOT_LABELS[id], status, percent: run ? measuredPercent(status, runs, id, steps, fallback) : 0 };
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
  const steps = planSteps(task.plan ?? "");
  const summary = planSummary(steps, currentStepIndex(steps, latestWorkerRun(runs)?.instruction));
  const created = Date.parse(task.createdAt);
  const elapsed = Number.isFinite(created) ? Math.max(0, now - created) : 0;
  return {
    ...summary,
    etaLabel: estimateLabel(summary.done, summary.total, elapsed),
    elapsedLabel: formatDuration(elapsed),
    slots: SLOT_IDS.map((id) => slotView(id, runs, steps, summary.progress)),
    log: logRows(task, runs),
  };
}
