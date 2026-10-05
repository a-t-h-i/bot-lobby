/**
 * What the Lobby header and the Tasks calls both read of a task's plan: the
 * worker records as runs, the plan's checklist, the steps being worked on
 * right now and the work time. Kept here (not via `persistedRuns`) so the
 * server never loads the TUI.
 */
import { planChecklist, planSteps, stepWork, type PlanStep } from "../../pi/plan-checklist.ts";
import type { AgentRun } from "../../schemas/findings.ts";
import type { Task } from "../../schemas/task.ts";
import type { WorkProjection } from "../../state/work-time.ts";

/** Worker records as runs, the same projection the terminal checklist reads. */
export function persistedTaskRuns(task: Task): AgentRun[] {
  return (task.workerRuns ?? []).map((record) => ({
    runId: record.runId,
    taskId: task.id,
    domain: record.domain,
    role: "worker" as const,
    status: record.status,
    instruction: record.instruction,
    output: "",
    attempts: 1,
    startedAt: record.startedAt,
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
  }));
}

/** The worker runs under way (from the owner's work file) that have not finished yet, as running runs. */
function activeRuns(task: Task, work: WorkProjection | undefined): AgentRun[] {
  const finished = new Set((task.workerRuns ?? []).map((record) => record.runId));
  return (work?.active ?? [])
    .filter((run) => !finished.has(run.runId))
    .map((run) => ({ runId: run.runId, taskId: task.id, domain: "backend" as const, role: "worker" as const, status: "running" as const, instruction: run.instruction, output: "", attempts: 1, startedAt: run.startedAt }));
}

/** The plan's steps with their state; none when the task has no plan. */
export function taskSteps(task: Task): PlanStep[] {
  return task.plan ? planChecklist(task.plan, persistedTaskRuns(task)) : [];
}

/** One step as the lobby shows it: its state, and while a worker is on it, how long they have worked on it. */
export interface StepView {
  text: string;
  status: PlanStep["status"];
  active: boolean;
  /** Worker time on the step, in ms. */
  workedMs: number;
}

/**
 * The plan's steps with their state, which ones a worker is on right now and
 * the worker time on each. A step being worked on is never done, so steps run
 * side by side all read active.
 */
export function stepViews(task: Task, work: WorkProjection | undefined, now = Date.now()): StepView[] {
  if (!task.plan) return [];
  const runs = [...persistedTaskRuns(task), ...activeRuns(task, work)];
  const checklist = planChecklist(task.plan, runs);
  const times = stepWork(planSteps(task.plan), runs, now);
  return checklist.map((step, index) => {
    const time = times[index] ?? { ms: 0, active: false };
    return { text: step.text, status: time.active ? "current" : step.status, active: time.active, workedMs: Math.round(time.ms) };
  });
}
