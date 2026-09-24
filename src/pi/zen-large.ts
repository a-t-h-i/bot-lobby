import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  BAR,
  ORACLE_COLORS,
  ORACLE_FRAMES,
  ORACLE_WORDS,
  SLOT_FRAMES,
  SLOT_LABELS,
  SLOT_STATE_COLORS,
  SLOT_STATE_GLYPHS,
  SLOT_STATE_WORDS,
  TOWER,
  TOWER_DOOR,
  type OracleFrame,
  type OraclePose,
  type PanelColor,
  type SlotId,
  type SlotState,
} from "./mascot-art.ts";
import type { PanelTheme } from "./zen.ts";

/**
 * The large animated zen scene: a header box, the pulsing oracle tower with its
 * tree connector, the four animated agent columns, and the TASKS checklist
 * beside a colour-coded LOG of real run transitions.
 *
 * Pure layout: every colour comes from the optional `PanelTheme`, every frame
 * index comes from the caller, and nothing here reads the clock or a random
 * source. Below `LARGE_MIN_WIDTH` the caller renders the compact strip instead
 * of calling this module.
 */

/** The large scene only renders at or above this width. */
export const LARGE_MIN_WIDTH = 72;

/** Fixed scene width; the box, tower and agent strip are all centered on it. */
export const SCENE_WIDTH = 63;

export const MAX_TASK_ROWS = 6;
export const MAX_LOG_ROWS = 6;
export const MAX_LARGE_LINES = 34;

/** One agent column of the scene, with the caller-selected animation frame. */
export interface LargeSlot {
  id: SlotId;
  label: string;
  status: SlotState;
  percent: number;
  frame: number;
}

export interface LargeTaskRow {
  text: string;
  status: "done" | "current" | "pending";
}

export interface LargeLogRow {
  time: string;
  label: string;
  status: SlotState | "oracle";
}

/** Everything the large scene draws; assembled by the caller from task and runs. */
export interface LargeSceneInput {
  taskId: string;
  taskTitle: string;
  state: string;
  elapsedLabel: string;
  etaLabel: string;
  quietHint: string;
  done: number;
  total: number;
  slots: readonly LargeSlot[];
  tasks: readonly LargeTaskRow[];
  log: readonly LargeLogRow[];
  oracle: { pose: OraclePose; frame: number };
  /** Approval/blocked line; never dropped when present. */
  alert?: string;
  /** Severity of the alert line: approvals are `warning`, blocked is `error`. */
  alertKind?: "warning" | "error";
  /** Name over the tower door, `TOWER_DOOR` when omitted. */
  doorLabel?: string;
}

const SLOT_CELL = 15;
const SLOT_GAP = 1;
const SLOT_ROWS = 4;
const BRANCH_ROWS = 3;
const SECTION_MIN = 2;
const MAX_SLOTS = 4;
const TASKS_CELL = 31;
const LOG_WIDTH = 30;
const LOG_LABEL_WIDTH = 8;
const CONTENT = SCENE_WIDTH - 4;
const BAR_BLOCK = BAR.cells + 4;

const TASK_COLORS: Record<LargeTaskRow["status"], PanelColor> = {
  done: "success",
  current: "accent",
  pending: "dim",
};

const TOWER_ROWS: Record<TowerSize, number> = {
  full: TOWER.rows.length,
  small: TOWER.smallRows.length,
  none: 0,
};

const TOWER_PATTERN = new RegExp(
  `(${Object.values(TOWER.tokens).map((token) => token.replace(/([{}])/g, "\\$1")).join("|")})`,
);

type TowerSize = "full" | "small" | "none";

interface Cell {
  offset: number;
  text: string;
  paint?: (text: string) => string;
}

interface LayoutPlan {
  tower: TowerSize;
  branch: boolean;
  strip: boolean;
  section: boolean;
  /** Entry rows the plan guarantees when a section is present. */
  minEntries: number;
}

/**
 * Rich to sparse. The section outranks the tower: the tower only grows once the
 * section can keep all `MAX_TASK_ROWS` entry rows, so a taller terminal never
 * removes or shrinks TASKS/LOG.
 */
const PLANS: readonly LayoutPlan[] = [
  { tower: "full", branch: true, strip: true, section: true, minEntries: MAX_TASK_ROWS },
  { tower: "small", branch: true, strip: true, section: true, minEntries: MAX_TASK_ROWS },
  { tower: "small", branch: true, strip: true, section: true, minEntries: SECTION_MIN },
  { tower: "small", branch: true, strip: true, section: false, minEntries: 0 },
  { tower: "small", branch: false, strip: true, section: false, minEntries: 0 },
  { tower: "none", branch: false, strip: true, section: false, minEntries: 0 },
];

const EMPTY_PLAN: LayoutPlan = { tower: "none", branch: false, strip: false, section: false, minEntries: 0 };

/**
 * Scene lines for the large tier, or nothing below `LARGE_MIN_WIDTH`.
 *
 * `budget` is a caller-computed LINE budget (zen.ts derives it from the
 * terminal height), not a terminal row count. The header box and the alert are
 * the fixed frame and are always drawn, so a budget below the fixed frame still
 * returns a bounded, width-safe scene instead of dropping the alert.
 */
export function largeLines(
  input: LargeSceneInput,
  width: number,
  budget: number,
  theme?: PanelTheme,
): string[] {
  if (width < LARGE_MIN_WIDTH) return [];
  const head = boxLines(input, width, theme);
  const alert = input.alert ? [alertLine(input.alert, width, theme, input.alertKind ?? "warning")] : [];
  const avail = Math.max(0, lineBudget(budget) - head.length - alert.length);
  return [...head, ...alert, ...bodyLines(input, width, theme, avail)];
}

/** Clamp a caller line budget to the scene cap, ignoring non-finite input. */
function lineBudget(budget: number): number {
  return clamp(Number.isFinite(budget) ? Math.floor(budget) : 0, 0, MAX_LARGE_LINES);
}

function paint(text: string, color: PanelColor, theme?: PanelTheme, bold = false): string {
  if (!theme || text.length === 0) return text;
  const painted = theme.fg(color, text);
  return bold ? theme.bold(painted) : painted;
}

function statusPaint(status: SlotState, theme?: PanelTheme): ((text: string) => string) | undefined {
  if (!theme) return undefined;
  const style = SLOT_STATE_COLORS[status];
  return (text) => paint(text, style.color, theme, style.bold);
}

function labelPaint(status: SlotState, theme?: PanelTheme): ((text: string) => string) | undefined {
  if (!theme) return undefined;
  return status === "working"
    ? (text) => theme.bold(theme.fg("accent", text))
    : (text) => theme.fg("dim", text);
}

function padTo(text: string, width: number): string {
  return truncateToWidth(text, width, "", true);
}

function centre(text: string, width: number): string {
  return padTo(" ".repeat(Math.max(0, Math.floor((width - visibleWidth(text)) / 2))) + text, width);
}

function mod(index: number, length: number): number {
  return length <= 0 ? 0 : ((index % length) + length) % length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function progress(done: number, total: number): number {
  if (!(total > 0) || !(done > 0)) return 0;
  return clamp(Math.round((done / total) * 100), 0, 100);
}

function sceneLeft(width: number): number {
  return Math.max(0, Math.floor((width - SCENE_WIDTH) / 2));
}

function sceneCentre(width: number): number {
  return Math.floor((width - 1) / 2);
}

/** Place a row of at most `SCENE_WIDTH` columns on the scene's centre column. */
function place(row: string, width: number): string {
  return " ".repeat(Math.max(0, sceneLeft(width) + Math.floor((SCENE_WIDTH - visibleWidth(row)) / 2))) + row;
}

function alertLine(
  alert: string,
  width: number,
  theme?: PanelTheme,
  kind: "warning" | "error" = "warning",
): string {
  const left = sceneLeft(width);
  const line = paint(truncateToWidth(`! ${alert}`, width - left, "…"), kind, theme, true);
  return " ".repeat(left) + line;
}

function boxLines(input: LargeSceneInput, width: number, theme?: PanelTheme): string[] {
  const rows = [topBorder(input, theme), titleRow(input, theme), barRow(input, theme), bottomBorder(input, theme)];
  return rows.map((row) => place(row, width));
}

function topBorder(input: LargeSceneInput, theme?: PanelTheme): string {
  const lead = "┌─ DEV-HOUSE ── ";
  const label = truncateToWidth(`${input.taskId} · ${input.state} `, SCENE_WIDTH - 18, "…");
  const tail = "─".repeat(Math.max(0, SCENE_WIDTH - 1 - visibleWidth(lead) - visibleWidth(label)));
  return paint(lead, "muted", theme) + paint(label, "accent", theme, true) + paint(`${tail}┐`, "muted", theme);
}

function bottomBorder(input: LargeSceneInput, theme?: PanelTheme): string {
  const label = truncateToWidth(` ⏱ ${input.elapsedLabel} · ${input.quietHint} `, SCENE_WIDTH - 8, "…");
  const tail = "─".repeat(Math.max(0, SCENE_WIDTH - 3 - visibleWidth(label)));
  return paint("└─", "muted", theme) + paint(label, "dim", theme) + paint(`${tail}┘`, "muted", theme);
}

function titleRow(input: LargeSceneInput, theme?: PanelTheme): string {
  const eta = input.etaLabel;
  const room = Math.max(0, CONTENT - visibleWidth(eta) - 2);
  const title = padTo(input.taskTitle, room);
  return boxRow(title + paint(padTo(`  ${eta}`, CONTENT - room), "dim", theme), theme);
}

function barRow(input: LargeSceneInput, theme?: PanelTheme): string {
  const percent = progress(input.done, input.total);
  const filled = Math.round((percent / 100) * BAR.cells);
  const counts = ` ${String(percent).padStart(3)}%  (${input.done}/${input.total} tasks)`;
  const row =
    paint(BAR.filled.repeat(filled), "accent", theme, true) +
    paint(BAR.empty.repeat(BAR.cells - filled), "dim", theme) +
    paint(padTo(counts, CONTENT - BAR.cells), "dim", theme);
  return boxRow(row, theme);
}

function boxRow(content: string, theme?: PanelTheme): string {
  return paint("│", "muted", theme) + " " + content + " " + paint("│", "muted", theme);
}

function bodyLines(
  input: LargeSceneInput,
  width: number,
  theme: PanelTheme | undefined,
  avail: number,
): string[] {
  const sections = input.tasks.length > 0 || input.log.length > 0;
  const plan = pickPlan(avail, sections);
  const entries = plan.section ? clamp(avail - blockRows(plan) - 1, 0, MAX_TASK_ROWS) : 0;
  return [
    ...towerLines(input, width, theme, plan.tower),
    ...(plan.branch ? branchLines(input, width, theme) : []),
    ...(plan.strip ? slotLines(input, width, theme) : []),
    ...sectionLines(input, width, theme, entries),
  ];
}

function blockRows(plan: LayoutPlan): number {
  const tower = TOWER_ROWS[plan.tower];
  return tower + (plan.branch ? BRANCH_ROWS : 0) + (plan.strip ? SLOT_ROWS : 0);
}

function pickPlan(avail: number, sections: boolean): LayoutPlan {
  const needed = (plan: LayoutPlan) => blockRows(plan) + (plan.section && sections ? 1 + plan.minEntries : 0);
  return PLANS.find((plan) => needed(plan) <= avail) ?? EMPTY_PLAN;
}

function oracleFrame(input: LargeSceneInput): OracleFrame {
  const frames = ORACLE_FRAMES[input.oracle.pose];
  return frames[mod(input.oracle.frame, frames.length)]!;
}

function towerRow(row: string, input: LargeSceneInput, theme?: PanelTheme): string {
  const frame = oracleFrame(input);
  const values = new Map<string, string>([
    [TOWER.tokens.orb, frame.orb],
    [TOWER.tokens.winL, frame.winL],
    [TOWER.tokens.winR, frame.winR],
    [TOWER.tokens.door, input.doorLabel ?? TOWER_DOOR],
  ]);
  const accent = ORACLE_COLORS[input.oracle.pose];
  const parts = row.split(TOWER_PATTERN);
  return parts
    .map((part) => {
      const value = values.get(part);
      return value === undefined ? paint(part, "muted", theme) : paint(value, accent.color, theme, accent.bold);
    })
    .join("");
}

function towerLines(input: LargeSceneInput, width: number, theme: PanelTheme | undefined, size: TowerSize): string[] {
  if (size === "none") return [];
  const rows = size === "small" ? TOWER.smallRows : TOWER.rows;
  return rows.map((row) => place(towerRow(row, input, theme), width));
}

function stripWidth(count: number): number {
  return count * SLOT_CELL + Math.max(0, count - 1) * SLOT_GAP;
}

function stripLeft(count: number, width: number): number {
  return Math.max(0, Math.floor((width - stripWidth(count)) / 2));
}

function slotOffsets(count: number, width: number): number[] {
  const left = stripLeft(count, width);
  return Array.from({ length: count }, (_value, index) => left + index * (SLOT_CELL + SLOT_GAP));
}

function branchLines(input: LargeSceneInput, width: number, theme?: PanelTheme): string[] {
  const count = Math.min(input.slots.length, MAX_SLOTS);
  if (count === 0) return [];
  const nodes = slotOffsets(count, width).map((offset) => offset + Math.floor(SLOT_CELL / 2));
  const stem = sceneCentre(width);
  const end = nodes[nodes.length - 1]! + 1;
  const rows = [stemLine(stem, end), treeLine(nodes, stem, end), pipeLine(nodes, end)];
  return rows.map((row) => paint(row, "muted", theme));
}

/** Absolute-coordinate row: an explicit mark wins, otherwise `fill` draws the cell. */
function absRow(length: number, fill: (index: number) => string, marks: ReadonlyMap<number, string>): string {
  return Array.from({ length }, (_value, index) => marks.get(index) ?? fill(index)).join("");
}

/** The tower stem, dropping from `sceneCentre(width)` onto the tree row. */
function stemLine(stem: number, end: number): string {
  return absRow(Math.max(end, stem + 1), () => " ", new Map([[stem, "│"]]));
}

function treeLine(nodes: readonly number[], stem: number, end: number): string {
  const marks = new Map<number, string>();
  nodes.forEach((node, index) => marks.set(node, index === 0 ? "┌" : index === nodes.length - 1 ? "┐" : "┬"));
  if (!marks.has(stem) && stem > nodes[0]! && stem < nodes[nodes.length - 1]!) marks.set(stem, "┴");
  return absRow(end, (index) => (index >= nodes[0]! ? "─" : " "), marks);
}

function pipeLine(nodes: readonly number[], end: number): string {
  return absRow(end, () => " ", new Map(nodes.map((node) => [node, "│"] as const)));
}

function slotLines(input: LargeSceneInput, width: number, theme?: PanelTheme): string[] {
  const slots = input.slots.slice(0, MAX_SLOTS);
  if (slots.length === 0) return [];
  const offsets = slotOffsets(slots.length, width);
  const end = stripLeft(slots.length, width) + stripWidth(slots.length);
  return [
    assemble(end, faceCells(slots, offsets, theme)),
    assemble(end, labelCells(slots, offsets, theme)),
    assemble(end, wordCells(slots, offsets, theme)),
    assemble(end, barCells(slots, offsets, theme)),
  ];
}

function slotFrame(slot: LargeSlot): readonly string[] {
  const frames = SLOT_FRAMES[slot.id][slot.status];
  return frames[mod(slot.frame, frames.length)] ?? [];
}

function faceCells(slots: readonly LargeSlot[], offsets: readonly number[], theme?: PanelTheme): Cell[] {
  return slots.map((slot, index) => ({
    offset: offsets[index]!,
    text: centre(slotFrame(slot)[0] ?? "", SLOT_CELL),
    paint: statusPaint(slot.status, theme),
  }));
}

function labelCells(slots: readonly LargeSlot[], offsets: readonly number[], theme?: PanelTheme): Cell[] {
  return slots.map((slot, index) => ({
    offset: offsets[index]!,
    text: centre(slot.label || SLOT_LABELS[slot.id], SLOT_CELL),
    paint: labelPaint(slot.status, theme),
  }));
}

function wordCells(slots: readonly LargeSlot[], offsets: readonly number[], theme?: PanelTheme): Cell[] {
  return slots.map((slot, index) => ({
    offset: offsets[index]!,
    text: centre(`${SLOT_STATE_GLYPHS[slot.status]} ${SLOT_STATE_WORDS[slot.status]}`, SLOT_CELL),
    paint: statusPaint(slot.status, theme),
  }));
}

function barCells(slots: readonly LargeSlot[], offsets: readonly number[], theme?: PanelTheme): Cell[] {
  return slots.flatMap((slot, index) => barSpans(slot, offsets[index]!, theme));
}

function barSpans(slot: LargeSlot, offset: number, theme?: PanelTheme): Cell[] {
  const percent = clamp(Math.round(slot.percent), 0, 100);
  const filled = Math.round((percent / 100) * BAR.cells);
  const lead = offset + Math.floor((SLOT_CELL - BAR_BLOCK) / 2);
  return [
    { offset: lead, text: BAR.filled.repeat(filled), paint: statusPaint(slot.status, theme) },
    { offset: lead + filled, text: BAR.empty.repeat(BAR.cells - filled), paint: (text) => paint(text, "dim", theme) },
    { offset: lead + BAR.cells, text: `${percent}%`.padStart(4), paint: statusPaint(slot.status, theme) },
  ];
}

function assemble(end: number, cells: readonly Cell[]): string {
  let row = "";
  let cursor = 0;
  for (const cell of cells) {
    row += " ".repeat(Math.max(0, cell.offset - cursor)) + (cell.paint ? cell.paint(cell.text) : cell.text);
    cursor = cell.offset + visibleWidth(cell.text);
  }
  return row + " ".repeat(Math.max(0, end - cursor));
}

/** TASKS beside the LOG whenever both have rows and the entry budget allows it. */
function sectionLines(
  input: LargeSceneInput,
  width: number,
  theme: PanelTheme | undefined,
  entries: number,
): string[] {
  if (entries < 1) return [];
  const tasks = input.tasks.slice(0, MAX_TASK_ROWS);
  const logs = input.log.slice(0, MAX_LOG_ROWS);
  if (tasks.length > 0 && logs.length > 0 && entries >= SECTION_MIN) {
    return pairSection(input, tasks, logs, entries, width, theme);
  }
  if (tasks.length > 0) {
    return soloSection(" TASKS", tasks.map((task) => taskCell(task, SCENE_WIDTH, theme)), entries, width, theme);
  }
  if (logs.length > 0) {
    const cells = logs.map((log) => logCell(log, input.oracle.pose, SCENE_WIDTH, theme));
    return soloSection(" LOG", cells, entries, width, theme);
  }
  return [];
}

function pairSection(
  input: LargeSceneInput,
  tasks: readonly LargeTaskRow[],
  logs: readonly LargeLogRow[],
  entries: number,
  width: number,
  theme?: PanelTheme,
): string[] {
  const left = sceneLeft(width);
  const rows = Math.min(entries, Math.max(tasks.length, logs.length));
  const lines = [paint(padTo(" TASKS", TASKS_CELL + 2) + "LOG", "muted", theme, true)];
  for (let index = 0; index < rows; index += 1) {
    const cell = logCell(logs[index], input.oracle.pose, LOG_WIDTH, theme);
    lines.push(taskCell(tasks[index], TASKS_CELL, theme) + "  " + cell);
  }
  return lines.map((line) => " ".repeat(left) + line);
}

function soloSection(
  header: string,
  cells: readonly string[],
  entries: number,
  width: number,
  theme?: PanelTheme,
): string[] {
  const left = sceneLeft(width);
  const rows = [paint(header, "muted", theme, true), ...cells.slice(0, entries)];
  return rows.map((row) => " ".repeat(left) + row);
}

function taskCell(task: LargeTaskRow | undefined, cell: number, theme?: PanelTheme): string {
  if (!task) return " ".repeat(cell);
  const icon = task.status === "done" ? "[x]" : task.status === "current" ? "[>]" : "[ ]";
  const text = padTo(`${icon} ${task.text}`, cell);
  return paint(text, TASK_COLORS[task.status], theme, task.status === "current");
}

function logCell(log: LargeLogRow | undefined, pose: OraclePose, cell: number, theme?: PanelTheme): string {
  if (!log) return " ".repeat(cell);
  const style = logStyle(log.status, pose);
  const lead = `${log.time} ${padTo(log.label, LOG_LABEL_WIDTH)}  `;
  const plain = padTo(lead + style.word, cell);
  return paint(lead, "dim", theme) + paint(plain.slice(lead.length), style.color, theme, style.bold);
}

function logStyle(status: LargeLogRow["status"], pose: OraclePose): { word: string; color: PanelColor; bold: boolean } {
  if (status === "oracle") return { word: ORACLE_WORDS[pose], ...ORACLE_COLORS[pose] };
  return { word: SLOT_STATE_WORDS[status], ...SLOT_STATE_COLORS[status] };
}
