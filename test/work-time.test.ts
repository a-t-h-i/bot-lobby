import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clockTask, pauseClocks, resetClocks, resumeClocks, startClock, stopClocks, turnStarted, whileAsking } from "../src/state/budget.ts";
import { noteWorkerRun, projectWork, readWork, resetNotedRuns, updateWork, WORK_FRESH_MS } from "../src/state/work-time.ts";
import { stepWork } from "../src/pi/plan-checklist.ts";
import { stepViews } from "../src/webui/api/plan-facts.ts";
import { createTask } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "bl-work-"));
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("a task's work time counts the oracle's turns on it, budget or not, and leaves out dialogs and the time between turns", async () => {
  resetClocks();
  const root = tempRoot();
  turnStarted();
  startClock(root, ".pi", "T-1");
  assert.ok(readWork(root, ".pi", "T-1")?.runningSince, "the stretch under way is saved, so other windows see it tick");
  await wait(120);
  await whileAsking(() => wait(300));
  await wait(120);
  stopClocks();
  const worked = readWork(root, ".pi", "T-1")!;
  assert.ok(worked.workedMs >= 200 && worked.workedMs < 450, `worked ${worked.workedMs}ms: the 300ms dialog is left out`);
  assert.equal(worked.runningSince, undefined, "stopped between turns");
  await wait(100);
  assert.equal(projectWork(readWork(root, ".pi", "T-1"))!.workedMs, worked.workedMs, "between turns nothing counts");
  assert.equal(projectWork(readWork(root, ".pi", "T-1"))!.running, false);
  resetClocks();
});

test("the clock follows the task the session drives: one started within a turn starts counting, one that ends stops", async () => {
  resetClocks();
  const root = tempRoot();
  clockTask(root, ".pi", "T-1");
  assert.equal(readWork(root, ".pi", "T-1"), undefined, "outside a turn nothing starts");
  turnStarted();
  clockTask(root, ".pi", "T-1");
  await wait(60);
  pauseClocks();
  resumeClocks();
  clockTask(root, ".pi", "T-2");
  const first = readWork(root, ".pi", "T-1")!;
  assert.equal(first.runningSince, undefined, "the task the session no longer drives stops");
  assert.ok(first.workedMs >= 50, `it kept ${first.workedMs}ms`);
  assert.ok(readWork(root, ".pi", "T-2")!.runningSince, "and the new one counts");
  stopClocks();
  resetClocks();
});

test("a work file its owner stopped keeping reads as stopped, counted up to its last refresh", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const since = new Date(now - 10 * 60_000).toISOString();
  const fresh = projectWork({ workedMs: 60_000, runningSince: since, active: [{ runId: "r1", instruction: "Step 1: a", startedAt: since }], updatedAt: new Date(now - 5_000).toISOString() }, now)!;
  assert.deepEqual([fresh.workedMs, fresh.running, fresh.active.length], [60_000 + 10 * 60_000, true, 1], "kept: it counts up to now");
  const stale = projectWork({ workedMs: 60_000, runningSince: since, active: [{ runId: "r1", instruction: "Step 1: a", startedAt: since }], updatedAt: new Date(now - WORK_FRESH_MS - 60_000).toISOString() }, now)!;
  assert.equal(stale.running, false);
  assert.deepEqual(stale.active, [], "no run of a gone session is under way");
  assert.equal(stale.workedMs, 60_000 + (Date.parse(new Date(now - WORK_FRESH_MS - 60_000).toISOString()) - Date.parse(since)), "counted up to its last refresh only");
  assert.equal(projectWork(undefined), undefined);
});

test("worker runs under way are written once when they start and once when they end", () => {
  resetNotedRuns();
  const root = tempRoot();
  updateWork(root, ".pi", "T-1", () => {});
  const run = { runId: "r1", instruction: "Step 2: wire it", startedAt: "2026-10-05T12:00:00.000Z", status: "running" };
  noteWorkerRun(root, ".pi", "T-1", run);
  const first = readWork(root, ".pi", "T-1")!.updatedAt;
  noteWorkerRun(root, ".pi", "T-1", run);
  assert.equal(readWork(root, ".pi", "T-1")!.updatedAt, first, "an update of a run already noted writes nothing");
  assert.deepEqual(readWork(root, ".pi", "T-1")!.active, [{ runId: "r1", instruction: "Step 2: wire it", startedAt: "2026-10-05T12:00:00.000Z" }]);
  noteWorkerRun(root, ".pi", "T-1", { ...run, status: "success" });
  assert.deepEqual(readWork(root, ".pi", "T-1")!.active, []);
  resetNotedRuns();
});

function worker(runId: string, instruction: string, status: AgentRun["status"], startedAt: string, finishedAt?: string): AgentRun {
  return { runId, taskId: "T-1", domain: "backend", role: "worker", status, instruction, output: "", attempts: 1, startedAt, ...(finishedAt ? { finishedAt } : {}) } as AgentRun;
}

test("each step's worker time, and which steps a worker is on now: a range marks every step in it", () => {
  const steps = ["Add the clock", "Save it", "Show it", "Test it"];
  const t = (minute: number) => new Date(Date.UTC(2026, 9, 5, 12, minute)).toISOString();
  const now = Date.parse(t(20));
  const runs = [
    worker("a", "Step 1: add the clock", "success", t(0), t(4)),
    worker("b", "Steps 2-3: save and show it", "running", t(10)),
  ];
  const work = stepWork(steps, runs, now);
  assert.deepEqual(work.map((step) => step.active), [false, true, true, false]);
  assert.deepEqual(work.map((step) => step.ms / 60_000), [4, 10, 10, 0]);
  const retried = stepWork(steps, [...runs.slice(0, 1), worker("c", "Step 1: fix the clock", "running", t(18))], now);
  assert.equal(retried[0]!.ms / 60_000, 6, "a fix round adds to the step's time");
  assert.equal(retried[0]!.active, true);
});

test("steps run side by side all read as under way, never done, with the running ones from the owner's work file", () => {
  const task = createTask("T-1", "timer", "2026-10-05T12:00:00.000Z");
  task.plan = "## Steps\n1. Add the clock\n2. Save it\n3. Show it\n\n## Details\n### Step 1: Add the clock\nx";
  task.workerRuns = [{ runId: "a", domain: "backend", instruction: "Step 1: add the clock", status: "success", startedAt: "2026-10-05T12:00:00.000Z", finishedAt: "2026-10-05T12:03:00.000Z" }];
  const now = Date.parse("2026-10-05T12:10:00.000Z");
  const work = { workedMs: 0, running: true, active: [
    { runId: "b", instruction: "Step 2: save it", startedAt: "2026-10-05T12:05:00.000Z" },
    { runId: "c", instruction: "Step 3: show it", startedAt: "2026-10-05T12:06:00.000Z" },
  ] };
  const views = stepViews(task, work, now);
  assert.deepEqual(views.map((step) => [step.status, step.active]), [["done", false], ["current", true], ["current", true]]);
  assert.deepEqual(views.map((step) => step.workedMs / 60_000), [3, 5, 4]);
  const idle = stepViews(task, undefined, now);
  assert.deepEqual(idle.map((step) => [step.status, step.active]), [["done", false], ["current", false], ["pending", false]], "with nothing running the next step is current, not active");
});


test("active step counts include parents and running children without advancing progress", () => {
  const task = createTask("T-team", "feature", "2026-10-05T12:00:00.000Z");
  task.plan = "## Steps\n1. Small feature\n2. Large feature\n3. Verify";
  const now = Date.parse("2026-10-05T12:01:00.000Z");
  const active = [
    { runId: "parent", instruction: "Step 2: Large feature", startedAt: "2026-10-05T12:00:00.000Z" },
    ...Array.from({ length: 5 }, (_, index) => ({ runId: `child-${index}`, parentRunId: "parent", stepInstruction: "Step 2: Large feature", instruction: "Step 3: unrelated wording in child brief", startedAt: "2026-10-05T12:00:30.000Z" })),
  ];
  const work = { workedMs: 60_000, running: true, active };
  const steps = stepViews(task, work, now);
  assert.equal(steps[1]!.activeAgentCount, 6);
  assert.equal(steps[2]!.activeAgentCount, 0);
  const reduced = stepViews(task, { ...work, active: active.slice(0, 4) }, now);
  assert.equal(reduced[1]!.activeAgentCount, 4);
  const finished = stepViews(task, { ...work, active: [] }, now);
  assert.ok(finished.every((step) => !step.active && step.activeAgentCount === 0));
});
