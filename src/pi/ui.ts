import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { AgentRun } from "../schemas/findings.ts";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { activeTask } from "../state/persistence.ts";
import { detectProjectRoot } from "../state/project.ts";
import { advanceExpression, anyPlaying, createExpression, FAST_TICK_MS, type ExpressionState } from "./expressions.ts";
import { SLOT_IDS } from "./mascot-art.ts";
import { isQuiet, isSubagentProcess, toggleQuiet } from "./quiet.ts";
import { panelLines, type ExpressionFrames } from "./zen.ts";

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

let zenOn = false;

/**
 * Widget state. `live` holds the runs reported in this session; `runs` is what the
 * panel draws: the task's persisted worker records overlaid by the live copies,
 * so the checklist replays after a reload. `version` bumps on every change and
 * keys the widget's render cache.
 */
let zenState: { task: Task | undefined; live: AgentRun[]; runs: AgentRun[] } = { task: undefined, live: [], runs: [] };
let zenVersion = 0;

/** Latest master tool activity; the oracle's speech bubble shows it. */
let oracleActivity: string | undefined;

/** The mounted widget, so run and activity updates can repaint without waiting a tick. */
let mountedWidget: { refresh(): void } | undefined;

function touch(): void {
  zenVersion += 1;
  mountedWidget?.refresh();
}

/** Record the master's current activity word (see events.ts); undefined means it waits on the user. */
export function setOracleActivity(activity: string | undefined): void {
  if (activity === oracleActivity) return;
  oracleActivity = activity;
  touch();
}

/** Upper bound on retained runs so a long task cannot grow the widget state without limit. */
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
  touch();
}

/** Per-session standard-pi mode: the widget and Master prompt are hidden but ownership stays. */
let minimized = false;

export function isMinimized(): boolean {
  return minimized;
}

export function setMinimized(value: boolean): void {
  minimized = value;
}

/** Flip minimize/restore and refresh the footer; the session is unchanged. */
export function toggleMinimized(ctx: ExtensionContext, configDir: string): void {
  setMinimized(!minimized);
  applyStatus(ctx, detectProjectRoot(ctx.cwd, configDir), configDir, zenState.live);
  ctx.ui.notify(minimized ? "bot-lobby minimized — ctrl+shift+m or /bot-lobby restore to return" : "bot-lobby restored", "info");
}

export const LIVE_TICK_MS = 250;
export const IDLE_TICK_MS = 1000;

/** Fast frames while an agent works or the task is live; slow frames when it is quiet. */
function isLive(): boolean {
  if (zenState.runs.some((run) => run.status === "running")) return true;
  const task = zenState.task;
  return Boolean(task && !TERMINAL_STATES.includes(task.state) && !task.paused);
}

function liveTickDelay(): number {
  return isLive() ? LIVE_TICK_MS : IDLE_TICK_MS;
}

/** Tick delay for the zen clock: fastest while an expression plays, so no blink or emote step is skipped. */
export function expressionTickDelay(states: readonly ExpressionState[], now: number, live: boolean): number {
  if (anyPlaying(states, now)) return FAST_TICK_MS;
  return live ? LIVE_TICK_MS : IDLE_TICK_MS;
}

/** Every sprite with its own expression schedule. */
type ExpressionKey = keyof ExpressionFrames;
const EXPRESSION_KEYS: readonly ExpressionKey[] = [...SLOT_IDS, "oracle"];

/** Animated zen scene + plan checklist shown above the editor while a task is active. */
class ZenWidget implements Component {
  private tick = 0;
  private cache: { key: string; theme: Theme; lines: string[] } | undefined;
  private delay = liveTickDelay();
  private timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private readonly expressions: Record<ExpressionKey, ExpressionState>;
  private readonly tui: TUI;
  private readonly theme: () => Theme;
  private readonly rng: () => number;

  constructor(tui: TUI, theme: () => Theme, rng: () => number = Math.random) {
    this.tui = tui;
    this.theme = theme;
    this.rng = rng;
    const now = Date.now();
    const entries = EXPRESSION_KEYS.map((key) => [key, createExpression(now, rng)] as const);
    this.expressions = Object.fromEntries(entries) as Record<ExpressionKey, ExpressionState>;
    this.timer = setInterval(() => this.advance(), this.delay);
    mountedWidget = this;
  }

  /** Repaint now: state changed between ticks. */
  refresh(): void {
    if (!this.disposed) this.tui.requestRender();
  }

  private advance(): void {
    if (this.disposed) return;
    this.tick += 1;
    const now = Date.now();
    this.play(now);
    this.retime(now);
    this.tui.requestRender();
  }

  private play(now: number): void {
    for (const key of EXPRESSION_KEYS) this.expressions[key] = advanceExpression(this.expressions[key], now, this.rng);
  }

  /** One interval, retimed when work starts or stops or an expression plays. */
  private retime(now: number): void {
    const delay = expressionTickDelay(Object.values(this.expressions), now, isLive());
    if (delay === this.delay) return;
    this.delay = delay;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.advance(), delay);
  }

  private frames(): Partial<Record<ExpressionKey, number>> {
    return Object.fromEntries(EXPRESSION_KEYS.map((key) => [key, this.expressions[key].frame]));
  }

  /**
   * The panel only changes with the tick, an expression frame, the widget state or
   * the elapsed second, so every other repaint (typing in the editor, streaming
   * output) reuses the last lines instead of recomposing the scene.
   */
  render(width: number): string[] {
    const now = Date.now();
    const rows = this.tui.terminal.rows;
    const theme = this.theme();
    const expressions = this.frames();
    const quiet = isQuiet();
    const frameKey = EXPRESSION_KEYS.map((key) => expressions[key] ?? 0).join(",");
    const key = `${width}|${rows}|${this.tick}|${frameKey}|${zenVersion}|${Math.floor(now / 1000)}|${quiet}`;
    if (this.cache && this.cache.key === key && this.cache.theme === theme) return this.cache.lines;
    const opts = { width, rows, tick: this.tick, theme, expressions, oracleActivity };
    const lines = panelLines(zenState.task, zenState.runs, now, quiet, opts).map((line) => truncateToWidth(line, width));
    this.cache = { key, theme, lines };
    return lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    if (mountedWidget === this) mountedWidget = undefined;
  }
}

function leaveZen(ctx: ExtensionContext): void {
  if (!zenOn) return;
  zenOn = false;
  ctx.ui.setWorkingVisible(true);
  ctx.ui.setWorkingIndicator();
}

/**
 * Refresh the footer + widget to match the task on disk. Runs are merged into the
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
  const active = Boolean(task && !TERMINAL_STATES.includes(task.state));
  if (!active) {
    leaveZen(ctx);
    ctx.ui.setWidget(STATUS_KEY, undefined);
    return;
  }
  ctx.ui.setWorkingVisible(false);
  ctx.ui.setWorkingIndicator({ frames: [] });
  if (!zenOn) {
    zenOn = true;
    ctx.ui.setWidget(STATUS_KEY, (tui) => new ZenWidget(tui, () => ctx.ui.theme));
  }
}

/**
 * Streamed run updates (start, every activity change, finish) from an in-flight
 * `orchestrate` call. The task on disk does not change mid-call, so this only
 * merges the runs and repaints; `applyStatus` rereads the task once the call ends.
 * Before any task is loaded it falls back to `applyStatus` so the widget appears.
 */
export function reportRuns(ctx: ExtensionContext, root: string, configDir: string, runs: AgentRun[]): void {
  if (!zenState.task && !minimized) {
    applyStatus(ctx, root, configDir, runs);
    return;
  }
  setZenState(zenState.task, mergeRuns(zenState.live, slim(runs)));
}

export function clearStatus(ctx: ExtensionContext): void {
  leaveZen(ctx);
  oracleActivity = undefined;
  zenState = { task: undefined, live: [], runs: [] };
  ctx.ui.setStatus(STATUS_KEY, undefined);
  ctx.ui.setWidget(STATUS_KEY, undefined);
}

/** Register `alt+t`, the reveal-on-demand toggle for built-in tool rows. */
export function registerRevealShortcut(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  pi.registerShortcut("alt+t", {
    description: "bot-lobby: reveal or hide built-in tool rows",
    handler: (ctx) => revealTools(ctx, configDir),
  });
  pi.registerShortcut(Key.ctrlShift("m"), {
    description: "bot-lobby: minimize or restore the widget for this session",
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
