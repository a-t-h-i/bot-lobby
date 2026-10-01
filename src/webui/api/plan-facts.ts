/**
 * What the Lobby header and the Tasks calls both read of a task's plan: the
 * worker records as runs, and the plan's checklist. Kept here (not via
 * `persistedRuns`) so the server never loads the TUI.
 */
import { planChecklist, type PlanStep } from "../../pi/plan-checklist.ts";
import type { AgentRun } from "../../schemas/findings.ts";
import type { Task } from "../../schemas/task.ts";

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

/** The plan's steps with their state; none when the task has no plan. */
export function taskSteps(task: Task): PlanStep[] {
  return task.plan ? planChecklist(task.plan, persistedTaskRuns(task)) : [];
}
