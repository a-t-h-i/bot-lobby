import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import {
  addPlanComment,
  commentMessage,
  commentsPath,
  editComment,
  markCommentsAddressed,
  markCommentsDelivered,
  pendingComments,
  readPlanComments,
  undeliveredComments,
} from "../src/state/comments.ts";
import { discardPlannedTask, listPlannedTasks, markPlannedTaskStarted, plannedTaskRequest, savePlannedTask } from "../src/state/backlog.ts";
import {
  aggregateMetrics,
  appendMetrics,
  collectMetrics,
  metricFromRun,
  metricsPath,
  readMetrics,
  sortGroups,
  taskStats,
  taskTimesByModel,
  type MetricRecord,
} from "../src/state/metrics.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import { masterTaskContext } from "../src/pi/events.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "bl-lobby-state-"));
}

const PLAN = [
  "## Objective", "Add pagination.", "## Domains", "backend",
  "## Files", "src/api/users.ts", "## Steps", "1. add query params", "2. add tests",
  "## Dependencies", "none", "## Testing", "unit tests",
  "## Acceptance Criteria", "page size respected", "## Rollback", "revert the commit",
  "## Review", "QA gate",
].join("\n");

const TO_IMPLEMENTING: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing"];

function deps(root: string): WorkflowDeps {
  return { root, configDir: ".pi", cwd: root, config: DEFAULT_CONFIG, ask: async () => undefined, choose: async () => undefined, notify: () => {} };
}

function taskIn(root: string, path: TaskState[], plan?: string): Task {
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-1", "Add pagination");
  createTaskDir(root, ".pi", task);
  for (const step of path) transition(task, step);
  if (plan) task.plan = plan;
  saveTask(root, ".pi", task);
  return task;
}

test("plan comments fold from an append-only log: open, delivered, addressed", () => {
  const root = tempRoot();
  const first = addPlanComment(root, ".pi", "TASK-1", "  Use cursor pagination  ", "session-a");
  const second = addPlanComment(root, ".pi", "TASK-1", "Keep the old endpoint");
  assert.equal(first.text, "Use cursor pagination");
  let comments = readPlanComments(root, ".pi", "TASK-1");
  assert.deepEqual(comments.map((c) => c.status), ["open", "open"]);
  assert.equal(comments[0]!.by, "session-a");
  markCommentsDelivered(root, ".pi", "TASK-1", [first.id]);
  comments = readPlanComments(root, ".pi", "TASK-1");
  assert.deepEqual(undeliveredComments(comments).map((c) => c.id), [second.id]);
  assert.equal(pendingComments(comments).length, 2);
  assert.throws(() => addPlanComment(root, ".pi", "TASK-1", "   "), /needs some text/);
});

test("an edit replaces the text, reopens the comment and keeps it where it was", () => {
  const root = tempRoot();
  const original = addPlanComment(root, ".pi", "TASK-1", "Use cursor pagination", "session-a");
  markCommentsDelivered(root, ".pi", "TASK-1", [original.id]);
  const edited = editComment(root, ".pi", "TASK-1", original.id, "  Use keyset pagination  ", new Date(1_000));
  assert.equal(edited.text, "Use keyset pagination");
  assert.equal(edited.status, "open");
  assert.equal(edited.createdAt, original.createdAt, "an edit does not rewrite history");
  assert.equal(edited.by, "session-a");
  assert.equal(edited.editedAt, new Date(1_000).toISOString());
  assert.equal(edited.deliveredAt, undefined);
  assert.equal(readPlanComments(root, ".pi", "TASK-1")[0]?.editedAt, edited.editedAt);
  assert.equal(readPlanComments(root, ".pi", "TASK-1").length, 1);
});

test("an edit after the Master addressed a comment reopens it", () => {
  const root = tempRoot();
  const original = addPlanComment(root, ".pi", "TASK-1", "Cap the page size", "session-a");
  markCommentsAddressed(root, ".pi", "TASK-1", [original.id]);
  const edited = editComment(root, ".pi", "TASK-1", original.id, "Cap the page size at 100");
  assert.equal(edited.status, "open");
  assert.equal(edited.addressedAt, undefined);
  assert.deepEqual(undeliveredComments(readPlanComments(root, ".pi", "TASK-1")).map((c) => c.id), [original.id]);
});

test("an edit for an unknown id never appends, and an empty one is refused", () => {
  const root = tempRoot();
  assert.throws(() => editComment(root, ".pi", "TASK-1", "C-nope", "anything"), /no comment C-nope/);
  assert.deepEqual(readPlanComments(root, ".pi", "TASK-1"), []);
  assert.equal(existsSync(commentsPath(root, ".pi", "TASK-1")), false);
  assert.throws(() => editComment(root, ".pi", "TASK-1", "C-nope", "   "), /needs some text/);
});

test("a torn comment line is skipped instead of breaking the log", () => {
  const root = tempRoot();
  addPlanComment(root, ".pi", "TASK-1", "first");
  appendFileSync(commentsPath(root, ".pi", "TASK-1"), '{"kind":"comment","id":"C-bro');
  appendFileSync(commentsPath(root, ".pi", "TASK-1"), "\n");
  addPlanComment(root, ".pi", "TASK-1", "second");
  assert.deepEqual(readPlanComments(root, ".pi", "TASK-1").map((c) => c.text), ["first", "second"]);
});

test("the comment message asks for an amended plan, or a new proposal before planning", () => {
  const comments = [{ id: "C-1", taskId: "TASK-1", text: "Use cursor\npagination", createdAt: "", status: "open" as const }];
  const withPlan = commentMessage("TASK-1", comments, true);
  assert.match(withPlan, /a comment on the approved plan of TASK-1/);
  assert.match(withPlan, /- Use cursor pagination/);
  assert.match(withPlan, /action=plan with the full revised plan/);
  assert.match(commentMessage("TASK-1", comments, false), /action=propose again/);
});

test("the Master's task context lists open plan comments and drops addressed ones", () => {
  const task = createTask("TASK-1", "Add pagination");
  const context = masterTaskContext(task, [
    { id: "a", taskId: "TASK-1", text: "Cap page size at 100", createdAt: "", status: "delivered" },
    { id: "b", taskId: "TASK-1", text: "old note", createdAt: "", status: "addressed" },
  ]);
  assert.match(context, /Open plan comments \(from the lobby\):\n- Cap page size at 100/);
  assert.doesNotMatch(context, /old note/);
  assert.doesNotMatch(masterTaskContext(task), /Open plan comments/);
});

test("action=plan amends an approved plan while implementing and addresses comments", async () => {
  const root = tempRoot();
  taskIn(root, TO_IMPLEMENTING, PLAN);
  addPlanComment(root, ".pi", "TASK-1", "Add a third step for docs");
  const revised = PLAN.replace("2. add tests", "2. add tests\n3. document the params");
  const result = await runWorkflowAction({ action: "plan", taskId: "TASK-1", plan: revised } as OrchestrateParams, deps(root));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "implementing");
  assert.match(result.message, /Plan amended\. 1 lobby comment marked addressed/);
  const task = loadTask(root, ".pi", "TASK-1")!;
  assert.equal(task.plan, revised);
  assert.match(task.decisions.at(-1)!.text, /Plan amended for 1 user comment/);
  assert.deepEqual(readPlanComments(root, ".pi", "TASK-1").map((c) => c.status), ["addressed"]);
});

test("action=plan is still refused before approval", async () => {
  const root = tempRoot();
  taskIn(root, ["clarifying"]);
  const result = await runWorkflowAction({ action: "plan", taskId: "TASK-1", plan: PLAN } as OrchestrateParams, deps(root));
  assert.equal(result.ok, false);
  assert.match(result.message, /not allowed in state "clarifying"/);
});

test("a re-proposal addresses comments left on the proposal", async () => {
  const root = tempRoot();
  taskIn(root, ["clarifying", "scouting", "synthesizing", "awaiting_approval"]);
  addPlanComment(root, ".pi", "TASK-1", "Also cover the admin list");
  const result = await runWorkflowAction({ action: "propose", taskId: "TASK-1", proposal: "- paginate users\n- paginate admins" } as OrchestrateParams, deps(root));
  assert.equal(result.ok, true, result.message);
  assert.equal(readPlanComments(root, ".pi", "TASK-1")[0]!.status, "addressed");
});

test("planned tasks save with unique ids, list pending first, and start or discard", () => {
  const root = tempRoot();
  const a = savePlannedTask(root, ".pi", { title: "Dark mode", brief: "## Steps\n1. tokens" }, new Date("2026-01-01T00:00:00Z"));
  const b = savePlannedTask(root, ".pi", { title: "Dark mode", brief: "## Steps\n1. again", issue: { number: 12, title: "Dark mode please", url: "https://x/12" } }, new Date("2026-01-02T00:00:00Z"));
  assert.equal(a.id, "PLAN-dark-mode");
  assert.equal(b.id, "PLAN-dark-mode-2");
  assert.deepEqual(listPlannedTasks(root, ".pi").map((entry) => entry.id), [b.id, a.id]);
  markPlannedTaskStarted(root, ".pi", b.id, "TASK-dark-mode", new Date("2026-01-03T00:00:00Z"));
  assert.deepEqual(listPlannedTasks(root, ".pi").map((entry) => [entry.id, entry.status]), [[a.id, "pending"], [b.id, "started"]]);
  assert.match(plannedTaskRequest(b), /^Dark mode\n\nAgreed plan \(from the planning session\):\n## Steps\n1\. again\n\nFrom GitHub issue #12: Dark mode please \(https:\/\/x\/12\)$/);
  discardPlannedTask(root, ".pi", a.id);
  assert.deepEqual(listPlannedTasks(root, ".pi").map((entry) => entry.id), [b.id]);
  assert.throws(() => savePlannedTask(root, ".pi", { title: "x", brief: "  " }), /needs a plan/);
});

function record(overrides: Partial<MetricRecord> = {}): MetricRecord {
  return { id: `r${Math.random()}`, kind: "worker", agent: "DEV", model: "p/fast", thinking: "medium", status: "success", startedAt: "2026-01-01T00:00:00.000Z", durationMs: 60_000, ...overrides };
}

test("metrics aggregate per model and thinking level, keeping cancelled runs out of timing", () => {
  const records = [
    record({ durationMs: 60_000, turns: 4, tools: 10, input: 1000, output: 600, cost: 0.1 }),
    record({ durationMs: 120_000, turns: 6, tools: 20, input: 3000, output: 1200, cost: 0.3 }),
    record({ durationMs: 5_000, status: "cancelled" }),
    record({ durationMs: 300_000, status: "timeout", stalled: true }),
    record({ model: "p/slow", thinking: "high", kind: "master", agent: "MASTER", durationMs: 30_000 }),
  ];
  const groups = aggregateMetrics(records);
  const fast = groups.find((group) => group.model === "fast")!;
  assert.equal(fast.runs, 4);
  assert.equal(fast.successes, 2);
  assert.equal(fast.timeouts, 1);
  assert.equal(fast.avgMs, 160_000);
  assert.equal(fast.p50Ms, 120_000);
  assert.equal(fast.p90Ms, 300_000);
  assert.equal(fast.avgTurns, 5);
  assert.equal(fast.avgTokens, 2900);
  assert.equal(Math.round(fast.totalCost * 100), 40);
  assert.equal(Math.round(fast.tokensPerSecond), 4);
  assert.deepEqual(sortGroups(groups, "avg").map((group) => group.model), ["slow", "fast"]);
  assert.deepEqual(sortGroups(groups, "runs").map((group) => group.model), ["fast", "slow"]);
  const merged = aggregateMetrics([record({ model: "provider/m1" }), record({ model: "m1" })]);
  assert.deepEqual(merged.map((group) => [group.model, group.runs]), [["m1", 2]], "provider/id and a bare id are the same model");
  const split = aggregateMetrics([record(), record({ kind: "scout", agent: "DEV" })], "model-kind");
  assert.equal(split.length, 2);
});

test("the metrics log is read as it grows: only appended lines are parsed, a torn one waits, a replaced log is read afresh", () => {
  const root = tempRoot();
  const record = (id: string) => ({ id, kind: "worker", agent: "DEV", status: "success", startedAt: "2026-01-01T00:00:00.000Z", durationMs: 1000 });
  appendMetrics(root, ".pi", [record("a") as never, record("b") as never]);
  assert.deepEqual(readMetrics(root, ".pi").map((entry) => entry.id), ["a", "b"]);
  const path = metricsPath(root, ".pi");
  const line = JSON.stringify(record("c"));
  appendFileSync(path, line.slice(0, 10));
  assert.deepEqual(readMetrics(root, ".pi").map((entry) => entry.id), ["a", "b"], "half a line waits");
  appendFileSync(path, `${line.slice(10)}\n{"not":"a record"}\n`);
  assert.deepEqual(readMetrics(root, ".pi").map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(readMetrics(root, ".pi", 2).map((entry) => entry.id), ["b", "c"], "the newest `limit`");
  writeFileSync(path, `${JSON.stringify(record("z"))}\n`);
  assert.deepEqual(readMetrics(root, ".pi").map((entry) => entry.id), ["z"], "a log that shrank is read again");
});

test("metrics persist as JSON lines and merge with task run logs by id", () => {
  const root = tempRoot();
  const run: AgentRun = {
    runId: "run-1", taskId: "TASK-1", domain: "backend", role: "worker", status: "success", output: "", attempts: 1,
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:30.000Z", model: "p/fast", thinking: "high", tools: 3,
    usage: { input: 10, output: 5, cost: 0.01, turns: 2 },
  };
  appendMetrics(root, ".pi", [metricFromRun(run)]);
  const logged = readMetrics(root, ".pi");
  assert.equal(logged.length, 1);
  assert.deepEqual({ agent: logged[0]!.agent, durationMs: logged[0]!.durationMs, thinking: logged[0]!.thinking, turns: logged[0]!.turns }, { agent: "DEV", durationMs: 90_000, thinking: "high", turns: 2 });
  const task = { ...createTask("TASK-1", "x"), runLog: [
    { runId: "run-1", domain: "backend" as const, role: "worker" as const, status: "success" as const, startedAt: "2026-01-01T00:00:00.000Z" },
    { runId: "run-0", domain: "qa" as const, role: "reviewer" as const, status: "failed" as const, startedAt: "2025-12-31T00:00:00.000Z", finishedAt: "2025-12-31T00:00:10.000Z" },
  ] };
  const merged = collectMetrics(logged, [task]);
  assert.deepEqual(merged.map((entry) => [entry.id, entry.agent]), [["run-0", "QA"], ["run-1", "DEV"]]);
  assert.equal(merged[1]!.thinking, "high", "the log copy wins over the run-log copy");
  assert.ok(readFileSync(join(root, ".pi", "bot-lobby", "metrics.jsonl"), "utf8").endsWith("\n"));
});

test("task stats count outcomes and average completion time", () => {
  const done = { ...createTask("A", "a", "2026-01-01T00:00:00.000Z"), state: "completed" as const, updatedAt: "2026-01-01T00:10:00.000Z" };
  const quit = { ...createTask("B", "b"), state: "abandoned" as const };
  const live = createTask("C", "c");
  assert.deepEqual(taskStats([done, quit, live]), { completed: 1, abandoned: 1, active: 1, avgCompleteMs: 600_000 });
});

test("task time groups completed tasks by the oracle model that ran most of their turns", () => {
  const done = (id: string, minutes: number) => ({ ...createTask(id, id, "2026-01-01T00:00:00.000Z"), state: "completed" as const, updatedAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + minutes * 60_000).toISOString() });
  const master = (taskId: string, model: string, thinking: string) => record({ kind: "master", agent: "MASTER", model, thinking, taskId });
  const groups = taskTimesByModel(
    [done("A", 10), done("B", 30), done("C", 5), { ...done("D", 50), state: "abandoned" as const }, done("E", 7)],
    [master("A", "p/big", "high"), master("A", "p/big", "high"), master("A", "p/small", "low"), master("B", "big", "high"), master("C", "p/small", "low"), master("D", "p/big", "high"), record({ taskId: "E" })],
  );
  assert.deepEqual(groups.map((group) => [group.model, group.thinking, group.tasks, group.avgMs]), [["big", "high", 2, 20 * 60_000], ["small", "low", 1, 5 * 60_000]]);
});
