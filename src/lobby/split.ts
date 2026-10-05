/**
 * Splitting a long plan into tasks. When the user saves a plan with many
 * steps, the oracle proposes how to cut it into two to five tasks, the user
 * decides (keep it whole, take the split, or say what to change), and each part
 * is saved as a pending task that knows its siblings.
 *
 * The oracle decides where the lines go; the engine enforces the rest: at
 * most `MAX_SPLIT_TASKS` tasks, every step of the plan in exactly one of them,
 * and a task only ever building on earlier ones. A proposal that breaks a rule
 * is sent back once with the problems, and never reaches the user. Each part's
 * brief is composed here from the plan as written (its objective, decisions,
 * assumptions and risks stay whole, its steps section holds only that part's
 * steps), so nothing the user agreed can be lost in a model's retelling.
 */
import { loadPrompt } from "../prompts/loader.ts";
import { planStepBlocks } from "../pi/plan-checklist.ts";
import type { SplitInfo } from "../state/backlog.ts";
import type { AskQuestion } from "../ask/types.ts";

/** The most tasks a plan is split into. */
export const MAX_SPLIT_TASKS = 5;
/** Times the user may ask the oracle to change a split before it is final. */
export const MAX_SPLIT_REVISIONS = 3;

export interface SplitTask {
  title: string;
  goal: string;
  /** The plan's steps (numbered from 1) this task does. */
  covers: number[];
  /** Earlier tasks (numbered from 1) it builds on. */
  after: number[];
  done: string[];
}

export interface SplitProposal {
  tasks: SplitTask[];
  /** What the oracle tells the user about the split. */
  note?: string;
}

export function splitPrompt(instructions?: string): string {
  const custom = instructions?.trim();
  return custom ? `${loadPrompt("splitter.md")}\n\n## Custom Instructions\n\n${custom}` : loadPrompt("splitter.md");
}

/** `3, 5-6` as [3, 5, 6]; `none` (or nothing) as []. Ranges are bounded, so a stray `1-999999` cannot fill memory. */
export function parseNumbers(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/(\d+)(?:\s*[-–—]\s*(\d+))?/g)) {
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    for (let number = first; number <= Math.min(last, first + 200); number += 1) found.add(number);
  }
  return [...found].sort((a, b) => a - b);
}

/** Read the oracle's reply into a proposal; throws a one-line reason when it has no tasks at all. */
export function parseSplit(text: string): SplitProposal {
  const [head = "", ...after] = text.split(/^##\s+Note\s*$/im);
  const note = after.join("\n").trim().replace(/\s+/g, " ") || undefined;
  const parts = head.split(/^###\s+\d+[.):]?\s*/m).slice(1);
  if (parts.length === 0) throw new Error("no tasks found: write each as `### 1. Title` with Goal, Covers, After and Done when");
  const tasks = parts.map((part): SplitTask => {
    const lines = part.split("\n");
    const title = (lines[0] ?? "").replace(/[*_`#]/g, "").trim();
    const value = (key: string) => new RegExp(`^\\s*[-*]?\\s*\\**${key}\\**\\s*:\\**\\s*(.*)$`, "im").exec(part)?.[1]?.trim() ?? "";
    const doneAt = lines.findIndex((line) => /^\s*\**done when\**\s*:/i.test(line));
    const inline = doneAt < 0 ? undefined : /:\**\s*(\S.*)$/.exec(lines[doneAt]!)?.[1];
    const bullets = doneAt < 0 ? [] : lines.slice(doneAt + 1).filter((line) => /^\s*[-*]\s+\S/.test(line)).map((line) => line.replace(/^\s*[-*]\s+/, "").trim());
    const done = [...(inline ? [inline] : []), ...bullets];
    return { title, goal: value("goal"), covers: parseNumbers(value("covers")), after: parseNumbers(value("after")), done };
  });
  return { tasks, ...(note ? { note } : {}) };
}

/** Every rule a proposal breaks, in words the oracle can act on; empty when it is sound. */
export function splitProblems(proposal: SplitProposal, stepCount: number, max = MAX_SPLIT_TASKS): string[] {
  const problems: string[] = [];
  const { tasks } = proposal;
  if (tasks.length < 2) problems.push("a split needs at least 2 tasks");
  if (tasks.length > max) problems.push(`a plan is split into at most ${max} tasks, not ${tasks.length}`);
  const owner = new Map<number, number>();
  tasks.forEach((task, index) => {
    const number = index + 1;
    if (!task.title) problems.push(`task ${number} has no title`);
    if (task.covers.length === 0) problems.push(`task ${number} covers no steps`);
    for (const step of task.covers) {
      if (step < 1 || step > stepCount) problems.push(`task ${number} covers step ${step}, but the plan has steps 1 to ${stepCount}`);
      else if (owner.has(step)) problems.push(`step ${step} is in both task ${owner.get(step)} and task ${number}`);
      else owner.set(step, number);
    }
    for (const earlier of task.after) if (earlier >= number || earlier < 1) problems.push(`task ${number} cannot come after task ${earlier}: list the tasks in the order they can be done, each building only on earlier ones`);
  });
  const missing = Array.from({ length: stepCount }, (_, index) => index + 1).filter((step) => !owner.has(step));
  if (missing.length > 0) problems.push(`step${missing.length === 1 ? "" : "s"} ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} in no task: every step belongs to exactly one`);
  return [...new Set(problems)];
}

/** `1-3, 5` for step numbers. */
export function rangeWords(numbers: readonly number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < numbers.length; ) {
    let end = index;
    while (end + 1 < numbers.length && numbers[end + 1] === numbers[end]! + 1) end += 1;
    parts.push(end > index ? `${numbers[index]}-${numbers[end]}` : String(numbers[index]));
    index = end + 1;
  }
  return parts.join(", ");
}

/** What the oracle is asked: the plan, its steps as numbered here, and, on a revision, the split so far with what the user wants changed. */
export function splitRequest(input: { title: string; plan: string; steps: readonly string[]; max?: number; revision?: { previous: SplitProposal; words: string }; rejected?: readonly string[] }): string {
  const max = input.max ?? MAX_SPLIT_TASKS;
  const lines = [
    `Split this plan into 2 to ${max} tasks: ${input.title}`,
    "",
    `The plan has ${input.steps.length} steps. They are numbered here in the order of its Steps section; use these numbers in Covers.`,
    ...input.steps.map((step, index) => `${index + 1}. ${step.replace(/\s+/g, " ").trim()}`),
    "",
    "## The plan",
    "",
    input.plan.trim(),
  ];
  if (input.revision) {
    lines.push("", "## The split so far", "", proposalText(input.revision.previous), "", `## What the user wants changed`, "", input.revision.words.trim(), "", "Apply exactly that and keep the rest of the split as it is.");
  }
  if (input.rejected && input.rejected.length > 0) {
    lines.push("", "## Your last split was rejected", "", ...input.rejected.map((problem) => `- ${problem}`), "", "Answer again in the required format with a split that breaks none of these.");
  }
  return lines.join("\n");
}

/** A proposal as the oracle's own format, so a revision starts from what it (and the user) saw. */
export function proposalText(proposal: SplitProposal): string {
  return [
    "## Tasks",
    ...proposal.tasks.flatMap((task, index) => [
      `### ${index + 1}. ${task.title}`,
      `Goal: ${task.goal}`,
      `Covers: ${rangeWords(task.covers)}`,
      `After: ${task.after.length > 0 ? rangeWords(task.after) : "none"}`,
      ...(task.done.length > 0 ? ["Done when:", ...task.done.map((point) => `- ${point}`)] : []),
      "",
    ]),
    ...(proposal.note ? ["## Note", proposal.note] : []),
  ].join("\n").trimEnd();
}

/** Markdown for the questionnaire's preview: each task with the steps it takes. */
export function splitPreview(proposal: SplitProposal, steps: readonly string[]): string {
  const clip = (text: string) => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > 110 ? `${flat.slice(0, 109)}…` : flat;
  };
  return proposal.tasks.map((task, index) => [
    `**${index + 1}. ${task.title}** · step${task.covers.length === 1 ? "" : "s"} ${rangeWords(task.covers)}${task.after.length > 0 ? ` · after ${rangeWords(task.after)}` : ""}`,
    ...(task.goal ? [`_${clip(task.goal)}_`] : []),
    ...task.covers.map((step) => `- ${step}. ${clip(steps[step - 1] ?? "")}`),
  ].join("\n")).join("\n\n");
}

/** The question the user answers: take the split, keep the plan whole, or write what to change. */
export function splitQuestion(input: { stepCount: number; proposal: SplitProposal; steps: readonly string[]; revisions: number }): AskQuestion {
  const count = input.proposal.tasks.length;
  const last = input.revisions >= MAX_SPLIT_REVISIONS;
  return {
    header: "Split plan",
    question: [
      `This plan has **${input.stepCount} steps**. The oracle suggests splitting it into **${count} tasks**, each finished and reviewed on its own.`,
      ...(input.proposal.note ? [input.proposal.note] : []),
      last ? "This is the last revision: take it, or keep the plan whole." : "Type what to change (for example *merge 2 and 3*) to revise it.",
    ].join("\n\n"),
    options: [
      { label: splitLabel(count), description: "Each part is saved as its own pending task, in order, knowing the others.", preview: splitPreview(input.proposal, input.steps) },
      { label: "Keep it as one task", description: `One task with all ${input.stepCount} steps.` },
    ],
  };
}

export const KEEP_WHOLE = "Keep it as one task";

export function splitLabel(count: number): string {
  return `Split into ${count} tasks`;
}

/** Ask whether to save a plan as one task after the oracle could not split it. */
export function splitFailedQuestion(reason: string): AskQuestion {
  return {
    header: "Split plan",
    question: `The oracle could not split this plan (${reason.replace(/\s+/g, " ").trim()}). Save it as one task?`,
    options: [
      { label: "Save it as one task", description: "All the steps in one pending task." },
      { label: "Not now", description: "Save nothing; ctrl+s asks again." },
    ],
  };
}

/** The original plan with its Steps section holding only `covers` (renumbered); undefined when the plan's steps are not a list. */
function planWithSteps(plan: string, covers: readonly number[], stepCount: number): string | undefined {
  const found = planStepBlocks(plan);
  if (!found || found.blocks.length !== stepCount) return undefined;
  const lines = plan.split("\n");
  const kept = covers.map((step, index) => found.blocks[step - 1]!.replace(/^(\s*)\d+([.)])/, (_all, indent: string, mark: string) => `${indent}${index + 1}${mark}`));
  const spacer = found.to > found.from && !(lines[found.to - 1] ?? "").trim() ? [""] : [];
  return [...lines.slice(0, found.from), ...kept.flatMap((block) => block.split("\n")), ...spacer, ...stepDetails(lines.slice(found.to), covers)].join("\n");
}

/** `### Step 3: …` (or `**Step 3 — …**`): the heading of one step's detail. */
const DETAIL_HEADING = /^(\s*(?:#{1,6}\s+)?(?:\*\*)?\s*step\s+#?)(\d+)(?!\d)/i;
const ANY_HEADING = /^\s*(?:(#{1,6})\s+\S.*|\*\*[^*]+\*\*.*)$/;

/** A heading's depth: `#` is 1, a bold line deeper than any `#`. */
const depth = (line: string): number => ANY_HEADING.exec(line)?.[1]?.length ?? 7;

/**
 * The lines after a plan's steps list with only the detail of the steps in `covers`, renumbered as
 * the list was: a step's detail runs from its `Step N` heading to the next heading as deep or deeper.
 */
function stepDetails(lines: readonly string[], covers: readonly number[]): string[] {
  const out: string[] = [];
  let skipping: number | undefined;
  for (const line of lines) {
    const heading = ANY_HEADING.test(line) ? depth(line) : undefined;
    if (skipping !== undefined && heading !== undefined && heading <= skipping) skipping = undefined;
    const detail = heading !== undefined ? DETAIL_HEADING.exec(line) : null;
    if (detail) {
      const at = covers.indexOf(Number(detail[2]));
      if (at < 0) {
        skipping = heading;
        continue;
      }
      out.push(line.replace(DETAIL_HEADING, (_all, lead: string) => `${lead}${at + 1}`));
      continue;
    }
    if (skipping === undefined) out.push(line);
  }
  return out;
}

/** One part's brief: where it sits, what it delivers, then the plan as written with only its own steps. */
export function partBrief(input: { plan: string; steps: readonly string[]; proposal: SplitProposal; index: number }): string {
  const { proposal, index } = input;
  const task = proposal.tasks[index]!;
  const of = proposal.tasks.length;
  const head = [
    `### Part ${index + 1} of ${of} — ${task.title}`,
    ...(task.goal ? [`**Goal of this part:** ${task.goal}`] : []),
    ...(task.after.length > 0 ? [`**Builds on:** ${task.after.map((part) => `part ${part} — ${proposal.tasks[part - 1]?.title ?? ""}`).join("; ")} (finish that first).`] : []),
    ...(task.done.length > 0 ? ["**Done when:**", ...task.done.map((point) => `- ${point}`)] : []),
  ].join("\n");
  const own = planWithSteps(input.plan, task.covers, input.steps.length);
  if (own) return `${head}\n\n${own.trim()}`;
  // Steps that are not a list: the whole plan, with this part's steps named on top.
  const named = task.covers.map((step, position) => `${position + 1}. ${(input.steps[step - 1] ?? "").replace(/\s+/g, " ").trim()}`);
  return `${head}\n\n**Steps of this part (do only these; the plan below is the whole plan, for context):**\n${named.join("\n")}\n\n${input.plan.trim()}`;
}

/** What each saved part knows of the others. */
export function partInfo(proposal: SplitProposal, index: number, group: string): SplitInfo {
  const task = proposal.tasks[index]!;
  return { group, part: index + 1, of: proposal.tasks.length, titles: proposal.tasks.map((entry) => entry.title), after: [...task.after] };
}
