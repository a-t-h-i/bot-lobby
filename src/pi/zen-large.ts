import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  BAR,
  BUBBLE,
  CLOSED_EYE,
  EYE_WIDTH,
  GAZE_AHEAD,
  OPEN_EYE,
  ORACLE_AURA,
  ORACLE_AURA_TICKS,
  ORACLE_BLINK,
  ORACLE_BLINKS,
  ORACLE_COLORS,
  ORACLE_FRAMES,
  ORACLE_GAZE_TICKS,
  ORACLE_IDLE_WORD,
  ORACLE_LOOK,
  ORACLE_LOOK_PATH,
  ORACLE_MOOD_MOUTHS,
  ORACLE_PUPILS,
  ORACLE_REST,
  ORACLE_TALK,
  ORACLE_WANDER,
  ORACLE_WANDER_TICKS,
  ORACLE_WORDS,
  SLOT_FRAMES,
  SLOT_LABELS,
  SLOT_STATE_COLORS,
  SLOT_STATE_GLYPHS,
  SLOT_STATE_WORDS,
  SPIN_FRAMES,
  TOWER,
  TOWER_DOOR,
  TOWER_WIDTH,
  type Gaze,
  type OracleFrame,
  type OracleMood,
  type OraclePose,
  type PanelColor,
  type SlotId,
  type SlotState,
} from "./mascot-art.ts";
import type { PanelTheme } from "./zen.ts";

/**
 * The large animated zen scene: a header box, the oracle tower with its speech
 * bubble and tree connector, the four animated agent columns (face, label, status word and
 * elapsed rows), and the TASKS checklist spanning the full scene width (there is
 * no LOG window).
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
export const MAX_LARGE_LINES = 35;

/** One agent column: state, caller-selected animation frame, live activity and elapsed. */
export interface LargeSlot {
  id: SlotId;
  label: string;
  status: SlotState;
  frame: number;
  /** One-word tool activity while working; absent reads as "working". */
  activity?: string;
  /** Run duration label rendered under the status row; "—" when idle. */
  elapsedLabel: string;
}

export interface LargeTaskRow {
  text: string;
  status: "done" | "current" | "pending";
}

/** The oracle's pose plus the caller-clocked animation state (see expressions.ts). */
export interface OracleInput {
  pose: OraclePose;
  /** Expression frame: rest, blink, glance or delight (snore while dormant). */
  frame: number;
  /** Sub-step inside the playing expression; steps the blink lids and the glance. */
  phase?: number;
  /** Lip-sync shape index while the oracle talks about something it just said. */
  talk?: number;
}

/** Everything the large scene draws; assembled by the caller from task and runs. */
export interface LargeSceneInput {
  taskId: string;
  taskTitle: string;
  state: string;
  elapsedLabel: string;
  quietHint: string;
  /** Caller-injected spinner frame; the scene reads no clock. */
  tick: number;
  done: number;
  total: number;
  slots: readonly LargeSlot[];
  tasks: readonly LargeTaskRow[];
  oracle: OracleInput;
  /** Master's live activity for the speech bubble; absent means it waits on the user. */
  oracleActivity?: string;
  /** Plain-words task phase ("writing the plan"); the bubble's fallback second line. */
  caption?: string;
  /** Approval/blocked line; never dropped when present. */
  alert?: string;
  /** Severity of the alert line: approvals are `warning`, blocked is `error`. */
  alertKind?: "warning" | "error";
  /** Name over the tower door, `TOWER_DOOR` when omitted. */
  doorLabel?: string;
}

export const SLOT_CELL = 15;
const SLOT_GAP = 1;
const SLOT_ROWS = 4;
const BRANCH_ROWS = 3;
const SECTION_MIN = 2;
const MAX_SLOTS = 4;
const CONTENT = SCENE_WIDTH - 4;
const TASKS_CELL = CONTENT;

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

/** Bubble rows: top border, the text lines and the bottom border. */
const BUBBLE_ROWS = BUBBLE.lines + 2;
const BUBBLE_TEXT = BUBBLE.width - 4;

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
 * removes or shrinks TASKS.
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
  const rows = [topBorder(input, theme), barRow(input, theme), metaRow(input, theme), bottomBorder(theme)];
  return rows.map((row) => place(row, width));
}

function topBorder(input: LargeSceneInput, theme?: PanelTheme): string {
  const lead = "┌─ BOT-LOBBY ── ";
  const label = truncateToWidth(`${input.taskTitle} · ${input.state} `, SCENE_WIDTH - 18, "…");
  const tail = "─".repeat(Math.max(0, SCENE_WIDTH - 1 - visibleWidth(lead) - visibleWidth(label)));
  return paint(lead, "muted", theme) + paint(label, "accent", theme, true) + paint(`${tail}┐`, "muted", theme);
}

function bottomBorder(theme?: PanelTheme): string {
  return paint(`└${"─".repeat(SCENE_WIDTH - 2)}┘`, "muted", theme);
}

/** Metadata row: elapsed, quiet hint and the task id (the title lives in the border). */
function metaRow(input: LargeSceneInput, theme?: PanelTheme): string {
  const meta = `⏱ ${input.elapsedLabel} · ${input.quietHint} · ${input.taskId}`;
  return boxRow(paint(padTo(meta, CONTENT), "dim", theme), theme);
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
  const sections = input.tasks.length > 0;
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

function frameIndex(input: LargeSceneInput): number {
  return mod(input.oracle.frame, ORACLE_FRAMES[input.oracle.pose].length);
}

function phaseOf(input: LargeSceneInput): number {
  const phase = input.oracle.phase ?? 0;
  return Number.isFinite(phase) && phase > 0 ? Math.floor(phase) : 0;
}

/** The oracle's resting mood: worried by a blocker, otherwise steady. */
export function oracleMood(input: LargeSceneInput): OracleMood {
  return input.alert && input.alertKind === "error" ? "worried" : "steady";
}

function isLooking(input: LargeSceneInput): boolean {
  return frameIndex(input) >= ORACLE_LOOK;
}

/**
 * Where the pupils look. The look-around emote scans the room; while talking the
 * oracle looks at you; while agents work it looks down at them, moving on to
 * the next one every `ORACLE_GAZE_TICKS`; otherwise its eyes wander the room.
 */
export function oracleGaze(input: LargeSceneInput): Gaze {
  if (input.oracle.pose !== "orchestrating") return GAZE_AHEAD;
  if (isLooking(input)) return ORACLE_LOOK_PATH[Math.min(phaseOf(input), ORACLE_LOOK_PATH.length - 1)]!;
  if (input.oracle.talk !== undefined) return GAZE_AHEAD;
  const working = input.slots.flatMap((slot, index) => (slot.status === "working" ? [index] : []));
  if (working.length === 0) return ORACLE_WANDER[mod(Math.floor(input.tick / ORACLE_WANDER_TICKS), ORACLE_WANDER.length)]!;
  const target = working[mod(Math.floor(input.tick / ORACLE_GAZE_TICKS), working.length)]!;
  const centre = (input.slots.length - 1) / 2;
  return { x: target < centre ? -1 : target > centre ? 1 : 0, y: 1 };
}

/** One eye window: a lid fills it, otherwise the pupil sits at the gaze column. */
function eyeCell(pupil: string, gaze: Gaze): string {
  if (pupil === CLOSED_EYE) return CLOSED_EYE.repeat(EYE_WIDTH);
  const glyph = pupil === OPEN_EYE ? ORACLE_PUPILS[gaze.y] : pupil;
  const at = Math.floor(EYE_WIDTH / 2) + gaze.x;
  return Array.from({ length: EYE_WIDTH }, (_value, column) => (column === at ? glyph : " ")).join("");
}

/** Both pupils: blink lids step with the phase, the frame supplies the rest. */
function oraclePupils(input: LargeSceneInput): readonly [string, string] {
  if (frameIndex(input) === ORACLE_BLINK) {
    const lids = ORACLE_BLINKS[input.oracle.pose];
    return lids[Math.min(phaseOf(input), lids.length - 1)]!;
  }
  const frame = oracleFrame(input);
  return [frame.winL, frame.winR];
}

/** The mouth: lip-sync while talking, the mood's straight line or frown otherwise; dormant it snores. */
function oracleMouth(input: LargeSceneInput): string {
  if (input.oracle.pose !== "orchestrating") return oracleFrame(input).mouth;
  if (input.oracle.talk !== undefined) return ORACLE_TALK[mod(input.oracle.talk, ORACLE_TALK.length)]!;
  return ORACLE_MOOD_MOUTHS[oracleMood(input)];
}

/** The whole face for this frame: orb, both eye windows (three columns each) and the mouth. */
export function oracleFace(input: LargeSceneInput): { orb: string; left: string; right: string; mouth: string } {
  const [left, right] = oraclePupils(input);
  const gaze = oracleGaze(input);
  return { orb: oracleFrame(input).orb, left: eyeCell(left, gaze), right: eyeCell(right, gaze), mouth: oracleMouth(input) };
}

function oracleAura(input: LargeSceneInput): string {
  const frames = ORACLE_AURA[input.oracle.pose];
  return frames[mod(Math.floor(input.tick / ORACLE_AURA_TICKS), frames.length)]!;
}

/** Painted token values for one frame; built once and shared by every tower row. */
type TowerValues = ReadonlyMap<string, string>;

function towerValues(input: LargeSceneInput, theme?: PanelTheme): TowerValues {
  const face = oracleFace(input);
  const accent = ORACLE_COLORS[input.oracle.pose];
  const glow = (text: string) => paint(text, accent.color, theme, accent.bold);
  return new Map([
    [TOWER.tokens.aura, paint(oracleAura(input), accent.color, theme)],
    [TOWER.tokens.orb, glow(face.orb)],
    [TOWER.tokens.winL, glow(face.left)],
    [TOWER.tokens.winR, glow(face.right)],
    [TOWER.tokens.mouth, glow(face.mouth)],
    [TOWER.tokens.door, glow(input.doorLabel ?? TOWER_DOOR)],
  ]);
}

function towerRow(row: string, values: TowerValues, theme?: PanelTheme): string {
  return row
    .split(TOWER_PATTERN)
    .map((part) => values.get(part) ?? paint(part, "muted", theme))
    .join("");
}

/** The bubble's first line: what the oracle is doing right now. */
export function oracleSpeech(input: LargeSceneInput): string {
  if (input.oracle.pose !== "orchestrating") return `${SLOT_STATE_GLYPHS.idle} ${ORACLE_WORDS.dormant}`;
  const spin = SPIN_FRAMES[mod(input.tick, SPIN_FRAMES.length)]!;
  if (input.oracleActivity) return `${spin} ${input.oracleActivity}`;
  if (workingLabels(input).length > 0) return `${spin} ${ORACLE_WORDS.orchestrating}`;
  return `${SLOT_STATE_GLYPHS.idle} ${ORACLE_IDLE_WORD}`;
}

function workingLabels(input: LargeSceneInput): string[] {
  return input.slots.filter((slot) => slot.status === "working").map((slot) => slot.label || SLOT_LABELS[slot.id]);
}

/** The bubble's second line: who is at work, else plan progress while building, else the task phase. */
export function oracleAside(input: LargeSceneInput): string {
  const working = workingLabels(input);
  if (input.oracle.pose === "orchestrating" && working.length > 0) return `→ ${working.join(" · ")}`;
  const building = /^(implementing|reviewing)\b/.test(input.state);
  if (building && input.total > 0) {
    return input.done >= input.total ? "all steps done" : `step ${Math.min(input.done + 1, input.total)} of ${input.total}`;
  }
  return input.caption ?? input.state;
}

/**
 * The speech bubble beside the crown: a rounded box with `BUBBLE.lines` text
 * rows. The first text row opens with `┤`, where the tail from the oracle lands.
 */
function bubbleRows(input: LargeSceneInput, theme?: PanelTheme): string[] {
  const accent = ORACLE_COLORS[input.oracle.pose];
  const border = (text: string) => paint(text, "muted", theme);
  const text = (value: string) => padTo(truncateToWidth(value, BUBBLE_TEXT, "…"), BUBBLE_TEXT);
  const rule = "─".repeat(BUBBLE.width - 2);
  return [
    border(`╭${rule}╮`),
    border("┤ ") + paint(text(oracleSpeech(input)), accent.color, theme, accent.bold) + border(" │"),
    border("│ ") + paint(text(oracleAside(input)), "muted", theme) + border(" │"),
    border(`╰${rule}╯`),
  ];
}

/** Row where the bubble starts: its tail row lines up with the crown orb where there is room. */
function bubbleStart(rows: readonly string[]): number {
  const orb = rows.findIndex((row) => row.includes(TOWER.tokens.orb));
  return clamp(orb - 1, 0, Math.max(0, rows.length - BUBBLE_ROWS));
}

/**
 * The tail from the oracle to the bubble: the tower row's trailing blanks plus
 * the one-column gap become `╶──` (`──(◉)── ╶──┤`); a full-width row gets a stub.
 */
function tailRow(row: string, values: TowerValues, theme?: PanelTheme): string {
  const body = row.replace(/ +$/, "");
  const pad = row.length - body.length;
  const tail = pad >= 1 ? ` ╶${"─".repeat(pad - 1)}` : "╶";
  return towerRow(body, values, theme) + paint(tail, "muted", theme);
}

function towerLines(input: LargeSceneInput, width: number, theme: PanelTheme | undefined, size: TowerSize): string[] {
  if (size === "none") return [];
  const rows = size === "small" ? TOWER.smallRows : TOWER.rows;
  const left = " ".repeat(sceneLeft(width) + Math.floor((SCENE_WIDTH - TOWER_WIDTH) / 2));
  const values = towerValues(input, theme);
  const bubble = bubbleRows(input, theme);
  const start = bubbleStart(rows);
  return rows.map((row, index) => {
    const speech = bubble[index - start];
    if (speech === undefined) return left + towerRow(row, values, theme);
    const tower = index === start + 1 ? tailRow(row, values, theme) : `${towerRow(row, values, theme)} `;
    return left + tower + speech;
  });
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
    assemble(end, wordCells(slots, offsets, input.tick, theme)),
    assemble(end, elapsedCells(slots, offsets, theme)),
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

function wordCells(slots: readonly LargeSlot[], offsets: readonly number[], tick: number, theme?: PanelTheme): Cell[] {
  return slots.map((slot, index) => ({
    offset: offsets[index]!,
    text: centre(slotStatusText(slot, tick), SLOT_CELL),
    paint: statusPaint(slot.status, theme),
  }));
}

function elapsedCells(slots: readonly LargeSlot[], offsets: readonly number[], theme?: PanelTheme): Cell[] {
  return slots.map((slot, index) => ({
    offset: offsets[index]!,
    text: centre(slot.elapsedLabel, SLOT_CELL),
    paint: dimPaint(theme),
  }));
}

/** Working agents show the braille spinner with their live activity; every other state keeps its glyph and word. */
function slotStatusText(slot: LargeSlot, tick: number): string {
  if (slot.status !== "working") return `${SLOT_STATE_GLYPHS[slot.status]} ${SLOT_STATE_WORDS[slot.status]}`;
  return `${SPIN_FRAMES[mod(tick, SPIN_FRAMES.length)]!} ${slot.activity ?? SLOT_STATE_WORDS.working}`;
}

/** The elapsed row stays dim so the status row keeps the colour. */
function dimPaint(theme?: PanelTheme): ((text: string) => string) | undefined {
  return theme ? (text) => theme.fg("dim", text) : undefined;
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

/** The full-width TASKS checklist whenever it has rows and the entry budget allows it. */
function sectionLines(
  input: LargeSceneInput,
  width: number,
  theme: PanelTheme | undefined,
  entries: number,
): string[] {
  if (entries < 1) return [];
  const tasks = input.tasks.slice(0, MAX_TASK_ROWS);
  if (tasks.length === 0) return [];
  return soloSection(" TASKS", tasks.map((task) => taskCell(task, TASKS_CELL, theme)), entries, width, theme);
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
