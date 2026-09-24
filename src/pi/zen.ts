import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentRun } from "../schemas/findings.ts";
import { TERMINAL_STATES, type Task, type TaskState } from "../schemas/task.ts";
import { truncate } from "../text.ts";
import {
  ACTIVE_LABEL_MARKS,
  BANNER_NARROW,
  BANNER_TITLE,
  BLOB_ART,
  BLOB_LABELS,
  COMPACT_BLOB_ART,
  DIORAMA,
  SCENE_PROPS,
  STATUS_GLYPHS,
  type DioramaSpec,
  type MascotId,
} from "./mascot-art.ts";

export type { MascotId };

/** Blob status vocabulary, derived from the art module so the glyphs stay in sync. */
export type BlobStatus = keyof typeof STATUS_GLYPHS;

/** Minimal slice of pi's Theme the panel needs; keeps zen.ts decoupled from the agent. */
export interface PanelTheme {
  fg(color: "accent" | "muted" | "dim" | "success" | "error" | "warning", text: string): string;
  bold(text: string): string;
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

/** Upper bound on parsed plan steps / panel rows so the widget stays bounded. */
export const MAX_PLAN_STEPS = 50;
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

function latestWorkerInstruction(runs: AgentRun[]): string | undefined {
  let latest: AgentRun | undefined;
  for (const run of runs) {
    if (run.role !== "worker" || !run.instruction) continue;
    if (!latest || Date.parse(run.startedAt) >= Date.parse(latest.startedAt)) latest = run;
  }
  return latest?.instruction;
}

function stepStatus(index: number, current: number): PlanStepStatus {
  if (current < 0) return index === 0 ? "current" : "pending";
  if (index < current) return "done";
  return index === current ? "current" : "pending";
}

/** Done/current/pending per plan step, matched from the latest worker instruction. */
export function planChecklist(plan: string, runs: AgentRun[]): PlanStep[] {
  const steps = planSteps(plan);
  const instruction = latestWorkerInstruction(runs);
  const current = instruction ? steps.findIndex((step) => matchesInstruction(step, instruction)) : -1;
  return steps.map((text, index) => ({ text, status: stepStatus(index, current) }));
}

/** Up to `count` consecutive step indexes centered on the current step. */
function checklistWindow(steps: PlanStep[], count: number): number[] {
  const size = Math.min(count, CHECKLIST_ROWS);
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

function alertLine(task: Task): string | undefined {
  const pending = task.approvals.filter((approval) => approval.status === "pending");
  if (pending.length > 0) return `approvals pending: ${pending.map((approval) => approval.id).join(", ")}`;
  if (task.blockers.length > 0) return `blocked: ${truncate(task.blockers[0]!.reason, 60)}`;
  return undefined;
}

/** The four mascots, always present, in the order the art places them. */
export const MASCOT_IDS: readonly MascotId[] = Object.keys(BLOB_ART) as MascotId[];

const ART_ROWS = BLOB_ART.master.rest.length;
const FULL_MIN_WIDTH = 60;
const BANNER_WIDTH = 58;
const SPIN_FRAMES: readonly string[] = ["◐", "◓", "◑", "◒"];

const STATUS_COLORS: Record<BlobStatus, "dim" | "accent" | "success" | "error"> = {
  idle: "dim",
  running: "accent",
  done: "success",
  failed: "error",
};

export const BLINK_MIN_MS = 30_000;
export const BLINK_MAX_MS = 70_000;
export const BLINK_MS = 600;

/** One blob's next scheduled blink plus the end of its current blink window. */
export interface BlinkState {
  nextAt: number;
  until: number;
}

/** Uniform blink delay in [BLINK_MIN_MS, BLINK_MAX_MS] from an injected rng. */
export function nextBlinkDelay(rng: () => number): number {
  const span = BLINK_MAX_MS - BLINK_MIN_MS + 1;
  return BLINK_MIN_MS + Math.min(span - 1, Math.floor(rng() * span));
}

/** Start a short blink window once its scheduled time has passed; otherwise unchanged. */
export function advanceBlink(state: BlinkState, now: number, rng: () => number): BlinkState {
  if (now < state.nextAt) return state;
  return { nextAt: now + nextBlinkDelay(rng), until: now + BLINK_MS };
}

export function isBlinking(state: BlinkState, now: number): boolean {
  return now < state.until;
}

const RUN_STATUS: Record<AgentRun["status"], BlobStatus> = {
  running: "running",
  success: "done",
  failed: "failed",
  cancelled: "failed",
  timeout: "failed",
};

export function runStatus(status: AgentRun["status"]): BlobStatus {
  return RUN_STATUS[status];
}

function latestRun(runs: AgentRun[], mascot: MascotId): AgentRun | undefined {
  let latest: AgentRun | undefined;
  for (const run of runs) {
    if (run.domain !== mascot) continue;
    if (!latest || Date.parse(run.startedAt) >= Date.parse(latest.startedAt)) latest = run;
  }
  return latest;
}

/** Per-mascot status: latest run per domain, master derived from the task itself. */
export function blobStatuses(task: Task, runs: AgentRun[]): Record<MascotId, BlobStatus> {
  const statuses = {} as Record<MascotId, BlobStatus>;
  for (const mascot of MASCOT_IDS) statuses[mascot] = "idle";
  for (const mascot of MASCOT_IDS) {
    const run = latestRun(runs, mascot);
    if (run) statuses[mascot] = runStatus(run.status);
  }
  statuses.master = task.paused || TERMINAL_STATES.includes(task.state) ? "idle" : "running";
  return statuses;
}

/** The mascot the scene emphasizes: a busy domain first, otherwise the master. */
function workingBlob(statuses: Record<MascotId, BlobStatus>): MascotId | undefined {
  const busy = MASCOT_IDS.filter((mascot) => mascot !== "master" && statuses[mascot] === "running");
  if (busy.length > 0) return busy.at(-1);
  return statuses.master === "running" ? "master" : undefined;
}

function glyphPaint(status: BlobStatus, theme?: PanelTheme): ((text: string) => string) | undefined {
  return theme ? (text) => theme.fg(STATUS_COLORS[status], text) : undefined;
}

function blobPaint(
  mascot: MascotId,
  statuses: Record<MascotId, BlobStatus>,
  theme?: PanelTheme,
): ((text: string) => string) | undefined {
  if (!theme) return undefined;
  return workingBlob(statuses) === mascot
    ? (text) => theme.bold(theme.fg("accent", text))
    : (text) => theme.fg("muted", text);
}

interface Cell {
  offset: number;
  text: string;
  paint?: (text: string) => string;
}

/** Join cells left to right at absolute offsets, colorizing each span separately. */
function assemble(width: number, cells: readonly Cell[]): string {
  let row = "";
  let cursor = 0;
  for (const cell of cells) {
    row += " ".repeat(cell.offset - cursor) + (cell.paint ? cell.paint(cell.text) : cell.text);
    cursor = cell.offset + visibleWidth(cell.text);
  }
  return row + " ".repeat(Math.max(0, width - cursor));
}

/** Replace a token with fixed-width content, consuming the spare template columns. */
function writeToken(template: string, token: string, content: string, width: number): string {
  const at = template.indexOf(token);
  if (at < 0) return template;
  const drop = Math.max(0, width - token.length);
  return template.slice(0, at) + content + template.slice(at + token.length + drop);
}

function padTo(text: string, width: number): string {
  return truncateToWidth(text, width, "", true);
}

/** Blob cell offsets within the region plus the region's total visible width. */
function spans(spec: DioramaSpec, cellWidth: number): { offsets: number[]; width: number } {
  const first = spec.blobColumns[0]!;
  const last = spec.blobColumns.at(-1)!;
  return { offsets: spec.blobColumns.map((column) => column - first), width: last + cellWidth - first };
}

function artCells(
  art: Record<MascotId, { rest: readonly string[]; blink: readonly string[] }>,
  statuses: Record<MascotId, BlobStatus>,
  blinks: Partial<Record<MascotId, boolean>>,
  offsets: readonly number[],
  cellWidth: number,
  rowIndex: number,
  theme?: PanelTheme,
): Cell[] {
  return MASCOT_IDS.map((mascot, index) => {
    const sprite = blinks[mascot] ? art[mascot].blink : art[mascot].rest;
    return { offset: offsets[index]!, text: padTo(sprite[rowIndex] ?? "", cellWidth), paint: blobPaint(mascot, statuses, theme) };
  });
}

function statusCells(statuses: Record<MascotId, BlobStatus>, offsets: readonly number[], theme?: PanelTheme): Cell[] {
  return MASCOT_IDS.map((mascot, index) => {
    const status = statuses[mascot];
    return { offset: offsets[index]!, text: STATUS_GLYPHS[status], paint: glyphPaint(status, theme) };
  });
}

function labelCells(statuses: Record<MascotId, BlobStatus>, offsets: readonly number[], theme?: PanelTheme): Cell[] {
  const active = workingBlob(statuses);
  return MASCOT_IDS.map((mascot, index) => {
    const marked = mascot === active;
    const label = BLOB_LABELS[mascot];
    return {
      offset: offsets[index]!,
      text: marked ? `${ACTIVE_LABEL_MARKS[0]}${label}${ACTIVE_LABEL_MARKS[1]}` : label,
      paint: theme ? (text) => (marked ? theme.bold(theme.fg("accent", text)) : theme.fg("dim", text)) : undefined,
    };
  });
}

/** Write the prop (or compact caption) rows at their fixed cell width. */
function fillProp(rows: string[], spec: DioramaSpec, prop: readonly string[], cellWidth: number): void {
  spec.propRows.forEach((row, index) => {
    rows[row] = writeToken(rows[row]!, "{prop}", padTo(prop[index] ?? "", cellWidth), cellWidth);
  });
}

function fullDiorama(
  state: TaskState,
  statuses: Record<MascotId, BlobStatus>,
  blinks: Partial<Record<MascotId, boolean>>,
  theme?: PanelTheme,
): string[] {
  const spec = DIORAMA.full;
  const blobWidth = visibleWidth(BLOB_ART.master.rest[0]!);
  const { offsets, width } = spans(spec, blobWidth);
  const prop = SCENE_PROPS[state].prop;
  const rows = [...spec.rows];
  fillProp(rows, spec, prop, visibleWidth(prop[0]!));
  for (let index = 0; index < ART_ROWS; index += 1) {
    const row = spec.blobRow + index;
    const cells = artCells(BLOB_ART, statuses, blinks, offsets, blobWidth, index, theme);
    rows[row] = writeToken(rows[row]!, "{blobs}", assemble(width, cells), width);
  }
  rows[spec.statusRow] = writeToken(rows[spec.statusRow]!, "{status}", assemble(width, statusCells(statuses, offsets, theme)), width);
  rows[spec.labelRow] = writeToken(rows[spec.labelRow]!, "{labels}", assemble(width, labelCells(statuses, offsets, theme)), width);
  return rows;
}

function compactDiorama(
  state: TaskState,
  statuses: Record<MascotId, BlobStatus>,
  blinks: Partial<Record<MascotId, boolean>>,
  theme?: PanelTheme,
): string[] {
  const spec = DIORAMA.compact;
  const blobWidth = visibleWidth(COMPACT_BLOB_ART.master.rest[0]!);
  const { offsets, width } = spans(spec, blobWidth);
  const rows = [...spec.rows];
  fillProp(rows, spec, [SCENE_PROPS[state].caption], width);
  rows[spec.blobRow] = writeToken(rows[spec.blobRow]!, "{blobs}", assemble(width, artCells(COMPACT_BLOB_ART, statuses, blinks, offsets, blobWidth, 0, theme)), width);
  rows[spec.statusRow] = writeToken(rows[spec.statusRow]!, "{status}", assemble(width, statusCells(statuses, offsets, theme)), width);
  return rows;
}

/** Full diorama at width >= 60, compact strip below that. */
export function dioramaLines(
  state: TaskState,
  statuses: Record<MascotId, BlobStatus>,
  blinks: Partial<Record<MascotId, boolean>>,
  width: number,
  theme?: PanelTheme,
): string[] {
  return width >= FULL_MIN_WIDTH
    ? fullDiorama(state, statuses, blinks, theme)
    : compactDiorama(state, statuses, blinks, theme);
}

/** Boxed title for wide terminals, one-line title otherwise; never wider than `width`. */
export function bannerLines(width: number): string[] {
  if (width < 1) return [];
  if (width < FULL_MIN_WIDTH) return [truncateToWidth(BANNER_NARROW, width, "")];
  const inner = BANNER_WIDTH - 2;
  const titleWidth = visibleWidth(BANNER_TITLE);
  const left = Math.floor((inner - titleWidth) / 2);
  const border = "─".repeat(inner);
  return [`┌${border}┐`, `│${" ".repeat(left)}${BANNER_TITLE}${" ".repeat(inner - titleWidth - left)}│`, `└${border}┘`];
}

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
  const status = theme ? theme.fg(STATUS_COLORS[runStatus(last.status)], last.status) : last.status;
  return `  · no agents running · last ${last.domain}/${last.role} ${status} ${formatDuration(runElapsed(last, now))}`;
}

/** Alert, working line, and the `steps x/y` summary, in priority order. */
function tailLines(task: Task, runs: AgentRun[], now: number, tick: number, steps: PlanStep[], opts: PanelOptions): string[] {
  const alert = alertLine(task);
  const rows = alert ? [alert] : [];
  rows.push(workingLine(runs, tick, opts.theme, now));
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

export interface PanelOptions {
  width?: number;
  blinks?: Partial<Record<MascotId, boolean>>;
  tick?: number;
  theme?: PanelTheme;
}

/**
 * Zen panel lines: banner, header, diorama, then the optional alert, working
 * line, step summary and as many checklist rows as the budget allows. The
 * banner and diorama are never clamped away.
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
  const scene = dioramaLines(task.state, blobStatuses(task, runs), opts.blinks ?? {}, width, opts.theme);
  const fixed = [...bannerLines(width), headerLine(task, now, quiet), ...scene];
  const steps = planChecklist(task.plan ?? "", runs);
  const tail = tailLines(task, runs, now, opts.tick ?? 0, steps, opts);
  const room = Math.max(0, MAX_PANEL_LINES - fixed.length - tail.length);
  const lines = [...fixed, ...tail, ...checklistLines(steps, room)];
  return lines.map((line) => truncateToWidth(line, width));
}
