import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planStepBlocks, planSteps } from "../src/pi/plan-checklist.ts";
import { MAX_SPLIT_REVISIONS, MAX_SPLIT_TASKS, parseNumbers, parseSplit, partBrief, proposalText, rangeWords, splitFailedQuestion, splitPrompt, splitProblems, splitPreview, splitQuestion, splitRequest, type SplitProposal } from "../src/lobby/split.ts";
import { PlanningSession } from "../src/lobby/planner.ts";
import { listPlannedTasks, markPlannedTaskStarted, plannedTaskRequest, savePlannedTask } from "../src/state/backlog.ts";
import { unfinishedBefore } from "../src/pi/start-task.ts";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, saveTask } from "../src/state/persistence.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import { readMetrics } from "../src/state/metrics.ts";
import { LobbyFeed } from "../src/lobby/feed.ts";
import type { AskQuestion, AskResult } from "../src/ask/types.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const PLAN = [
  "### Objective",
  "Add dark mode across the app.",
  "### Scope and non-goals",
  "Web only; no OS sync.",
  "### Decisions by domain",
  "- DESIGN: use CSS variables.",
  "### Assumptions",
  "- [QA] Evergreen browsers only.",
  "### Steps",
  "1. Define colour tokens",
  "   - light and dark values",
  "2. Add the theme store",
  "3. Persist the choice",
  "4. Build the toggle component",
  "5. Wire the header",
  "6. Style the tables",
  "7. Style the forms",
  "8. Style the modals",
  "9. Test contrast",
  "10. Update the docs",
  "### Risks and open points",
  "Contrast in charts.",
].join("\n");

/** What the oracle answers: three tasks that cover every step once. */
const SPLIT = [
  "## Tasks",
  "### 1. Theme foundation",
  "Goal: tokens, a store and persistence.",
  "Covers: 1-3",
  "After: none",
  "Done when:",
  "- the theme can be switched in code",
  "- the choice survives a reload",
  "",
  "### 2. Toggle and header",
  "Goal: users can switch themes.",
  "Covers: 4, 5",
  "After: 1",
  "Done when:",
  "- the header shows a working toggle",
  "",
  "### 3. Style and verify",
  "Goal: every screen follows the theme.",
  "Covers: 6-10",
  "After: 1, 2",
  "Done when:",
  "- contrast passes on all screens",
  "",
  "## Note",
  "Part 1 must go first; 2 and 3 can run side by side after it.",
].join("\n");

const STEPS = planSteps(PLAN);

test("the steps section of a plan is read whole, nested lines included, and counts steps as planSteps does", () => {
  assert.equal(STEPS.length, 10);
  const found = planStepBlocks(PLAN)!;
  assert.equal(found.blocks.length, 10);
  assert.equal(found.blocks[0], "1. Define colour tokens\n   - light and dark values");
  assert.equal(found.blocks[9], "10. Update the docs");
  const lines = PLAN.split("\n");
  assert.equal(lines[found.from], "1. Define colour tokens");
  assert.equal(lines[found.to], "### Risks and open points");
  assert.equal(planStepBlocks("### Objective\nNo steps here."), undefined);
  assert.equal(planStepBlocks("### Steps\n- a\n- b\n\n### Next")!.blocks.length, 2, "bullets count under a Steps heading");
});

test("the oracle's reply reads into tasks with their steps, dependencies and done-when points", () => {
  const proposal = parseSplit(SPLIT);
  assert.deepEqual(proposal.tasks.map((task) => [task.title, task.covers, task.after]), [
    ["Theme foundation", [1, 2, 3], []],
    ["Toggle and header", [4, 5], [1]],
    ["Style and verify", [6, 7, 8, 9, 10], [1, 2]],
  ]);
  assert.equal(proposal.tasks[0]!.goal, "tokens, a store and persistence.");
  assert.deepEqual(proposal.tasks[0]!.done, ["the theme can be switched in code", "the choice survives a reload"]);
  assert.equal(proposal.note, "Part 1 must go first; 2 and 3 can run side by side after it.");
  assert.throws(() => parseSplit("I would split it in three."), /no tasks found/);
  assert.deepEqual(parseNumbers("1, 3 and 5–7"), [1, 3, 5, 6, 7]);
  assert.deepEqual(parseNumbers("none"), []);
  assert.equal(parseNumbers("1-99999").length, 201, "a stray huge range is bounded");
  assert.equal(rangeWords([1, 2, 3, 5, 7, 8]), "1-3, 5, 7-8");
  assert.equal(parseSplit(SPLIT.replace("Covers: 1-3", "**Covers:** 1-3")).tasks[0]!.covers.length, 3, "bold keys still read");
  assert.equal(parseSplit(proposalText(proposal)).tasks.length, 3, "a proposal reads back from its own text");
});

test("the engine holds a split to its rules: 2 to 5 tasks, every step once, only earlier tasks to build on", () => {
  const good = parseSplit(SPLIT);
  assert.deepEqual(splitProblems(good, 10), []);
  const task = (covers: number[], after: number[] = [], title = "t") => ({ title, goal: "", covers, after, done: [] });
  const problems = (tasks: SplitProposal["tasks"], count = 10) => splitProblems({ tasks }, count);
  assert.deepEqual(problems([task([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]), ["a split needs at least 2 tasks"]);
  assert.match(problems(Array.from({ length: 6 }, (_, index) => task([index + 1])), 6)[0]!, /at most 5 tasks, not 6/);
  assert.match(problems([task([1, 2, 3, 4, 5]), task([5, 6, 7, 8, 9, 10])]).join("\n"), /step 5 is in both task 1 and task 2/);
  assert.match(problems([task([1, 2, 3]), task([4, 5, 6, 7, 8])]).join("\n"), /steps 9, 10 are in no task: every step belongs to exactly one/);
  assert.match(problems([task([1, 2, 3, 4, 5]), task([6, 7, 8, 9, 10, 11])]).join("\n"), /covers step 11, but the plan has steps 1 to 10/);
  assert.match(problems([task([1, 2, 3, 4, 5], [2]), task([6, 7, 8, 9, 10])]).join("\n"), /task 1 cannot come after task 2/);
  assert.match(problems([task([1, 2, 3, 4, 5]), task([6, 7, 8, 9, 10], [2])]).join("\n"), /task 2 cannot come after task 2/);
  assert.match(problems([task([1, 2, 3, 4, 5]), task([], [1]), task([6, 7, 8, 9, 10])]).join("\n"), /task 2 covers no steps/);
  assert.match(problems([task([1, 2, 3, 4, 5], [], ""), task([6, 7, 8, 9, 10])]).join("\n"), /task 1 has no title/);
  assert.equal(MAX_SPLIT_TASKS, 5);
});

test("each part's brief keeps the whole plan but for its steps, which are renumbered, nested lines and all", () => {
  const proposal = parseSplit(SPLIT);
  const first = partBrief({ plan: PLAN, steps: STEPS, proposal, index: 0 });
  assert.match(first, /^### Part 1 of 3 — Theme foundation\n\*\*Goal of this part:\*\* tokens, a store and persistence\.\n\*\*Done when:\*\*\n- the theme can be switched in code/);
  assert.doesNotMatch(first, /Builds on/);
  assert.match(first, /### Objective\nAdd dark mode across the app\.[\s\S]*### Decisions by domain\n- DESIGN: use CSS variables\.[\s\S]*### Assumptions\n- \[QA\] Evergreen browsers only\./, "what the user agreed is kept as written");
  assert.match(first, /### Steps\n1\. Define colour tokens\n {3}- light and dark values\n2\. Add the theme store\n3\. Persist the choice\n### Risks and open points\nContrast in charts\./);
  assert.doesNotMatch(first, /toggle component|Style the tables/, "other parts' steps are not in it");
  const third = partBrief({ plan: PLAN, steps: STEPS, proposal, index: 2 });
  assert.match(third, /\*\*Builds on:\*\* part 1 — Theme foundation; part 2 — Toggle and header \(finish that first\)\./);
  assert.match(third, /### Steps\n1\. Style the tables\n2\. Style the forms\n3\. Style the modals\n4\. Test contrast\n5\. Update the docs\n### Risks/, "renumbered from 1");
});

test("a plan whose steps are not a list gets the whole plan with the part's own steps named on top", () => {
  const headed = "### Objective\nDo it.\n### Step 1: Model\nThe model.\n### Step 2: API\nThe API.\n### Step 3: Screen\nThe screen.";
  const steps = planSteps(headed);
  assert.deepEqual(steps, ["Model", "API", "Screen"]);
  assert.equal(planStepBlocks(headed), undefined);
  const proposal: SplitProposal = { tasks: [{ title: "Backend", goal: "", covers: [1, 2], after: [], done: [] }, { title: "Screen", goal: "", covers: [3], after: [1], done: [] }] };
  const brief = partBrief({ plan: headed, steps, proposal, index: 1 });
  assert.match(brief, /^### Part 2 of 2 — Screen\n\*\*Builds on:\*\* part 1 — Backend/);
  assert.match(brief, /\*\*Steps of this part \(do only these; the plan below is the whole plan, for context\):\*\*\n1\. Screen\n\n### Objective\nDo it\./);
});

test("the oracle is asked with the numbered steps, and on a revision with the split so far and the user's words", () => {
  const proposal = parseSplit(SPLIT);
  const first = splitRequest({ title: "Dark mode", plan: PLAN, steps: STEPS });
  assert.match(first, /^Split this plan into 2 to 5 tasks: Dark mode\n\nThe plan has 10 steps\./);
  assert.match(first, /\n1\. Define colour tokens\n2\. Add the theme store/);
  assert.match(first, /## The plan\n\n### Objective/);
  assert.doesNotMatch(first, /The split so far/);
  const revised = splitRequest({ title: "Dark mode", plan: PLAN, steps: STEPS, revision: { previous: proposal, words: "merge 2 and 3" } });
  assert.match(revised, /## The split so far\n\n## Tasks\n### 1\. Theme foundation[\s\S]*## What the user wants changed\n\nmerge 2 and 3\n\nApply exactly that/);
  const again = splitRequest({ title: "Dark mode", plan: PLAN, steps: STEPS, rejected: ["step 9 is in no task"] });
  assert.match(again, /## Your last split was rejected\n\n- step 9 is in no task/);
  assert.match(splitPrompt("Prefer three tasks."), /^# Plan Splitter[\s\S]*## Custom Instructions\n\nPrefer three tasks\.$/);
  assert.match(splitPrompt(), /at most five, at least two/);
});

test("the user is asked with the split as a preview, and can take it, keep the plan whole or write what to change", () => {
  const proposal = parseSplit(SPLIT);
  const question = splitQuestion({ stepCount: 10, proposal, steps: STEPS, revisions: 0 });
  assert.equal(question.header, "Split plan");
  assert.match(question.question, /This plan has \*\*10 steps\*\*\. The oracle suggests splitting it into \*\*3 tasks\*\*/);
  assert.match(question.question, /Part 1 must go first/);
  assert.match(question.question, /Type what to change \(for example \*merge 2 and 3\*\)/);
  assert.deepEqual(question.options.map((option) => option.label), ["Split into 3 tasks (Recommended)", "Keep it as one task"]);
  assert.match(question.options[0]!.preview!, /\*\*1\. Theme foundation\*\* · steps 1-3\n_tokens, a store and persistence\._\n- 1\. Define colour tokens/);
  assert.match(question.options[0]!.preview!, /\*\*3\. Style and verify\*\* · steps 6-10 · after 1-2/);
  assert.match(splitQuestion({ stepCount: 10, proposal, steps: STEPS, revisions: MAX_SPLIT_REVISIONS }).question, /This is the last revision: take it, or keep the plan whole\./);
  assert.match(splitPreview(proposal, STEPS), /- 10\. Update the docs/);
  assert.equal(splitFailedQuestion("no key").options[0]!.label, "Save it as one task");
});

/* ---------------------------------------------------------- the save flow */

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 100, output: 40, cost: { total: 0.02 } } } });
}

/** A session with a finished plan, an oracle that answers from `answers` in turn, and a user who answers from `choices`. */
function saving(options: { plan?: string; answers?: string[]; choices?: Array<(question: AskQuestion) => AskResult> } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bl-split-"));
  const prompts: string[] = [];
  const answers = [...(options.answers ?? [SPLIT])];
  const runner: ProcessRunner = async (_args, run) => {
    prompts.push(run.prompt ?? "");
    const text = answers.length > 1 ? answers.shift()! : answers[0]!;
    return { exitCode: 0, stdout: reply(text), stderr: "", killed: false, timedOut: false };
  };
  const feed = new LobbyFeed();
  const session = new PlanningSession({ cwd: root, root, configDir: ".pi", panel: [], profile: () => ({ model: "p/oracle", thinking: "high", timeoutMs: 60_000 }), runProcess: runner, feed });
  session.reply = { status: "ready", questions: [], title: "Dark mode toggle", plan: options.plan ?? PLAN };
  const asked: AskQuestion[][] = [];
  const choices = [...(options.choices ?? [])];
  const ask = async (questions: AskQuestion[]): Promise<AskResult> => {
    asked.push(questions);
    const choose = choices.shift();
    return choose ? choose(questions[0]!) : { answers: [], cancelled: true };
  };
  return { session, root, prompts, asked, ask, feed };
}

const pick = (label: string) => (question: AskQuestion): AskResult => ({ cancelled: false, answers: [{ questionIndex: 0, question: question.question, kind: "option", answer: label }] });
const write = (words: string) => (question: AskQuestion): AskResult => ({ cancelled: false, answers: [{ questionIndex: 0, question: question.question, kind: "custom", answer: words }] });
const SPLIT_3 = "Split into 3 tasks (Recommended)";

test("a plan with few steps is saved as one task at once: no oracle run, no question", async () => {
  const { session, prompts, asked, ask } = saving({ plan: "### Steps\n1. a\n2. b\n3. c" });
  const notice = await session.saveWithSplit(ask, { splitAbove: 8 });
  assert.match(notice, /^saved PLAN-dark-mode-toggle to the pending tasks — start it from the Tasks tab$/);
  assert.deepEqual([prompts.length, asked.length, session.savedParts.length], [0, 0, 0]);
  const exactlyAt = saving({ plan: `### Steps\n${STEPS.slice(0, 8).map((step, index) => `${index + 1}. ${step}`).join("\n")}` });
  assert.match(await exactlyAt.session.saveWithSplit(exactlyAt.ask, { splitAbove: 8 }), /^saved PLAN-/, "eight steps are not more than eight");
  const off = saving();
  assert.match(await off.session.saveWithSplit(off.ask, { splitAbove: 0 }), /^saved PLAN-/, "0 turns splitting off");
  assert.equal(off.prompts.length, 0);
});

test("a long plan is split into tasks the user accepts: saved in order, each knowing the others", async () => {
  const { session, root, prompts, asked, ask, feed } = saving({ choices: [pick(SPLIT_3)] });
  const notice = await session.saveWithSplit(ask, { splitAbove: 8 });
  assert.match(notice, /^split into 3 tasks — PLAN-theme-foundation, PLAN-toggle-and-header, PLAN-style-and-verify; start them from the Tasks tab, in order$/);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /Split this plan into 2 to 5 tasks: Dark mode toggle/);
  assert.equal(asked.length, 1, "one question to the user");
  const saved = listPlannedTasks(root, ".pi");
  assert.deepEqual(saved.map((plan) => plan.id), ["PLAN-theme-foundation", "PLAN-toggle-and-header", "PLAN-style-and-verify"], "the pending list reads in part order");
  assert.deepEqual(saved.map((plan) => [plan.split?.part, plan.split?.of, plan.split?.after]), [[1, 3, []], [2, 3, [1]], [3, 3, [1, 2]]]);
  assert.equal(new Set(saved.map((plan) => plan.split?.group)).size, 1, "one group");
  assert.deepEqual(saved[0]!.split!.titles, ["Theme foundation", "Toggle and header", "Style and verify"]);
  assert.match(saved[1]!.brief, /^### Part 2 of 3 — Toggle and header/);
  assert.doesNotMatch(saved[1]!.brief, /Define colour tokens/);
  assert.equal(session.saved?.id, "PLAN-theme-foundation");
  assert.equal(session.savedParts.length, 3);
  assert.equal(session.busy, false);
  assert.ok(feed.activity.some((entry) => /split the plan into 3 tasks: PLAN-theme-foundation/.test(entry.text)));
  const metrics = readMetrics(root, ".pi");
  assert.deepEqual([metrics.length, metrics[0]!.kind, metrics[0]!.agent, metrics[0]!.model], [1, "planner", "ORACLE", "p/served"], "the oracle's run is on the record");
  // A started part's request says where it sits.
  assert.match(plannedTaskRequest(saved[1]!), /^Toggle and header\n\nThis is part 2 of 3 of one plan that was split into separate tasks: 1\. Theme foundation; 2\. Toggle and header \(this task\); 3\. Style and verify\. It builds on part 1, which should be done first\. Do only this part; the others are their own tasks\.\n\nAgreed plan/);
});

test("the user can keep the plan whole", async () => {
  const { session, root, ask } = saving({ choices: [pick("Keep it as one task")] });
  assert.match(await session.saveWithSplit(ask, { splitAbove: 8 }), /^saved PLAN-dark-mode-toggle to the pending tasks/);
  assert.equal(listPlannedTasks(root, ".pi").length, 1);
  assert.equal(listPlannedTasks(root, ".pi")[0]!.split, undefined);
  assert.deepEqual(session.savedParts, []);
});

test("what the user writes in their own words revises the split before anything is saved", async () => {
  const merged = SPLIT.replace(/### 2\.[\s\S]*?### 3\. Style and verify\nGoal: every screen follows the theme\.\nCovers: 6-10\nAfter: 1, 2/, "### 2. Toggle and screens\nGoal: users switch themes.\nCovers: 4-10\nAfter: 1");
  assert.equal(parseSplit(merged).tasks.length, 2);
  const { session, root, prompts, asked, ask } = saving({ answers: [SPLIT, merged], choices: [write("merge 2 and 3"), pick("Split into 2 tasks (Recommended)")] });
  const notice = await session.saveWithSplit(ask, { splitAbove: 8 });
  assert.match(notice, /^split into 2 tasks — PLAN-theme-foundation, PLAN-toggle-and-screens/);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /## The split so far\n\n## Tasks\n### 1\. Theme foundation[\s\S]*## What the user wants changed\n\nmerge 2 and 3/);
  assert.equal(asked.length, 2, "asked again with the revised split");
  assert.match(asked[1]![0]!.question, /into \*\*2 tasks\*\*/);
  assert.equal(listPlannedTasks(root, ".pi").length, 2);
});

test("the user may revise a few times, then it is take it or keep it whole", async () => {
  const { session, root, asked, ask } = saving({ choices: [write("a"), write("b"), write("c"), write("d")] });
  const notice = await session.saveWithSplit(ask, { splitAbove: 8 });
  assert.match(notice, /that was the last revision, and nothing was saved/);
  assert.equal(asked.length, MAX_SPLIT_REVISIONS + 1);
  assert.match(asked.at(-1)![0]!.question, /This is the last revision/);
  assert.deepEqual(listPlannedTasks(root, ".pi"), []);
});

test("a split that breaks a rule is sent back once, and the user only ever sees a sound one", async () => {
  const dropsStep = SPLIT.replace("Covers: 6-10", "Covers: 6-9");
  const { session, prompts, asked, ask, root } = saving({ answers: [dropsStep, SPLIT], choices: [pick(SPLIT_3)] });
  assert.match(await session.saveWithSplit(ask, { splitAbove: 8 }), /^split into 3 tasks/);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /## Your last split was rejected\n\n- step 10 is in no task: every step belongs to exactly one/);
  assert.equal(asked.length, 1);
  assert.equal(listPlannedTasks(root, ".pi").length, 3);
  assert.equal(readMetrics(root, ".pi").length, 2, "both runs are on the record");
});

test("when the oracle cannot produce a sound split the user is asked whether to save the plan whole; nothing is decided for them", async () => {
  const bad = "I would keep it whole.";
  const yes = saving({ answers: [bad], choices: [pick("Save it as one task")] });
  assert.match(await yes.session.saveWithSplit(yes.ask, { splitAbove: 8 }), /^saved PLAN-dark-mode-toggle to the pending tasks/);
  assert.match(yes.asked[0]![0]!.question, /The oracle could not split this plan \(no tasks found/);
  assert.equal(yes.prompts.length, 2, "it tried twice");
  const no = saving({ answers: [bad], choices: [pick("Not now")] });
  assert.equal(await no.session.saveWithSplit(no.ask, { splitAbove: 8 }), "the plan was not saved — ctrl+s tries again");
  assert.deepEqual(listPlannedTasks(no.root, ".pi"), []);
  const left = saving({ answers: [bad] });
  assert.match(await left.session.saveWithSplit(left.ask, { splitAbove: 8 }), /^the plan was not saved/);
  const crash = saving();
  const failing = new PlanningSession({ cwd: crash.root, root: crash.root, configDir: ".pi", panel: [], profile: () => ({ thinking: "high", timeoutMs: 1000 }), runProcess: async () => ({ exitCode: 1, stdout: "", stderr: "boom", killed: false, timedOut: false }) });
  failing.reply = { status: "ready", questions: [], plan: PLAN };
  const notice = await failing.saveWithSplit(async () => ({ answers: [], cancelled: true }), { splitAbove: 8 });
  assert.match(notice, /^the plan was not saved/, "a failed run asks, and a question left open saves nothing");
});

test("a split question the user puts away saves nothing, and stopping while it is open ends cleanly", async () => {
  const away = saving({ choices: [() => ({ answers: [], cancelled: true })] });
  assert.equal(await away.session.saveWithSplit(away.ask, { splitAbove: 8 }), "the split question was left open, so nothing was saved — ctrl+s asks again");
  assert.deepEqual(listPlannedTasks(away.root, ".pi"), []);
  assert.equal(away.session.busy, false);
  const stopped = saving();
  let release: (() => void) | undefined;
  const slow = async (): Promise<AskResult> => new Promise((resolve) => {
    release = () => resolve({ answers: [], cancelled: true });
  });
  const running = stopped.session.saveWithSplit(slow, { splitAbove: 8 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stopped.session.busy, true, "the oracle is working on it: the panel is busy");
  stopped.session.cancel();
  release?.();
  assert.equal(await running, "stopped — nothing was saved");
  assert.equal(stopped.session.busy, false);
  assert.deepEqual(listPlannedTasks(stopped.root, ".pi"), []);
});

test("a long plan is not split while the panel is still working, but a short one saves", async () => {
  const busy = saving();
  (busy.session as unknown as { status: string }).status = "thinking";
  assert.match(await busy.session.saveWithSplit(busy.ask, { splitAbove: 8 }), /^the panel is still working — save again once it is done/);
  const short = saving({ plan: "### Steps\n1. a\n2. b" });
  (short.session as unknown as { status: string }).status = "thinking";
  assert.match(await short.session.saveWithSplit(short.ask, { splitAbove: 8 }), /^saved PLAN-/, "saving what is on the page never waited");
  const none = saving();
  none.session.reply = undefined;
  await assert.rejects(none.session.saveWithSplit(none.ask, { splitAbove: 8 }), /no draft plan/);
});

test("a plan saved from an issue keeps the issue on every part", async () => {
  const { session, root, ask } = saving({ choices: [pick(SPLIT_3)] });
  (session as unknown as { seed: unknown }).seed = { issue: { number: 7, title: "Dark mode", url: "https://gh/7" }, body: "please" };
  await session.saveWithSplit(ask, { splitAbove: 8 });
  assert.deepEqual(listPlannedTasks(root, ".pi").map((plan) => plan.issue?.number), [7, 7, 7]);
});

/* ------------------------------------------------- order and settings */

test("starting a part before the parts it builds on names what is unfinished, and never blocks", () => {
  const root = mkdtempSync(join(tmpdir(), "bl-order-"));
  ensureProjectStructure(root, ".pi");
  const split = (part: number, after: number[]) => ({ group: "G", part, of: 3, titles: ["Foundation", "Toggle", "Styling"], after });
  const one = savePlannedTask(root, ".pi", { title: "Foundation", brief: "b", split: split(1, []) });
  const two = savePlannedTask(root, ".pi", { title: "Toggle", brief: "b", split: split(2, [1]) });
  const three = savePlannedTask(root, ".pi", { title: "Styling", brief: "b", split: split(3, [1, 2]) });
  const other = savePlannedTask(root, ".pi", { title: "Unrelated", brief: "b" });
  assert.deepEqual(unfinishedBefore(root, ".pi", one), []);
  assert.deepEqual(unfinishedBefore(root, ".pi", other), []);
  assert.deepEqual(unfinishedBefore(root, ".pi", three), ["part 1 (Foundation) has not been started", "part 2 (Toggle) has not been started"]);
  // Part 1 is started: its task is under way, then completed, then (in another run) abandoned.
  const task = createTask("Task-Foundation-27-09-2026", "Foundation");
  createTaskDir(root, ".pi", task);
  task.state = "implementing";
  saveTask(root, ".pi", task);
  markPlannedTaskStarted(root, ".pi", one.id, task.id);
  assert.deepEqual(unfinishedBefore(root, ".pi", two), ["part 1 (Foundation) is not finished"]);
  task.state = "completed";
  saveTask(root, ".pi", task);
  assert.deepEqual(unfinishedBefore(root, ".pi", two), []);
  task.state = "abandoned";
  saveTask(root, ".pi", task);
  assert.deepEqual(unfinishedBefore(root, ".pi", two), ["part 1 (Foundation) is abandoned"]);
  assert.deepEqual(unfinishedBefore(root, ".pi", three), ["part 1 (Foundation) is abandoned", "part 2 (Toggle) has not been started"]);
});

test("plans over eight steps are offered a split by default; the setting rejects nonsense", () => {
  assert.equal(DEFAULT_CONFIG.lobby.splitPlanAbove, 8);
  assert.equal(resolveConfig({ lobby: { splitPlanAbove: 12 } }).lobby.splitPlanAbove, 12);
  assert.equal(resolveConfig({ lobby: { splitPlanAbove: 0 } }).lobby.splitPlanAbove, 0);
  for (const bad of [-1, 2.5, "8", null]) assert.equal(resolveConfig({ lobby: { splitPlanAbove: bad } }).lobby.splitPlanAbove, 8);
});
