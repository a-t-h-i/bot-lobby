import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  budgetLine,
  budgetState,
  formatMinutes,
  parseMinutes,
  qaAllotment,
  readBudget,
  readerAllotment,
  resetClocks,
  setBudget,
  startClock,
  stopClocks,
  updateBudget,
  usedMs,
  whileAsking,
  workerAllotment,
  type TaskBudget,
} from "../src/state/budget.ts";
import { parseCommand } from "../src/pi/commands.ts";
import { parseMoreTime, parseWorkerResult } from "../src/roles/worker.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { setAutoMode } from "../src/state/auto.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { ProcessOutcome, ProcessRunner, ProcessRunOptions } from "../src/execution/pi-runner.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

const LENIENT = { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false } };

const MINUTE = 60_000;

test("time budgets read the way people write them", () => {
  assert.equal(parseMinutes("90"), 90);
  assert.equal(parseMinutes("90m"), 90);
  assert.equal(parseMinutes("90 min"), 90);
  assert.equal(parseMinutes("1h"), 60);
  assert.equal(parseMinutes("1.5h"), 90);
  assert.equal(parseMinutes("1h30"), 90);
  assert.equal(parseMinutes("1h30m"), 90);
  assert.equal(parseMinutes("2 hours"), 120);
  for (const bad of ["", "soon", "0", "-5m", "25h", "90s"]) assert.equal(parseMinutes(bad), undefined, bad);
  assert.equal(formatMinutes(34 * MINUTE), "34m");
  assert.equal(formatMinutes(65 * MINUTE), "1h 05m");
});

function budget(minutes: number, used: number, granted = 0): TaskBudget {
  return { minutes, granted, usedMs: used * MINUTE, allotments: [] };
}

test("the budget is divided by scope, keeping the QA gate's reserve until it passes", () => {
  const state = budgetState("T", budget(90, 20), false);
  assert.deepEqual([state.totalMs, state.leftMs, state.reserveMs, state.windowMs], [90 * MINUTE, 70 * MINUTE, 13.5 * MINUTE, 56.5 * MINUTE]);
  assert.equal(workerAllotment(state, undefined, 2)!.ms, 28.25 * MINUTE, "an even share across the domains still to build");
  assert.equal(workerAllotment(state, 40, 2)!.ms, 40 * MINUTE, "the oracle's minutes, by scope");
  const greedy = workerAllotment(state, 80, 1)!;
  assert.equal(greedy.ms, 56.5 * MINUTE, "never past the reserve");
  assert.match(greedy.note!, /asked for 1h 20m, but only 57m are left before the QA gate's reserve/);
  assert.equal(workerAllotment(budgetState("T", budget(90, 80), false), 5, 1), undefined, "no room: nothing starts");
  assert.equal(budgetState("T", budget(90, 20), true).reserveMs, 0, "a passed gate needs no reserve");
  assert.equal(readerAllotment(state, 0.1, 8 * MINUTE), 7 * MINUTE);
  assert.equal(readerAllotment(state, 0.1, 5 * MINUTE), 5 * MINUTE, "within the configured limit");
  assert.equal(qaAllotment(state, 15 * MINUTE), 15 * MINUTE);
  assert.equal(qaAllotment(budgetState("T", budget(90, 80), false), 15 * MINUTE), 10 * MINUTE, "never more than is left");
  assert.equal(budgetLine(budget(90, 34, 15), budgetState("T", budget(90, 34, 15), false)), "Time budget: 90m (+15m granted) · 34m used · 1h 11m left (16m kept for the QA gate).");
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "bl-budget-"));
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("the clock runs while the oracle works and waits while the user is asked", async () => {
  resetClocks();
  const root = tempRoot();
  startClock(root, ".pi", "T");
  assert.equal(readBudget(root, ".pi", "T"), undefined, "no budget, no clock");
  setBudget(root, ".pi", "T", 90);
  startClock(root, ".pi", "T");
  await wait(120);
  await whileAsking(() => wait(300));
  await wait(120);
  stopClocks();
  const spent = readBudget(root, ".pi", "T")!.usedMs;
  assert.ok(spent >= 200 && spent < 450, `counted ${spent}ms: the 300ms dialog is left out`);
  await wait(100);
  assert.equal(usedMs("T", readBudget(root, ".pi", "T")!), spent, "between turns nothing counts");
  setBudget(root, ".pi", "T", 120);
  assert.deepEqual([readBudget(root, ".pi", "T")!.minutes, readBudget(root, ".pi", "T")!.usedMs], [120, spent], "a new budget keeps the time spent");
  setBudget(root, ".pi", "T", 0);
  assert.equal(readBudget(root, ".pi", "T"), undefined);
  resetClocks();
});

test("--budget starts a task with a time budget, and budget shows or sets it", () => {
  assert.deepEqual(parseCommand("--budget 90m add a login page"), { sub: undefined, rest: [], restText: "add a login page", budget: 90 });
  assert.deepEqual(parseCommand("--budget=1h30m --auto amend the flow"), { sub: undefined, rest: [], restText: "amend the flow", budget: 90, auto: true });
  assert.deepEqual(parseCommand("--auto add dark mode"), { sub: undefined, rest: [], restText: "add dark mode", auto: true });
  assert.match(parseCommand("--budget soon add it").budgetError!, /"soon" is not a time budget/);
  assert.deepEqual(parseCommand("budget 90m"), { sub: "budget", rest: ["90m"], restText: "90m" });
  assert.deepEqual(parseCommand("budget 1h 30m"), { sub: "budget", rest: ["1h", "30m"], restText: "1h 30m" });
  assert.equal(parseCommand("budget off").sub, "budget");
  assert.equal(parseCommand("budget").sub, "budget");
  assert.equal(parseCommand("budget the pricing page").sub, undefined, "free text is a request");
});

test("a worker out of time says where it left off and how much more it needs", () => {
  assert.deepEqual(parseMoreTime("10 minutes — the tests"), { minutes: 10, reason: "the tests" });
  assert.deepEqual(parseMoreTime("About 1h: the migration is big"), { minutes: 60, reason: "the migration is big" });
  assert.deepEqual(parseMoreTime("- 20m to finish the form states"), { minutes: 20, reason: "finish the form states" });
  assert.deepEqual(parseMoreTime("a little longer"), { reason: "a little longer" });
  const result = parseWorkerResult("backend", "## Completed\nthe API\n\n## Left Off\ntests remain\n\n## More Time\n10 minutes — the tests");
  assert.deepEqual([result.leftOff, result.moreTime], ["tests remain", { minutes: 10, reason: "the tests" }]);
  assert.equal(parseWorkerResult("backend", "## Completed\nall of it").leftOff, undefined);
});

/* ------------------------------------------------------------ the workflow */

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning"];
const PLAN = "## Objective\nAdd a.\n## Domains\nbackend, designer\n## Files\nsrc/a.ts\n## Sequence\n1\n## Dependencies\nnone\n## Testing\nunit\n## Acceptance Criteria\nworks\n## Rollback\nrevert\n## Review\npeer";
const LEFT_OFF = "## Completed\nthe endpoint\n\n## Files Changed\n- `src/a.ts` — endpoint\n\n## Verification\n- `npm test` — passing\n\n## Left Off\ntests remain\n\n## More Time\n10 minutes — the tests";
const DONE = "## Completed\nthe endpoint and its tests\n\n## Files Changed\n- `src/a.ts` — endpoint\n\n## Verification\n- `npm test` — passing";

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

interface Seen {
  prompts: string[];
  times: Array<ProcessRunOptions["time"]>;
}

/** A fake pi: under a budget it runs out of time, and asks the host's `onTimeUp` as the real one does. */
function outOfTime(seen: Seen): ProcessRunner {
  return async (args, options) => {
    seen.prompts.push(readFileSync(args[args.indexOf("--append-system-prompt") + 1]!, "utf8"));
    seen.times.push(options.time);
    const done = (text: string, extra: Partial<ProcessOutcome> = {}): ProcessOutcome => ({ exitCode: 0, stdout: reply(text), stderr: "", killed: false, timedOut: false, ...extra });
    if (!options.time?.onTimeUp) return done(DONE);
    const { extraMs } = await options.time.onTimeUp(LEFT_OFF);
    return extraMs > 0 ? done(DONE, { extendedMs: extraMs }) : done(LEFT_OFF, { timeUp: true });
  };
}

function budgeted(options: { minutes?: number; used?: number; choose?: WorkflowDeps["choose"]; ask?: WorkflowDeps["ask"]; until?: TaskState } = {}) {
  const root = tempRoot();
  const seen: Seen = { prompts: [], times: [] };
  const titles: string[] = [];
  const deps: WorkflowDeps = {
    root, configDir: ".pi", cwd: root, config: LENIENT,
    ask: options.ask ?? (async () => undefined),
    choose: async (title, choices) => (titles.push(title), options.choose ? options.choose(title, choices) : undefined),
    notify: () => {},
    runProcess: outOfTime(seen),
  };
  ensureProjectStructure(root, ".pi");
  const task: Task = createTask("TASK-1", "Add a");
  createTaskDir(root, ".pi", task);
  for (const state of FLOW) {
    transition(task, state);
    if (state === options.until) break;
  }
  task.domains = ["backend", "designer"];
  task.plan = PLAN;
  saveTask(root, ".pi", task);
  setBudget(root, ".pi", task.id, options.minutes ?? 90);
  if (options.used) updateBudget(root, ".pi", task.id, (entry) => { entry.usedMs = options.used! * MINUTE; });
  const act = (params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
  return { root, deps, seen, titles, act };
}

const pick = (prefix: string) => async (_title: string, choices: string[]) => choices.find((choice) => choice.startsWith(prefix));

test("each step gets the minutes the oracle gave it, and the worker is told them", async () => {
  const { root, seen, act } = budgeted({ choose: pick("Give it") });
  const result = await act({ action: "implement", domain: "backend", task: "Add the endpoint", minutes: 30 });
  assert.equal(result.ok, true, result.message);
  assert.match(seen.prompts[0]!, /## Time\nYou have 30m for this step; the task has 1h 30m of its 1h 30m left\./);
  assert.equal(seen.times[0]!.upAtMs > 29 * MINUTE && seen.times[0]!.upAtMs <= 30 * MINUTE, true);
  assert.match(result.message, /Time budget: 90m \(\+0m|Time budget: 90m ·/);
  const allotted = readBudget(root, ".pi", "TASK-1")!.allotments[0]!;
  assert.deepEqual([allotted.who, allotted.minutes, allotted.granted, allotted.outcome], ["DEV", 40, 10, "finished"], "30 given, 10 more granted");
});

test("out of time, the user is told what the agent did and what is left, and the same agent finishes with more", async () => {
  const { root, titles, act } = budgeted({ used: 70, choose: pick("Give it") });
  const result = await act({ action: "implement", domain: "backend", task: "Add the endpoint", minutes: 5 });
  assert.equal(result.ok, true, result.message);
  assert.match(titles[0]!, /^DEV is out of time: it had 5m for "Add the endpoint"\.\n\nDone so far: the endpoint\n\nLeft to do: tests remain\n\nIt needs about 10 more minutes: the tests\.\n\nThe task has used 1h 10m of 1h 30m \(20m left\); 10 more minutes adds \d+ to its budget\.\n\nGive DEV 10 more minutes to finish\?$/);
  assert.match(result.message, /DEV ran out of its 5m and was given 10m more\./);
  const task = loadTask(root, ".pi", "TASK-1")!;
  assert.ok(task.decisions.some((decision) => /DEV ran out of time; the user gave it 10 more minutes, \d+ of them added to the task's budget\. Left off: tests remain/.test(decision.text)));
  assert.ok(readBudget(root, ".pi", "TASK-1")!.granted > 0, "a grant past the QA reserve grows the budget");
});

test("not given more, the step comes back unfinished with where it left off", async () => {
  const { act } = budgeted({ choose: pick("Stop") });
  const result = await act({ action: "implement", domain: "backend", task: "Add the endpoint" });
  assert.match(result.message, /DEV ran out of its time and was not given more: this step is unfinished\.\nLeft off: tests remain\nIt asked for 10 minutes: the tests\.\nDecide with the user/);
});

test("a different amount can be given", async () => {
  const { root, act } = budgeted({ choose: pick("Give a different"), ask: async () => "25m" });
  await act({ action: "implement", domain: "backend", task: "Add the endpoint", minutes: 20 });
  assert.equal(readBudget(root, ".pi", "TASK-1")!.allotments[0]!.granted, 25);
});

test("auto mode gives more once, and only from time the task still has", async () => {
  const { root, titles, act } = budgeted();
  setAutoMode(root, ".pi", "TASK-1", true);
  const result = await act({ action: "implement", domain: "backend", task: "Add the endpoint", minutes: 20 });
  assert.match(result.message, /was given 10m more/);
  assert.equal(titles.length, 0, "nobody is asked");
  assert.equal(readBudget(root, ".pi", "TASK-1")!.granted, 0, "auto mode never grows the budget");
  const tight = budgeted({ used: 70 });
  setAutoMode(tight.root, ".pi", "TASK-1", true);
  assert.match((await tight.act({ action: "implement", domain: "backend", task: "Add the endpoint", minutes: 5 })).message, /was not given more/);
});

test("a spent budget starts no new work; the oracle asks the user for more with action=budget", async () => {
  const { root, titles, act } = budgeted({ used: 80, choose: pick("Give 20") });
  const refused = await act({ action: "implement", domain: "backend", task: "Add the endpoint" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /the task's time budget has no room for the backend step: 1h 20m of 1h 30m used, 10m left, 10m of it kept for the QA gate\. Ask the user for more time with action=budget/);
  assert.match((await act({ action: "budget", minutes: 20 })).message, /Rejected: budget requires reason/);
  const granted = await act({ action: "budget", minutes: 20, reason: "the form states are left" });
  assert.match(titles[0]!, /The oracle asks for 20 more minutes on TASK-1: the form states are left/);
  assert.match(granted.message, /The user gave the task 20 more minutes\.[\s\S]*Time budget: 90m \(\+20m granted\)/);
  assert.equal((await act({ action: "implement", domain: "backend", task: "Add the endpoint" })).ok, true, "with the time, work starts again");
  const report = await act({ action: "budget" });
  assert.match(report.message, /Allotted so far:\n- DEV: \d+m/);
});

test("the QA gate and the scouts are given their share and told it", async () => {
  const scouting = budgeted({ until: "clarifying" });
  await scouting.act({ action: "scout", domains: ["backend"], instruction: "find the routes" });
  assert.match(scouting.seen.prompts[0]!, /## Time\nYou have 8m for this work; the task has 1h 30m of its 1h 30m left\.\nWhen the time is up you are asked to stop and report what you have/);
  assert.equal(scouting.seen.times[0]!.onTimeUp, undefined);
  const { seen, act } = budgeted();
  await act({ action: "implement", domain: "backend", task: "Add the endpoint", minutes: 20 });
  await act({ action: "qa" });
  const reviewer = seen.prompts.at(-1)!;
  assert.match(reviewer, /## Time\nYou have 15m for this work/);
  assert.equal(seen.times.at(-1)!.onTimeUp, undefined, "the gate reports what it has; it is not extended");
});

test("a task without a budget runs exactly as before", async () => {
  const root = tempRoot();
  const seen: Seen = { prompts: [], times: [] };
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-1", "Add a");
  createTaskDir(root, ".pi", task);
  for (const state of FLOW) transition(task, state);
  task.domains = ["backend"];
  task.plan = PLAN;
  saveTask(root, ".pi", task);
  const deps: WorkflowDeps = { root, configDir: ".pi", cwd: root, config: LENIENT, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess: outOfTime(seen) };
  const result = await runWorkflowAction({ action: "implement", taskId: "TASK-1", domain: "backend", task: "Add it" } as OrchestrateParams, deps);
  assert.equal(result.ok, true, result.message);
  assert.equal(seen.times[0], undefined);
  assert.doesNotMatch(seen.prompts[0]!, /## Time\nYou have/);
  assert.doesNotMatch(result.message, /Time budget/);
});

test("a report that finished as its time ran out is a finished step, not an unfinished one", async () => {
  const { root, deps, titles, act } = budgeted({ choose: pick("Give it") });
  deps.runProcess = async (_args, options) => {
    const { extraMs } = await options.time!.onTimeUp!(DONE);
    assert.equal(extraMs, 0, "nothing left to do: nobody is asked");
    return { exitCode: 0, stdout: reply(DONE), stderr: "", killed: false, timedOut: false, timeUp: true };
  };
  const result = await act({ action: "implement", domain: "backend", task: "Add the endpoint", minutes: 10 });
  assert.equal(titles.length, 0);
  assert.doesNotMatch(result.message, /unfinished/);
  assert.equal(readBudget(root, ".pi", "TASK-1")!.allotments[0]!.outcome, "finished");
});

test("a step whose call failed does not stay running in the budget", async () => {
  const { root, deps, act } = budgeted();
  deps.runProcess = async () => { throw new Error("pi is gone"); };
  const result = await act({ action: "implement", domain: "backend", task: "Add the endpoint", minutes: 10 });
  assert.equal(result.ok, false);
  const [entry] = readBudget(root, ".pi", "TASK-1")!.allotments;
  assert.equal(entry!.outcome, "stopped");
});
