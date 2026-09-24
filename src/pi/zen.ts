/**
 * Zen panel composition.
 *
 * `panelLines` owns the tier choice: the large animated scene at
 * `width >= LARGE_MIN_WIDTH` while the terminal height allows, and the compact
 * animated strip below that. Everything here is pure: the frame clock is a
 * function of the caller's `tick`, and every timestamp arrives as `now`.
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
  ORACLE_FRAMES,
  SCENE_PROPS,
  SLOT_FRAMES,
  SLOT_IDS,
  SLOT_STATE_COLORS,
  SLOT_STATE_GLYPHS,
  type OraclePose,
  type PanelColor,
  type SlotState,
} from "./mascot-art.ts";
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

const STEP_LINE = /^\s*\d+\.\s+(.*\S)\s*$/;
const CHECKLIST_ROWS = 3;
const PREFIX_CHARS = 32;
const MIN_PREFIX = 8;

export type PlanStepStatus = "done" | "current" | "pending";

export interface PlanStep {
  text: string;
  status: PlanStepStatus;
}

/** Numbered `1. \`path\`: …` lines from a free-form plan, capped. */
export function planSteps(plan: string): string[] {
  const steps: string[] = [];
  for (const line of plan.split("\n")) {
    const match = STEP_LINE.exec(line);
    if (match) steps.push(match[1]!);
    if (steps.length >= MAX_PLAN_STEPS) break;
  }
  return steps;
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

/** Done/current/pending per plan step, matched from the latest worker instruction. */
export function planChecklist(plan: string, runs: AgentRun[]): PlanStep[] {
  const steps = planSteps(plan);
  const current = currentStepIndex(steps, latestWorkerRun(runs)?.instruction);
  return steps.map((text, index) => ({ text, status: stepStatus(index, current) }));
}

/** Up to `count` consecutive step indexes centered on the current step, hard-capped at `max`. */
export function checklistWindow(steps: readonly PlanStep[], count: number, max = CHECKLIST_ROWS): number[] {
  const size = Math.min(count, max);
  if (steps.length <= size) return steps.map((_step, index) => index);
  const found = steps.findIndex((step) => step.status === "current");
  const current = found < 0 ? 0 : found;
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
  return `dev-house ${task.id} · ${task.state}${paused}   ⏱ ${elapsed} · ${mode}`;
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

const SPIN_FRAMES: readonly string[] = ["◐", "◓", "◑", "◒"];

/** One-line replacement for pi's suppressed streaming indicator. */
export function workingLine(runs: AgentRun[], tick: number, theme?: PanelTheme, now = Date.now()): string {
  const running = runs.filter((run) => run.status === "running");
  const spin = SPIN_FRAMES[Math.abs(tick) % SPIN_FRAMES.length]!;
  if (running.length > 0) {
    const run = running.at(-1)!;
    const spinner = theme ? theme.fg("accent", spin) : spin;
    return `  ${spinner} agents working (${running.length}) · ${run.domain}/${run.role} running ${formatDuration(runElapsed(run, now))}`;
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

/*
 * Frame clock. Every sprite reads `frameIndex` with its own phase, so the four
 * agents and the oracle never animate in lockstep while a fixed tick still
 * renders byte-identical output.
 */

/** Deterministic frame index: `tick + phase` wrapped into `[0, count)`. */
export function frameIndex(tick: number, phase: number, count: number): number {
  if (!(count > 0)) return 0;
  return (((Math.floor(tick) + phase) % count) + count) % count;
}

function slotPhase(index: number): number {
  return index * 2;
}

const ORACLE_PHASE = SLOT_IDS.length * 2 + 1;

/* -------------------------------------------------------------------------
 * Compact tier (< LARGE_MIN_WIDTH): banner, header, the one-row-per-agent strip
 * and the checklist. Geometry matches the long-standing 40-column strip.
 * ---------------------------------------------------------------------- */

const COMPACT_GAP = 2;
const COMPACT_INNER = SLOT_IDS.length * COMPACT_WIDTH + (SLOT_IDS.length - 1) * COMPACT_GAP;
const COMPACT_STATUS_GAP = " ".repeat(COMPACT_WIDTH + COMPACT_GAP - 1);

function compactFrame(slot: SlotView, index: number, tick: number): string {
  const frames = COMPACT_FRAMES[slot.id][slot.status];
  return frames[frameIndex(tick, slotPhase(index), frames.length)] ?? "";
}

function compactRow(content: string, color: PanelColor, theme?: PanelTheme): string {
  const body = truncateToWidth(content, COMPACT_INNER, "", true);
  return `|${theme ? theme.fg(color, body) : body}|`;
}

/** Caption, animated sprites, then the coloured status glyph per slot. */
function compactStrip(state: TaskState, slots: readonly SlotView[], tick: number, theme?: PanelTheme): string[] {
  const sprites = slots.map((slot, index) => paintStatus(slot.status, compactFrame(slot, index, tick), theme)).join(" ".repeat(COMPACT_GAP));
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
  const fixed = [...bannerLines(width), headerLine(task, now, quiet), ...compactStrip(task.state, metrics.slots, tick, opts.theme)];
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

function sceneSlots(metrics: SceneMetrics, tick: number): LargeSlot[] {
  return metrics.slots.map((slot, index) => ({
    ...slot,
    frame: frameIndex(tick, slotPhase(index), SLOT_FRAMES[slot.id][slot.status].length),
  }));
}

function oracleSlot(task: Task, tick: number): LargeSceneInput["oracle"] {
  const pose = oraclePose(task);
  return { pose, frame: frameIndex(tick, ORACLE_PHASE, ORACLE_FRAMES[pose].length) };
}

function sceneTasks(steps: readonly PlanStep[]): LargeTaskRow[] {
  return checklistWindow(steps, MAX_TASK_ROWS, MAX_TASK_ROWS).map((index) => ({
    text: steps[index]!.text,
    status: steps[index]!.status,
  }));
}

function sceneInput(task: Task, runs: AgentRun[], now: number, quiet: boolean, tick: number, steps: PlanStep[]): LargeSceneInput {
  const metrics = sceneMetrics(task, runs, now);
  const alert = taskAlert(task);
  return {
    taskId: task.id,
    taskTitle: task.title,
    state: task.paused ? `${task.state} (paused)` : task.state,
    elapsedLabel: metrics.elapsedLabel,
    etaLabel: metrics.etaLabel,
    quietHint: quiet ? "tools hidden (alt+t)" : "tools shown",
    done: metrics.done,
    total: metrics.total,
    slots: sceneSlots(metrics, tick),
    tasks: sceneTasks(steps),
    log: metrics.log,
    oracle: oracleSlot(task, tick),
    alert: alert?.text,
    alertKind: alert?.kind,
  };
}

export interface PanelOptions {
  width?: number;
  /** Terminal rows; drives the large tier's line budget. */
  rows?: number;
  tick?: number;
  theme?: PanelTheme;
}

/**
 * Zen panel lines. At `width >= LARGE_MIN_WIDTH` with enough terminal height the
 * large animated scene owns the panel; otherwise the compact strip keeps the
 * banner, header, agent row, alert, working line and checklist. No line ever
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
    const scene = largeLines(sceneInput(task, runs, now, quiet, tick, steps), width, budget, opts.theme);
    return scene.map((line) => truncateToWidth(line, width));
  }
  return compactPanel(task, runs, now, quiet, tick, steps, opts, width);
}
