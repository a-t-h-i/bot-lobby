/**
 * Derived zen-scene metrics: plan progress and per-slot status, live activity
 * word and per-agent elapsed.
 * Pure by construction: the only clock input is the `now` argument, and nothing
 * here reads the wall clock, a random source or the environment. Percentages
 * are plan-derived measurements; the ETA alone is an estimate and is labelled.
 */
import type { AgentRun } from "../schemas/findings.ts";
import type { Task } from "../schemas/task.ts";
import { SLOT_IDS, SLOT_LABELS, type SlotId, type SlotState } from "./mascot-art.ts";
import { formatDuration, planChecklist } from "./zen.ts";

export type { SlotId, SlotState };

/** One agent column: its latest run's status, live activity word and elapsed label. */
export interface SlotView {
  id: SlotId;
  label: string;
  status: SlotState;
  /** The run's one-word tool activity, when the backend reported one. */
  activity?: string;
  /** "—" without a run, live since `startedAt` while running, fixed once terminal. */
  elapsedLabel: string;
}

export interface SceneMetrics {
  done: number;
  total: number;
  etaLabel: string;
  elapsedLabel: string;
  slots: SlotView[];
}

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

/** A run's duration label from the injected clock; a malformed timestamp reads "0s". */
function runElapsedLabel(run: AgentRun | undefined, now: number): string {
  if (!run) return "—";
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return formatDuration(end - Date.parse(run.startedAt));
}

function slotView(id: SlotId, runs: AgentRun[], now: number): SlotView {
  const run = latestRunFor(runs, id);
  const status: SlotState = run ? runStatus(run.status) : "idle";
  return { id, label: SLOT_LABELS[id], status, activity: run?.activity, elapsedLabel: runElapsedLabel(run, now) };
}

/** Always an estimate: "ETA —" until a plan step is done, then "ETA ~<duration>". */
function estimateLabel(done: number, total: number, elapsed: number): string {
  if (total === 0 || done === 0 || done >= total) return "ETA —";
  return `ETA ~${formatDuration((elapsed * (total - done)) / done)}`;
}

export function sceneMetrics(task: Task, runs: AgentRun[], now: number): SceneMetrics {
  const checklist = planChecklist(task.plan ?? "", runs);
  const total = checklist.length;
  const done = checklist.filter((step) => step.status === "done").length;
  const summary = { done, total };
  const created = Date.parse(task.createdAt);
  const elapsed = Number.isFinite(created) ? Math.max(0, now - created) : 0;
  return {
    ...summary,
    etaLabel: estimateLabel(summary.done, summary.total, elapsed),
    elapsedLabel: formatDuration(elapsed),
    slots: SLOT_IDS.map((id) => slotView(id, runs, now)),
  };
}
