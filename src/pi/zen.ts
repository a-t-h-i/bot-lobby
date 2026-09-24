import type { AgentRun } from "../schemas/findings.ts";
import type { Task } from "../schemas/task.ts";
import { truncate } from "../text.ts";

/** ASCII mascot frames; the zen widget advances one frame per animation tick. */
export const MASCOT_FRAMES: readonly (readonly string[])[] = [
  ["   (\\_/)", "   (•_•)", "   / > \\"],
  ["   (\\_/)", "   (-_-)", "   / > \\"],
  ["   (\\_/)", "   (•_•)", "   / > \\"],
  ["   (\\_/)", "   (^_^)", "   / > \\"],
];

let zenActive = false;

/** True while a dev-house task is running; the orchestrate row hides itself then. */
export function isZenActive(): boolean {
  return zenActive;
}

export function setZenActive(active: boolean): void {
  zenActive = active;
}

/** Human-readable duration such as "9s" or "2m 05s". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

function runElapsed(run: AgentRun, now: number): number {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return end - Date.parse(run.startedAt);
}

function runLine(run: AgentRun, now: number): string {
  const icon = run.status === "running" ? "◐" : run.status === "success" ? "✓" : "✗";
  const retry = run.attempts > 1 ? ` ×${run.attempts}` : "";
  const status = run.status.padEnd(8);
  return `  ${icon} ${run.domain}/${run.role}  ${status} ${formatDuration(runElapsed(run, now))}${retry}`;
}

/** Checklist lines for the zen widget: task header, pending decisions, agent runs. */
export function zenLines(task: Task | undefined, runs: AgentRun[], now: number): string[] {
  if (!task) return [];
  const paused = task.paused ? " (paused)" : "";
  const elapsed = formatDuration(now - Date.parse(task.createdAt));
  const lines = [`dev-house ${task.id} · ${task.state}${paused}   ⏱ ${elapsed}`];
  const pending = task.approvals.filter((approval) => approval.status === "pending");
  if (pending.length > 0) lines.push(`approvals pending: ${pending.map((approval) => approval.id).join(", ")}`);
  if (task.blockers.length > 0) lines.push(`blocked: ${truncate(task.blockers[0]!.reason, 60)}`);
  if (runs.length === 0) lines.push("  ○ waiting for the first agent…");
  else for (const run of runs) lines.push(runLine(run, now));
  return lines;
}

export function mascotFrame(tick: number): string[] {
  return [...MASCOT_FRAMES[Math.abs(tick) % MASCOT_FRAMES.length]!];
}
