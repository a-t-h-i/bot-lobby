import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { AgentRun } from "../schemas/findings.ts";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { activeTask } from "../state/persistence.ts";
import { detectProjectRoot } from "../state/project.ts";
import { isQuiet, isSubagentProcess, toggleQuiet } from "./quiet.ts";
import { panelLines } from "./zen.ts";

export const STATUS_KEY = "dev-house";

export function summarizeRun(run: AgentRun): string {
  const icon = run.status === "running" ? "⏳" : run.status === "success" ? "✓" : "✗";
  const state = run.status === "running" ? "" : ` (${run.status})`;
  return `${icon} ${run.domain}/${run.role}${state}${run.attempts > 1 ? ` ×${run.attempts}` : ""}`;
}

/** One-line footer text, always carrying the quiet-mode hint. */
export function statusText(task: Task | undefined): string {
  const mode = isQuiet() ? "tools hidden (alt+t)" : "tools shown";
  if (!task) return `dev-house · ${mode}`;
  return `dev-house ${task.id} · ${task.paused ? `${task.state} (paused)` : task.state} · ${mode}`;
}

let zenOn = false;
let zenState: { task: Task | undefined; runs: AgentRun[] } = { task: undefined, runs: [] };

/** Animated plan checklist + mascot shown above the editor while a task is running. */
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
    const lines = panelLines(zenState.task, zenState.runs, Date.now(), isQuiet(), this.tick);
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
  if (!active) {
    leaveZen(ctx);
    ctx.ui.setWidget(STATUS_KEY, undefined);
    return;
  }
  ctx.ui.setWorkingVisible(false);
  if (!zenOn) {
    zenOn = true;
    ctx.ui.setWidget(STATUS_KEY, (tui) => new ZenWidget(tui));
  }
}

export function clearStatus(ctx: ExtensionContext): void {
  leaveZen(ctx);
  ctx.ui.setStatus(STATUS_KEY, undefined);
  ctx.ui.setWidget(STATUS_KEY, undefined);
}

/** Register `alt+t`, the reveal-on-demand toggle for built-in tool rows. */
export function registerRevealShortcut(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  pi.registerShortcut("alt+t", {
    description: "dev-house: reveal or hide built-in tool rows",
    handler: (ctx) => revealTools(ctx, configDir),
  });
}

function revealTools(ctx: ExtensionContext, configDir: string): void {
  const quiet = toggleQuiet();
  const expanded = ctx.ui.getToolsExpanded();
  ctx.ui.setToolsExpanded(!expanded);
  ctx.ui.setToolsExpanded(expanded);
  applyStatus(ctx, detectProjectRoot(ctx.cwd, configDir), configDir, zenState.runs);
  ctx.ui.notify(
    quiet
      ? "dev-house: tool rows hidden from now on — alt+t reveals them"
      : "dev-house: tool rows shown from now on — ctrl+o expands, alt+t hides",
    "info",
  );
}
