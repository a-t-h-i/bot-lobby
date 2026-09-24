import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { AgentRun } from "../schemas/findings.ts";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { activeTask } from "../state/persistence.ts";
import { truncate } from "../text.ts";
import { mascotFrame, setZenActive, zenLines } from "./zen.ts";

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

let zenOn = false;
let zenState: { task: Task | undefined; runs: AgentRun[] } = { task: undefined, runs: [] };

/** Animated checklist + mascot shown above the editor while a task is running. */
class ZenWidget implements Component {
  private tick = 0;
  private readonly tui: TUI;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(tui: TUI) {
    this.tui = tui;
    this.timer = setInterval(() => {
      this.tick += 1;
      this.tui.requestRender();
    }, 250);
  }

  render(width: number): string[] {
    const lines = [...zenLines(zenState.task, zenState.runs, Date.now()), "", ...mascotFrame(this.tick)];
    return lines.map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {}

  dispose(): void {
    clearInterval(this.timer);
  }
}

function leaveZen(ctx: ExtensionContext): void {
  if (!zenOn) return;
  zenOn = false;
  ctx.ui.setWorkingVisible(true);
}

/** Refresh the footer + widget to match the task on disk. */
export function applyStatus(ctx: ExtensionContext, root: string, configDir: string, runs: AgentRun[] = []): void {
  const task = activeTask(root, configDir);
  const sameTask = zenState.task?.id === task?.id;
  const currentRuns = runs.length > 0 ? runs : sameTask ? zenState.runs : [];
  zenState = { task, runs: currentRuns };
  ctx.ui.setStatus(STATUS_KEY, statusText(task));
  const active = Boolean(task && !TERMINAL_STATES.includes(task.state));
  setZenActive(active);
  if (!active) {
    leaveZen(ctx);
    const lines = statusLines(task, currentRuns);
    ctx.ui.setWidget(STATUS_KEY, lines.length > 0 ? lines : undefined);
    return;
  }
  ctx.ui.setWorkingVisible(false);
  if (!zenOn) {
    zenOn = true;
    ctx.ui.setWidget(STATUS_KEY, (tui) => new ZenWidget(tui));
  }
}

export function clearStatus(ctx: ExtensionContext): void {
  setZenActive(false);
  leaveZen(ctx);
  ctx.ui.setStatus(STATUS_KEY, undefined);
  ctx.ui.setWidget(STATUS_KEY, undefined);
}
