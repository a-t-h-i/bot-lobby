/**
 * Derived zen-scene metrics: plan progress and per-slot status, live activity
 * word and per-agent elapsed.
 * Pure by construction: the only clock input is the `now` argument, and nothing
 * here reads the wall clock, a random source or the environment. Percentages
 * are plan-derived measurements.
 */
import type { AgentRun } from "../schemas/findings.ts";
import type { Task } from "../schemas/task.ts";
import { SLOT_IDS, SLOT_LABELS, type SlotId, type SlotState } from "./mascot-art.ts";
import { formatDuration, planChecklist } from "./zen.ts";
import { QUIET_MS, quietFor, slotOf } from "./run-summary.ts";

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
  /** Something about a working agent worth flagging in its status row. */
  flag?: SlotFlag;
}

/** Status-row flags for a working agent, in priority order: waiting on a file, gone quiet, retrying. */
export type SlotFlag = { kind: "waiting" } | { kind: "quiet"; ms: number } | { kind: "retry" };

function slotFlag(run: AgentRun | undefined, now: number): SlotFlag | undefined {
  if (!run || run.status !== "running") return undefined;
  if (run.waitingFor) return { kind: "waiting" };
  const quiet = quietFor(run, now);
  if (quiet >= QUIET_MS) return { kind: "quiet", ms: quiet };
  if (run.noteKind === "warning" && run.note && /retry/.test(run.note)) return { kind: "retry" };
  return undefined;
}

export interface SceneMetrics {
  done: number;
  total: number;
  elapsedLabel: string;
  slots: SlotView[];
}

/** Latest run state per slot: running -> working, success -> done, everything else -> failed. */
export function runStatus(status: AgentRun["status"]): SlotState {
  if (status === "running") return "working";
  return status === "success" ? "done" : "failed";
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
  const flag = slotFlag(run, now);
  return { id, label: SLOT_LABELS[id], status, activity: run?.activity, elapsedLabel: runElapsedLabel(run, now), ...(flag ? { flag } : {}) };
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
    elapsedLabel: formatDuration(elapsed),
    slots: SLOT_IDS.map((id) => slotView(id, runs, now)),
  };
}
