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
import { EMOTE_FRAME, REST_FRAME } from "./expressions.ts";
import { slotEmote } from "./kaomoji.ts";
import {
  LARGE_MIN_WIDTH,
  MAX_LARGE_LINES,
  MAX_TASK_ROWS,
  largeLines,
  type LargeSceneInput,
  type LargeSlot,
  type LargeTaskRow,
} from "./zen-large.ts";
import { runStatus, sceneMetrics, slotSituation, type SceneMetrics, type SlotView } from "./zen-metrics.ts";
import { feedLine, QUIET_MS, quietFor } from "./run-summary.ts";
import { shortDuration } from "../text.ts";

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
const NUMBERED_STEP_LINE = /^(\s*)(\d+[.)])\s+(.*\S)\s*$/;
const BULLET_LINE = /^(\s*)([*-])\s+(.*\S)\s*$/;
const TOP_LEVEL_BULLET = /^()([*-])\s+(.*\S)\s*$/;
/** `### Step 2: Wire the API`, `**Step 2 — Wire the API**`, `Phase 3) Tests`: one plan step per heading. */
const STEP_HEADING = /^\s*(?:#{1,6}\s+)?(?:\*\*)?\s*(?:step|phase|stage)\s+#?\d+\s*(?:\*\*)?\s*[:.)\u2014\u2013-]\s*(?:\*\*)?\s*(.*?)\s*(?:\*\*)?\s*$/i;
const MIN_STEP_HEADINGS = 2;

export type PlanStepStatus = "done" | "current" | "pending";

export interface PlanStep {
  text: string;
  status: PlanStepStatus;
}

interface ListItem {
  indent: number;
  /** Column where the item's text starts; deeper items are nested under it. */
  content: number;
  text: string;
}

type ItemMatcher = (line: string) => ListItem | undefined;

function indentOf(line: string): number {
  return /^\s*/.exec(line)![0].replace(/\t/g, "    ").length;
}

function itemMatcher(pattern: RegExp): ItemMatcher {
  return (line) => {
    const match = pattern.exec(line);
    if (!match) return undefined;
    const indent = indentOf(match[1]!);
    return { indent, content: indent + match[2]!.length + 1, text: match[3]! };
  };
}

const numberedItem = itemMatcher(NUMBERED_STEP_LINE);
const bulletItem = itemMatcher(BULLET_LINE);
const topBulletItem = itemMatcher(TOP_LEVEL_BULLET);

/** Numbered `1.`/`1)` text, or a bullet inside a step section; undefined otherwise. */
function sectionItem(line: string): ListItem | undefined {
  return numberedItem(line) ?? bulletItem(line);
}

/**
 * Top-level list items only. As in CommonMark, an item indented to its parent's
 * text column is a sub-point of that step, so nested bullets or a nested `1.`
 * list never inflate the checklist. Prose at a shallower indent ends the parent.
 */
function collectSteps(lines: readonly string[], accept: ItemMatcher): string[] {
  const found: string[] = [];
  let parent: number | undefined;
  for (const line of lines) {
    const item = accept(line);
    if (!item) {
      if (parent !== undefined && line.trim() && indentOf(line) < parent) parent = undefined;
      continue;
    }
    if (parent !== undefined && item.indent >= parent) continue;
    found.push(item.text);
    parent = item.content;
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

/** `Step N` headings, when the plan is structured as one heading per step. */
function headingSteps(lines: readonly string[]): string[] {
  const found: string[] = [];
  for (const line of lines) {
    const match = STEP_HEADING.exec(line);
    if (match) found.push(match[1] || line.replace(/[#*]/g, "").trim());
  }
  return found.length >= MIN_STEP_HEADINGS ? found : [];
}

/**
 * Step texts from a free-form plan, capped. `Step N` headings win; then a
 * `sequence|steps|order` section; then numbered lines; when none exists,
 * top-level bullets are the last resort, so unrelated bullet lists under other
 * headers never leak into the checklist. Only the shallowest items count.
 */
export function planSteps(plan: string): string[] {
  const lines = plan.split("\n");
  const headings = headingSteps(lines);
  if (headings.length > 0) return headings.slice(0, MAX_PLAN_STEPS);
  const section = stepSection(lines);
  if (section) {
    const sectioned = collectSteps(section, sectionItem);
    if (sectioned.length > 0) return sectioned.slice(0, MAX_PLAN_STEPS);
  }
  const numbered = collectSteps(lines, numberedItem);
  if (numbered.length > 0) return numbered.slice(0, MAX_PLAN_STEPS);
  return collectSteps(lines, topBulletItem).slice(0, MAX_PLAN_STEPS);
}

/* -------------------------------------------------------------------------
 * Step matching. A worker instruction names its step explicitly ("Step 3: ...")
 * or is scored against every step by shared paths, a shared opening phrase and
 * word overlap. Plans reuse file paths across steps, so near-ties go to the
 * earliest step still open instead of the first step that ever mentioned the
 * path -- otherwise every later instruction re-matches step 1 and the tracker
 * never moves.
 * ---------------------------------------------------------------------- */

const STEP_REFERENCE = /\bsteps?\s*#?\s*(\d+)(?:\s*(?:-|\u2013|\u2014|to|through|thru|and|&)\s*#?\s*(\d+))?/gi;
/** Text allowed before a step reference that labels the instruction itself ("Now implement step 3:"). */
const LEADING_LABEL = /^[\s\W]*(?:(?:now|next|then|please|implement|do|complete|execute|start|begin|finish|work on|continue with|proceed with|plan)\s+)*(?:the\s+)?$/i;
const MIN_SCORE = 0.5;
const NEAR_TIE = 0.35;
const PATH_WEIGHT = 0.75;
const PREFIX_WEIGHT = 1;
const WORD = /[a-z0-9_][a-z0-9_./-]*[a-z0-9_]/g;
const MIN_WORD = 3;
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "then", "when", "each", "use", "make",
  "sure", "new", "all", "any", "its", "are", "not", "but", "now", "via", "per", "our", "your", "you",
  "has", "have", "will", "should", "must", "also", "only", "step", "steps", "plan", "approved",
  "implement", "please", "add", "update", "change", "changes", "file", "files", "code",
]);

function normalize(text: string): string {
  return text.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function significantWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const word of normalize(text).match(WORD) ?? []) {
    if (word.length >= MIN_WORD && !STOP_WORDS.has(word)) words.add(word);
  }
  return words;
}

/** Scoring context for one instruction, built once per run and reused for every step. */
interface InstructionIndex {
  text: string;
  words: Set<string>;
}

function indexInstruction(instruction: string): InstructionIndex {
  return { text: normalize(instruction), words: significantWords(instruction) };
}

function prefixMatches(step: string, hay: string): boolean {
  const tail = normalize(step.replace(/`[^`]+`/g, " ").replace(/^[\s:;,.\u2014\u2013-]+/, ""));
  return tail.length >= MIN_PREFIX && hay.includes(tail.slice(0, PREFIX_CHARS));
}

function pathShare(step: string, hay: string): number {
  const paths = [...step.matchAll(/`([^`]+)`/g)].map((match) => normalize(match[1]!)).filter((path) => path.length > 0);
  if (paths.length === 0) return 0;
  return paths.filter((path) => hay.includes(path)).length / paths.length;
}

function wordShare(step: string, words: ReadonlySet<string>): number {
  const own = significantWords(step);
  if (own.size === 0) return 0;
  let shared = 0;
  for (const word of own) if (words.has(word)) shared += 1;
  return shared / own.size;
}

/** How strongly an instruction targets one step; 0 when it shares nothing. */
function stepScore(step: string, instruction: InstructionIndex): number {
  const prefix = prefixMatches(step, instruction.text) ? PREFIX_WEIGHT : 0;
  return prefix + PATH_WEIGHT * pathShare(step, instruction.text) + wordShare(step, instruction.words);
}

/**
 * Highest 0-based step an instruction labels itself with ("Step 3: ...", "steps 2-4"),
 * or -1. A reference counts when it opens the instruction or is the only one
 * named, so "building on step 1, now do step 3" does not jump back to step 1.
 */
export function explicitStepIndex(instruction: string, count: number): number {
  const refs = [...instruction.matchAll(STEP_REFERENCE)];
  if (refs.length === 0) return -1;
  const first = refs[0]!;
  const leading = LEADING_LABEL.test(instruction.slice(0, first.index ?? 0)) ? first : undefined;
  const distinct = new Set(refs.map((ref) => ref[0].toLowerCase().replace(/\s+/g, "")));
  const chosen = leading ?? (distinct.size === 1 ? refs[0] : undefined);
  if (!chosen) return -1;
  const last = Math.max(Number(chosen[1]), Number(chosen[2] ?? chosen[1]));
  return last >= 1 && last <= count ? last - 1 : -1;
}

/**
 * The step an instruction targets, given the steps already completed; -1 when
 * nothing matches. Among near-tied candidates the earliest open step wins.
 */
export function targetStep(steps: readonly string[], instruction: string | undefined, completed: ReadonlySet<number> = new Set()): number {
  if (!instruction || steps.length === 0) return -1;
  const explicit = explicitStepIndex(instruction, steps.length);
  if (explicit >= 0) return explicit;
  const index = indexInstruction(instruction);
  const scores = steps.map((step) => stepScore(step, index));
  const best = Math.max(...scores);
  if (best < MIN_SCORE) return -1;
  const near = scores.findIndex((score, at) => score >= best - NEAR_TIE && score >= MIN_SCORE && !completed.has(at));
  return near >= 0 ? near : scores.indexOf(best);
}

/** The latest worker run carrying an instruction; its step is the current one. */
export function latestWorkerRun(runs: readonly AgentRun[]): AgentRun | undefined {
  let latest: AgentRun | undefined;
  for (const run of runs) {
    if (run.role !== "worker" || !run.instruction) continue;
    if (!latest || Date.parse(run.startedAt) >= Date.parse(latest.startedAt)) latest = run;
  }
  return latest;
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

function byStart(runs: readonly AgentRun[]): AgentRun[] {
  const time = (run: AgentRun) => {
    const at = Date.parse(run.startedAt);
    return Number.isFinite(at) ? at : 0;
  };
  return runs
    .map((run, order) => ({ run, order }))
    .sort((a, b) => time(a.run) - time(b.run) || a.order - b.order)
    .map((entry) => entry.run);
}

/**
 * Replays worker runs in start order. A successful run completes everything up
 * to its target step; a run that matches nothing -- the common case for a
 * reworded instruction -- completes the next still-open step, so the count only
 * grows and a failure can never tick one off. The latest worker run's own target
 * is reported separately so a running or failed step reads current.
 */
function replaySteps(steps: readonly string[], runs: readonly AgentRun[]): { completed: number; latest: number } {
  const completed = new Set<number>();
  const latestRun = latestWorkerRun(runs);
  let latest = -1;
  for (const run of byStart(runs)) {
    if (run.role !== "worker") continue;
    const matched = targetStep(steps, run.instruction, completed);
    if (run === latestRun) latest = matched >= 0 && run.status === "success" ? matched + 1 : matched;
    if (run.status !== "success") continue;
    const target = matched >= 0 ? matched : nextOpenStep(steps, completed);
    if (target >= 0) markThrough(completed, target);
  }
  return { completed: completed.size, latest };
}

/** One-entry memo: the panel asks for the same checklist several times per frame. */
let checklistMemo: { plan: string; runs: readonly AgentRun[]; steps: PlanStep[] } | undefined;

/**
 * Done/current/pending per plan step. A succeeded run completes its step, so the
 * next step becomes current (and the last step reads done); running, failed,
 * cancelled and timeout runs keep it current. Progress is monotonic: steps
 * already completed by successful worker runs stay done, and a later call that
 * names an earlier step can never tick it back. Memoized on the exact plan text
 * and runs array, so callers must not mutate either.
 */
export function planChecklist(plan: string, runs: readonly AgentRun[]): PlanStep[] {
  if (checklistMemo && checklistMemo.plan === plan && checklistMemo.runs === runs) return checklistMemo.steps;
  const texts = planSteps(plan);
  const replay = replaySteps(texts, runs);
  const current = Math.max(replay.completed, replay.latest);
  const steps = texts.map((text, index) => ({ text, status: stepStatus(index, current) }));
  checklistMemo = { plan, runs, steps };
  return steps;
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

function checklistRow(step: PlanStep, ordinal: number): string {
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
    const activity = `${run.activity ?? "working"}${run.detail ? ` ${run.detail}` : ""}`;
    const quiet = quietFor(run, now);
    const warning = run.waitingFor ? ` · waiting for ${run.waitingFor}` : quiet >= QUIET_MS ? ` · quiet ${shortDuration(quiet)}` : "";
    return `  ${spinner} agents working (${running.length}) · ${run.domain}/${run.role} ${activity} ${formatDuration(runElapsed(run, now))}${warning}`;
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

/** Per-expression variant per slot; picks which kaomoji an emote shows. */
export type ExpressionVariants = Partial<Record<SlotId, number>>;

/**
 * The oracle and the compact strip keep their original two emote steps: the
 * four emote frames (open, blink, action, action) fold onto them pairwise.
 */
export function foldEmoteFrame(frame: number): number {
  if (!Number.isFinite(frame) || frame < EMOTE_FRAME) return frame;
  return EMOTE_FRAME + Math.min(1, Math.floor((frame - EMOTE_FRAME) / 2));
}

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
  return frameAt(COMPACT_FRAMES[slot.id][slot.status], foldEmoteFrame(expressions[slot.id] ?? REST_FRAME));
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
  return checklistWindow(steps, count).map((index) => checklistRow(steps[index]!, index + 1));
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

function sceneSlots(metrics: SceneMetrics, expressions: ExpressionFrames, variants: ExpressionVariants): LargeSlot[] {
  return metrics.slots.map((slot) => ({
    ...slot,
    frame: expressions[slot.id] ?? REST_FRAME,
    emote: slotEmote(slot.id, slotSituation(slot), variants[slot.id] ?? 0),
  }));
}

function oracleSlot(task: Task, expressions: ExpressionFrames, motion: OracleMotion): LargeSceneInput["oracle"] {
  const pose = oraclePose(task);
  return { pose, frame: foldEmoteFrame(expressions.oracle ?? REST_FRAME), ...motion };
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
  opts: PanelOptions,
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
    slots: sceneSlots(metrics, opts.expressions ?? {}, opts.variants ?? {}),
    tasks: sceneTasks(steps),
    oracle: oracleSlot(task, opts.expressions ?? {}, opts.oracleMotion ?? {}),
    oracleActivity: opts.oracleActivity,
    caption: task.paused ? "task paused" : SCENE_PROPS[task.state],
    alert: alert?.text,
    alertKind: alert?.kind,
    feed: feedLine(runs, now, tick),
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
  /** Caller-drawn variant per slot expression; picks the emote's face. */
  variants?: ExpressionVariants;
  /** Live master activity word for the oracle's speech bubble; absent means it waits on the user. */
  oracleActivity?: string;
  /** Caller-clocked oracle animation: the expression's sub-step and the lip-sync shape. */
  oracleMotion?: OracleMotion;
}

/** The oracle's clocked animation state beyond its expression frame (see expressions.ts). */
export interface OracleMotion {
  phase?: number;
  talk?: number;
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
    const scene = largeLines(sceneInput(task, runs, now, quiet, tick, steps, opts), width, budget, opts.theme);
    return scene.map((line) => truncateToWidth(line, width));
  }
  return compactPanel(task, runs, now, quiet, tick, steps, opts, width);
}
