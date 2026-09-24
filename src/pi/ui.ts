import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentRun } from "../schemas/findings.ts";
import type { Task } from "../schemas/task.ts";
import { activeTask } from "../state/persistence.ts";
import { truncate } from "../text.ts";

export const STATUS_KEY = "dev-house";

export function summarizeRun(run: AgentRun): string {
  const icon = run.status === "running" ? "⏳" : run.status === "success" ? "✓" : "✗";
  const state = run.status === "running" ? "" : ` (${run.status})`;
  return `${icon} ${run.domain}/${run.role}${state}${run.attempts > 1 ? ` ×${run.attempts}` : ""}`;
}

/** One-line footer text for the active task. */
export function statusText(task: Task | undefined): string | undefined {
  if (!task) return undefined;
  return `dev-house ${task.id} · ${task.paused ? `${task.state} (paused)` : task.state}`;
}

/** Widget lines: task, request, pending decisions, blockers, live agents. */
export function statusLines(task: Task | undefined, runs: AgentRun[] = []): string[] {
  if (!task) return [];
  const lines = [statusText(task)!, truncate(task.title, 80)];
  const pending = task.approvals.filter((approval) => approval.status === "pending");
  if (pending.length > 0) lines.push(`approvals pending: ${pending.map((approval) => approval.id).join(", ")}`);
  if (task.blockers.length > 0) lines.push(`blocked: ${truncate(task.blockers[0]!.reason, 60)}`);
  if (runs.length > 0) lines.push(runs.map(summarizeRun).join("  "));
  return lines;
}

/** Refresh the footer + widget to match the task on disk. */
export function applyStatus(ctx: ExtensionContext, root: string, configDir: string, runs: AgentRun[] = []): void {
  const task = activeTask(root, configDir);
  ctx.ui.setStatus(STATUS_KEY, statusText(task));
  const lines = statusLines(task, runs);
  ctx.ui.setWidget(STATUS_KEY, lines.length > 0 ? lines : undefined);
}

export function clearStatus(ctx: ExtensionContext): void {
  ctx.ui.setStatus(STATUS_KEY, undefined);
  ctx.ui.setWidget(STATUS_KEY, undefined);
}
