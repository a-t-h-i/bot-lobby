import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { AgentRun } from "../schemas/findings.ts";
import type { Task } from "../schemas/task.ts";
import { activeTask } from "../state/persistence.ts";
import { detectProjectRoot } from "../state/project.ts";
import { isSubagentProcess, isQuiet, toggleQuiet } from "./quiet.ts";

export const STATUS_KEY = "bot-lobby";

export function summarizeRun(run: AgentRun): string {
  const icon = run.status === "running" ? "⏳" : run.status === "success" ? "✓" : "✗";
  const state = run.status === "running" ? "" : ` (${run.status})`;
  return `${icon} ${run.domain}/${run.role}${state}${run.attempts > 1 ? ` ×${run.attempts}` : ""}`;
}

/** One-line footer text, always carrying the quiet-mode hint. */
export function statusText(task: Task | undefined, minimized = false): string {
  const mode = isQuiet() ? "tools hidden (alt+t)" : "tools shown";
  if (minimized) return `bot-lobby minimized (ctrl+shift+m) · ${mode}`;
  if (!task) return `bot-lobby · ${mode}`;
  return `bot-lobby ${task.id} · ${task.paused ? `${task.state} (paused)` : task.state} · ${mode}`;
}

/**
 * The session's task state. `live` holds the runs reported in this session;
 * `runs` is the task's persisted worker records overlaid by the live copies,
 * so the checklist replays after a reload.
 */
let zenState: { task: Task | undefined; live: AgentRun[]; runs: AgentRun[] } = { task: undefined, live: [], runs: [] };

/** Upper bound on retained runs so a long task cannot grow the task state without limit. */
export const MAX_RETAINED_RUNS = 128;

/**
 * Merge `incoming` runs into `previous`, keyed by `runId`: a newer copy of a run
 * replaces the old one and moves to the end (so `runs.at(-1)` stays the newest),
 * order is otherwise preserved and only the newest `MAX_RETAINED_RUNS` survive.
 */
export function mergeRuns(previous: readonly AgentRun[], incoming: readonly AgentRun[]): AgentRun[] {
  if (incoming.length === 0) return [...previous];
  const merged = new Map<string, AgentRun>();
  for (const run of previous) merged.set(run.runId, run);
  for (const run of incoming) {
    merged.delete(run.runId);
    merged.set(run.runId, run);
  }
  return [...merged.values()].slice(-MAX_RETAINED_RUNS);
}

/** The task's persisted worker records as runs, oldest first; the panel only reads their plan fields. */
export function persistedRuns(task: Task | undefined): AgentRun[] {
  return (task?.workerRuns ?? []).map((record) => ({
    runId: record.runId,
    taskId: task!.id,
    domain: record.domain,
    role: "worker",
    status: record.status,
    instruction: record.instruction,
    output: "",
    attempts: 1,
    startedAt: record.startedAt,
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
  }));
}

/** Runs are retained without their report text: the panel never reads it and reports can be large. */
function slim(runs: readonly AgentRun[]): AgentRun[] {
  return runs.map((run) => (run.output ? { ...run, output: "" } : run));
}

function setZenState(task: Task | undefined, live: AgentRun[]): void {
  zenState = { task, live, runs: mergeRuns(persistedRuns(task), live) };
}

/** Per-session standard-pi mode: the Master prompt is hidden but ownership stays. */
let minimized = false;

export function isMinimized(): boolean {
  return minimized;
}

/** Told when minimize changes, so the lobby can step aside too. */
let minimizeListener: ((value: boolean) => void) | undefined;

export function onMinimizeChange(listener: ((value: boolean) => void) | undefined): void {
  minimizeListener = listener;
}

export function setMinimized(value: boolean): void {
  if (minimized === value) return;
  minimized = value;
  minimizeListener?.(value);
}

/** Flip minimize/restore and refresh the footer; the session is unchanged. */
export function toggleMinimized(ctx: ExtensionContext, configDir: string): void {
  setMinimized(!minimized);
  applyStatus(ctx, detectProjectRoot(ctx.cwd, configDir), configDir, zenState.live);
  ctx.ui.notify(minimized ? "bot-lobby minimized — ctrl+shift+m or /bot-lobby restore to return" : "bot-lobby restored", "info");
}

/**
 * Refresh the footer to match the task on disk. Runs are merged into the
 * retained set for the same task because each `orchestrate` call reports only its
 * own agents: without retention the qa/reviewer call that follows the workers would
 * evict their successes and the checklist would reset. A new task starts clean.
 */
export function applyStatus(ctx: ExtensionContext, root: string, configDir: string, runs: AgentRun[] = []): void {
  const sessionId = ctx.sessionManager.getSessionId();
  const task = isSubagentProcess() || minimized ? undefined : activeTask(root, configDir, sessionId);
  const sameTask = zenState.task?.id === task?.id;
  setZenState(task, mergeRuns(sameTask ? zenState.live : [], slim(runs)));
  ctx.ui.setStatus(STATUS_KEY, statusText(task, minimized));
}

/** The session's active task as last loaded (undefined when none or minimized). */
export function currentZenTask(): Task | undefined {
  return zenState.task;
}

/** Called with every streamed run update, so the lobby's activity log can follow the agents. */
let runListener: ((runs: readonly AgentRun[]) => void) | undefined;

export function onRunUpdates(listener: ((runs: readonly AgentRun[]) => void) | undefined): void {
  runListener = listener;
}

/**
 * Streamed run updates (start, every activity change, finish) from an in-flight
 * `orchestrate` call. The task on disk does not change mid-call, so this only
 * merges the runs and repaints; `applyStatus` rereads the task once the call ends.
 * Before any task is loaded it falls back to `applyStatus` so the status appears.
 */
export function reportRuns(ctx: ExtensionContext, root: string, configDir: string, runs: AgentRun[]): void {
  runListener?.(runs);
  if (!zenState.task && !minimized) {
    applyStatus(ctx, root, configDir, runs);
    return;
  }
  setZenState(zenState.task, mergeRuns(zenState.live, slim(runs)));
}

export function clearStatus(ctx: ExtensionContext): void {
  zenState = { task: undefined, live: [], runs: [] };
  ctx.ui.setStatus(STATUS_KEY, undefined);
}

/** Register `alt+t`, the reveal-on-demand toggle for built-in tool rows. */
export function registerRevealShortcut(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  pi.registerShortcut("alt+t", {
    description: "bot-lobby: reveal or hide built-in tool rows",
    handler: (ctx) => revealTools(ctx, configDir),
  });
  pi.registerShortcut(Key.ctrlShift("m"), {
    description: "bot-lobby: minimize or restore bot-lobby for this session",
    handler: (ctx) => toggleMinimized(ctx, configDir),
  });
}

function revealTools(ctx: ExtensionContext, configDir: string): void {
  const quiet = toggleQuiet();
  const expanded = ctx.ui.getToolsExpanded();
  ctx.ui.setToolsExpanded(!expanded);
  ctx.ui.setToolsExpanded(expanded);
  applyStatus(ctx, detectProjectRoot(ctx.cwd, configDir), configDir, zenState.live);
  ctx.ui.notify(
    quiet
      ? "bot-lobby: tool rows hidden from now on — alt+t reveals them"
      : "bot-lobby: tool rows shown from now on — ctrl+o expands, alt+t hides",
    "info",
  );
}

/** The session's active task and its runs, as the lobby reads them. */
export function taskSnapshot(): { task: Task | undefined; runs: readonly AgentRun[] } {
  return { task: zenState.task, runs: zenState.runs };
}
