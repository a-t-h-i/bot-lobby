/**
 * Zen panel composition.
 *
 * `panelLines` owns the tier choice: the large animated scene at
 * `width >= LARGE_MIN_WIDTH` while the terminal height allows, and the compact
 * animated strip below that. Each agent's live one-word activity and elapsed time
 * arrive on its run. Everything here is pure: expression frames and the spinner
 * tick arrive from the caller, and every timestamp arrives as `now`.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentRun } from "../schemas/findings.ts";
import { TERMINAL_STATES, type Task, type TaskState } from "../schemas/task.ts";
import { truncate } from "../text.ts";
import {
  BANNER_NARROW,
  BANNER_TITLE,
  COMPACT_FRAMES,
  COMPACT_WIDTH,
  SCENE_PROPS,
  SLOT_IDS,
  SLOT_STATE_COLORS,
  SLOT_STATE_GLYPHS,
  SPIN_FRAMES,
  type OraclePose,
  type PanelColor,
  type SlotId,
  type SlotState,
} from "./mascot-art.ts";
import { REST_FRAME } from "./expressions.ts";
import {
  LARGE_MIN_WIDTH,
  MAX_LARGE_LINES,
  MAX_TASK_ROWS,
  largeLines,
  type LargeSceneInput,
  type LargeSlot,
  type LargeTaskRow,
} from "./zen-large.ts";
import { runStatus, sceneMetrics, type SceneMetrics, type SlotView } from "./zen-metrics.ts";

/** Minimal slice of pi's Theme the panel needs; keeps zen.ts decoupled from the agent. */
export interface PanelTheme {
  fg(color: PanelColor, text: string): string;
  bold(text: string): string;
}

/** Human-readable duration such as "9s" or "2m 05s"; a non-finite input reads "0s". */
export function formatDuration(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

function runElapsed(run: AgentRun, now: number): number {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const elapsed = end - Date.parse(run.startedAt);
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
}

/** Upper bound on parsed plan steps so the widget stays bounded. */
export const MAX_PLAN_STEPS = 50;
/** Upper bound on compact-tier panel rows. */
export const MAX_PANEL_LINES = 14;

const CHECKLIST_ROWS = 3;
const PREFIX_CHARS = 32;
const MIN_PREFIX = 8;
const HEADER_LINE = /^\s*(?:#{1,6}\s+\S.*|\*\*[^*]+\*\*)\s*$/;
const STEP_SECTION = /sequence|steps|order/i;
const NUMBERED_STEP_LINE = /^\s*\d+[.)]\s+(.*\S)\s*$/;
const INDENTED_BULLET = /^\s*[*-]\s+(.*\S)\s*$/;
const TOP_LEVEL_BULLET = /^[*-]\s+(.*\S)\s*$/;

export type PlanStepStatus = "done" | "current" | "pending";

export interface PlanStep {
  text: string;
  status: PlanStepStatus;
}

/** Numbered `1.`/`1)` text, or a bullet inside a step section; undefined otherwise. */
function stepText(line: string): string | undefined {
  return NUMBERED_STEP_LINE.exec(line)?.[1] ?? INDENTED_BULLET.exec(line)?.[1];
}

function topBulletText(line: string): string | undefined {
  return TOP_LEVEL_BULLET.exec(line)?.[1];
}

function collectSteps(lines: readonly string[], accept: (line: string) => string | undefined): string[] {
  const found: string[] = [];
  for (const line of lines) {
    const text = accept(line);
    if (text !== undefined) found.push(text);
  }
  return found;
}

/** Body of the first `sequence|steps|order` header, up to the next header; undefined when absent. */
function stepSection(lines: readonly string[]): string[] | undefined {
  const start = lines.findIndex((line) => HEADER_LINE.test(line) && STEP_SECTION.test(line));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (HEADER_LINE.test(line)) break;
    body.push(line);
  }
  return body;
}

/**
 * Step texts from a free-form plan, capped. A `sequence|steps|order` section wins; otherwise
 * numbered lines win; when neither exists, top-level bullets are the last resort, so unrelated
 * bullet lists under other headers never leak into the checklist.
 */
export function planSteps(plan: string): string[] {
  const lines = plan.split("\n");
  const section = stepSection(lines);
  if (section) {
    const sectioned = collectSteps(section, stepText);
    if (sectioned.length > 0) return sectioned.slice(0, MAX_PLAN_STEPS);
  }
  const numbered = collectSteps(lines, (line) => NUMBERED_STEP_LINE.exec(line)?.[1]);
  if (numbered.length > 0) return numbered.slice(0, MAX_PLAN_STEPS);
  return collectSteps(lines, topBulletText).slice(0, MAX_PLAN_STEPS);
}

function normalize(text: string): string {
  return text.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesInstruction(step: string, instruction: string): boolean {
  const hay = normalize(instruction);
  const path = /`([^`]+)`/.exec(step)?.[1];
  if (path && hay.includes(normalize(path))) return true;
  const tail = normalize(step.replace(/`[^`]+`/g, " ").replace(/^[\s:;,.—–-]+/, ""));
  return tail.length >= MIN_PREFIX && hay.includes(tail.slice(0, PREFIX_CHARS));
}

/** The latest worker run carrying an instruction; its step is the current one. */
export function latestWorkerRun(runs: AgentRun[]): AgentRun | undefined {
  let latest: AgentRun | undefined;
  for (const run of runs) {
    if (run.role !== "worker" || !run.instruction) continue;
    if (!latest || Date.parse(run.startedAt) >= Date.parse(latest.startedAt)) latest = run;
  }
  return latest;
}

/** Index of the plan step an instruction targets, -1 when nothing matches. */
export function currentStepIndex(steps: readonly string[], instruction: string | undefined): number {
  return instruction ? steps.findIndex((step) => matchesInstruction(step, instruction)) : -1;
}

function stepStatus(index: number, current: number): PlanStepStatus {
  if (current < 0) return index === 0 ? "current" : "pending";
  if (index < current) return "done";
  return index === current ? "current" : "pending";
}

/** Lowest index not yet in `completed`, or -1 when every step is. */
function nextOpenStep(steps: readonly string[], completed: ReadonlySet<number>): number {
  return steps.findIndex((_text, index) => !completed.has(index));
}

/** Marks every step up to and including `index` as completed. */
function markThrough(completed: Set<number>, index: number): void {
  for (let step = 0; step <= index; step += 1) completed.add(step);
}

/**
 * Steps completed by successful worker runs, in start order. A run whose instruction matches
 * a step completes everything up to that step; a run that matches nothing -- the common case
 * for a reworded instruction -- completes the next still-open step, so the count only grows
 * and a failure can never tick one off.
 */
function completedSteps(steps: readonly string[], runs: AgentRun[]): number {
  const completed = new Set<number>();
  for (const run of runs) {
    if (run.role !== "worker" || run.status !== "success") continue;
    const matched = currentStepIndex(steps, run.instruction);
    const target = matched >= 0 ? matched : nextOpenStep(steps, completed);
    if (target >= 0) markThrough(completed, target);
  }
  return completed.size;
}

/**
 * Done/current/pending per plan step, matched from the latest worker instruction.
 * A succeeded run completes its step, so the next step becomes current (and the
 * last step reads done); running, failed, cancelled and timeout runs keep it current.
 * Progress is monotonic: steps already completed by successful worker runs stay done,
 * and a later call that names an earlier step can never tick it back.
 */
export function planChecklist(plan: string, runs: AgentRun[]): PlanStep[] {
  const steps = planSteps(plan);
  const latest = latestWorkerRun(runs);
  const matched = currentStepIndex(steps, latest?.instruction);
  const latestCurrent = matched >= 0 ? (latest?.status === "success" ? matched + 1 : matched) : -1;
  const current = Math.max(completedSteps(steps, runs), latestCurrent);
  return steps.map((text, index) => ({ text, status: stepStatus(index, current) }));
}

/** Up to `count` consecutive step indexes centered on the current step, hard-capped at `max`. */
export function checklistWindow(steps: readonly PlanStep[], count: number, max = CHECKLIST_ROWS): number[] {
  const size = Math.min(count, max);
  if (steps.length <= size) return steps.map((_step, index) => index);
  const found = steps.findIndex((step) => step.status === "current");
  const current = found < 0 ? steps.length - 1 : found;
  const start = Math.min(Math.max(current - Math.floor((size - 1) / 2), 0), steps.length - size);
  return Array.from({ length: size }, (_value, offset) => start + offset);
}

function stepLine(step: PlanStep, ordinal: number): string {
  const icon = step.status === "done" ? "✓" : step.status === "current" ? "◐" : "○";
  return `  ${icon} ${ordinal}. ${step.text}`;
}

function headerLine(task: Task, now: number, quiet: boolean): string {
  const paused = task.paused ? " (paused)" : "";
  const elapsed = formatDuration(now - Date.parse(task.createdAt));
  const mode = quiet ? "tools hidden (alt+t)" : "tools shown";
  return `bot-lobby ${task.id} · ${task.state}${paused}   ⏱ ${elapsed} · ${mode}`;
}

/** The pending approval or blocker the user must resolve, with its severity. */
function taskAlert(task: Task): { text: string; kind: "warning" | "error" } | undefined {
  const pending = task.approvals.filter((approval) => approval.status === "pending");
  if (pending.length > 0) return { text: `approvals pending: ${pending.map((approval) => approval.id).join(", ")}`, kind: "warning" };
  if (task.blockers.length > 0) return { text: `blocked: ${truncate(task.blockers[0]!.reason, 60)}`, kind: "error" };
  return undefined;
}

const BANNER_WIDTH = 58;
const BANNER_MIN_WIDTH = 60;

/** Boxed title for wide terminals, one-line title otherwise; never wider than `width`. */
export function bannerLines(width: number): string[] {
  if (width < 1) return [];
  if (width < BANNER_MIN_WIDTH) return [truncateToWidth(BANNER_NARROW, width, "")];
  const inner = BANNER_WIDTH - 2;
  const titleWidth = visibleWidth(BANNER_TITLE);
  const left = Math.floor((inner - titleWidth) / 2);
  const border = "─".repeat(inner);
  return [`┌${border}┐`, `│${" ".repeat(left)}${BANNER_TITLE}${" ".repeat(inner - titleWidth - left)}│`, `└${border}┘`];
}


/** One-line replacement for pi's suppressed streaming indicator; names the live activity too. */
export function workingLine(runs: AgentRun[], tick: number, theme?: PanelTheme, now = Date.now()): string {
  const running = runs.filter((run) => run.status === "running");
  const spin = SPIN_FRAMES[Math.abs(tick) % SPIN_FRAMES.length]!;
  if (running.length > 0) {
    const run = running.at(-1)!;
    const spinner = theme ? theme.fg("accent", spin) : spin;
    const activity = run.activity ?? "working";
    return `  ${spinner} agents working (${running.length}) · ${run.domain}/${run.role} ${activity} ${formatDuration(runElapsed(run, now))}`;
  }
  const last = runs.at(-1);
  if (!last) return "  ○ waiting for the first agent…";
  const status = paintStatus(runStatus(last.status), last.status, theme);
  return `  · no agents running · last ${last.domain}/${last.role} ${status} ${formatDuration(runElapsed(last, now))}`;
}

function paintStatus(status: SlotState, text: string, theme?: PanelTheme): string {
  if (!theme) return text;
  const style = SLOT_STATE_COLORS[status];
  const painted = theme.fg(style.color, text);
  return style.bold ? theme.bold(painted) : painted;
}

/* -------------------------------------------------------------------------
 * Expression frames. The caller schedules blinks and emotes (expressions.ts)
 * and passes one frame index per slot and the oracle; the art only wraps it,
 * so nothing here reads a clock or a random source.
 * ---------------------------------------------------------------------- */

/** Caller-chosen expression frame per slot and the oracle; absent reads as rest. */
export type ExpressionFrames = Partial<Record<SlotId | "oracle", number>>;

/** Frame `index` wrapped into the art's frame list; a non-finite index rests. */
function frameAt(frames: readonly string[], index: number): string {
  if (frames.length === 0) return "";
  const at = ((Math.floor(index) % frames.length) + frames.length) % frames.length;
  return frames[at] ?? "";
}

/* -------------------------------------------------------------------------
 * Compact tier (< LARGE_MIN_WIDTH): banner, header, the one-row-per-agent strip
 * and the checklist; the working line names the newest running agent's activity
 * and elapsed. Geometry matches the long-standing 40-column strip.
 * ---------------------------------------------------------------------- */

const COMPACT_GAP = 2;
const COMPACT_INNER = SLOT_IDS.length * COMPACT_WIDTH + (SLOT_IDS.length - 1) * COMPACT_GAP;
const COMPACT_STATUS_GAP = " ".repeat(COMPACT_WIDTH + COMPACT_GAP - 1);

function compactFrame(slot: SlotView, expressions: ExpressionFrames): string {
  return frameAt(COMPACT_FRAMES[slot.id][slot.status], expressions[slot.id] ?? REST_FRAME);
}

function compactRow(content: string, color: PanelColor, theme?: PanelTheme): string {
  const body = truncateToWidth(content, COMPACT_INNER, "", true);
  return `|${theme ? theme.fg(color, body) : body}|`;
}

/** Caption, animated sprites, then the coloured status glyph per slot. */
function compactStrip(state: TaskState, slots: readonly SlotView[], expressions: ExpressionFrames, theme?: PanelTheme): string[] {
  const sprites = slots.map((slot) => paintStatus(slot.status, compactFrame(slot, expressions), theme)).join(" ".repeat(COMPACT_GAP));
  const glyphs = slots.map((slot) => paintStatus(slot.status, SLOT_STATE_GLYPHS[slot.status], theme)).join(COMPACT_STATUS_GAP);
  return [
    compactRow(SCENE_PROPS[state], "dim", theme),
    compactRow(sprites, "muted", theme),
    compactRow(glyphs, "muted", theme),
  ];
}

/** Alert, working line, and the `steps x/y` summary, in priority order. */
function tailLines(task: Task, runs: AgentRun[], now: number, tick: number, steps: PlanStep[], theme?: PanelTheme): string[] {
  const alert = taskAlert(task);
  const rows = alert ? [alert.text] : [];
  rows.push(workingLine(runs, tick, theme, now));
  if (steps.length > 0) {
    const done = steps.filter((step) => step.status === "done").length;
    rows.push(`steps ${done}/${steps.length}`);
  }
  return rows;
}

function checklistLines(steps: PlanStep[], count: number): string[] {
  if (steps.length === 0 || count <= 0) return [];
  return checklistWindow(steps, count).map((index) => stepLine(steps[index]!, index + 1));
}

function compactPanel(
  task: Task,
  runs: AgentRun[],
  now: number,
  quiet: boolean,
  tick: number,
  steps: PlanStep[],
  opts: PanelOptions,
  width: number,
): string[] {
  const metrics = sceneMetrics(task, runs, now);
  const expressions = opts.expressions ?? {};
  const fixed = [...bannerLines(width), headerLine(task, now, quiet), ...compactStrip(task.state, metrics.slots, expressions, opts.theme)];
  const tail = tailLines(task, runs, now, tick, steps, opts.theme);
  const room = Math.max(0, MAX_PANEL_LINES - fixed.length - tail.length);
  return [...fixed, ...tail, ...checklistLines(steps, room)].map((line) => truncateToWidth(line, width));
}

/* -------------------------------------------------------------------------
 * Large tier (>= LARGE_MIN_WIDTH): the animated scene from zen-large.ts.
 * ---------------------------------------------------------------------- */

/** Terminal rows assumed when the caller cannot report them. */
const DEFAULT_ROWS = 40;
/** Share of the terminal height the large scene may use. */
const ROW_FRACTION = 0.75;
/** Below this line budget the large scene loses its agent strip, so compact reads better. */
const MIN_LARGE_LINES = 12;

/** Line budget for the large scene: a clamped fraction of the terminal height. */
export function largeLineBudget(rows: number): number {
  const safe = Number.isFinite(rows) && rows > 0 ? rows : DEFAULT_ROWS;
  return Math.min(MAX_LARGE_LINES, Math.max(0, Math.floor(safe * ROW_FRACTION)));
}

function oraclePose(task: Task): OraclePose {
  return task.paused || TERMINAL_STATES.includes(task.state) ? "dormant" : "orchestrating";
}

function sceneSlots(metrics: SceneMetrics, expressions: ExpressionFrames): LargeSlot[] {
  return metrics.slots.map((slot) => ({
    ...slot,
    frame: expressions[slot.id] ?? REST_FRAME,
  }));
}

function oracleSlot(task: Task, expressions: ExpressionFrames): LargeSceneInput["oracle"] {
  const pose = oraclePose(task);
  return { pose, frame: expressions.oracle ?? REST_FRAME };
}

function sceneTasks(steps: readonly PlanStep[]): LargeTaskRow[] {
  return checklistWindow(steps, MAX_TASK_ROWS, MAX_TASK_ROWS).map((index) => ({
    text: steps[index]!.text,
    status: steps[index]!.status,
  }));
}

function sceneInput(
  task: Task,
  runs: AgentRun[],
  now: number,
  quiet: boolean,
  tick: number,
  steps: PlanStep[],
  expressions: ExpressionFrames,
): LargeSceneInput {
  const metrics = sceneMetrics(task, runs, now);
  const alert = taskAlert(task);
  return {
    taskId: task.id,
    taskTitle: task.title,
    state: task.paused ? `${task.state} (paused)` : task.state,
    elapsedLabel: metrics.elapsedLabel,
    quietHint: quiet ? "tools hidden (alt+t)" : "tools shown",
    tick,
    done: metrics.done,
    total: metrics.total,
    slots: sceneSlots(metrics, expressions),
    tasks: sceneTasks(steps),
    oracle: oracleSlot(task, expressions),
    alert: alert?.text,
    alertKind: alert?.kind,
  };
}

export interface PanelOptions {
  width?: number;
  /** Terminal rows; drives the large tier's line budget. */
  rows?: number;
  /** Spinner frame; only the working line animates off it. */
  tick?: number;
  theme?: PanelTheme;
  /** Caller-scheduled expression frame per slot and the oracle; absent means rest. */
  expressions?: ExpressionFrames;
}

/**
 * Zen panel lines. At `width >= LARGE_MIN_WIDTH` with enough terminal height the
 * large animated scene owns the panel; otherwise the compact strip keeps the
 * banner, header, agent row, alert, live activity/elapsed working line and
 * checklist. No line ever
 * exceeds `width`.
 */
export function panelLines(
  task: Task | undefined,
  runs: AgentRun[],
  now: number,
  quiet: boolean,
  opts: PanelOptions = {},
): string[] {
  if (!task) return [];
  const width = opts.width ?? 100;
  const tick = opts.tick ?? 0;
  const steps = planChecklist(task.plan ?? "", runs);
  const budget = largeLineBudget(opts.rows ?? DEFAULT_ROWS);
  if (width >= LARGE_MIN_WIDTH && budget >= MIN_LARGE_LINES) {
    const scene = largeLines(sceneInput(task, runs, now, quiet, tick, steps, opts.expressions ?? {}), width, budget, opts.theme);
    return scene.map((line) => truncateToWidth(line, width));
  }
  return compactPanel(task, runs, now, quiet, tick, steps, opts, width);
}
