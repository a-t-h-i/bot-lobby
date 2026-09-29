/**
 * The plan as a checklist: its steps parsed from the plan text, and each one
 * done, current or pending from the worker runs so far. Pure.
 */
import type { AgentRun } from "../schemas/findings.ts";

/** Upper bound on parsed plan steps so the checklist stays bounded. */
export const MAX_PLAN_STEPS = 50;

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

/** Where a plan's steps section sits, and each of its top-level steps whole (its nested lines included). */
export interface StepBlocks {
  /** The section's body: from this line up to (not including) `to`. */
  from: number;
  to: number;
  /** One entry per step, the step's lines as written. */
  blocks: string[];
}

/**
 * The steps of a plan written as a list under a `Steps` heading, each with the
 * lines that hang under it, so a step can be moved to another plan whole.
 * Undefined when the plan has no such section (its steps are headings, or
 * scattered); the list found here counts steps the way `planSteps` does.
 */
export function planStepBlocks(plan: string): StepBlocks | undefined {
  const lines = plan.split("\n");
  const heading = lines.findIndex((line) => HEADER_LINE.test(line) && STEP_SECTION.test(line));
  if (heading < 0) return undefined;
  let to = lines.length;
  for (let index = heading + 1; index < lines.length; index += 1) {
    if (HEADER_LINE.test(lines[index]!)) {
      to = index;
      break;
    }
  }
  const blocks: string[][] = [];
  let parent: number | undefined;
  for (let index = heading + 1; index < to; index += 1) {
    const line = lines[index]!;
    const item = sectionItem(line);
    if (item && !(parent !== undefined && item.indent >= parent)) {
      blocks.push([line]);
      parent = item.content;
      continue;
    }
    if (!item && parent !== undefined && line.trim() && indentOf(line) < parent) parent = undefined;
    if (parent !== undefined && blocks.length > 0) blocks[blocks.length - 1]!.push(line);
  }
  return { from: heading + 1, to, blocks: blocks.map((block) => block.join("\n").replace(/\s+$/, "")) };
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
