import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, listTasks, loadTask, saveTask } from "../src/state/persistence.ts";
import { captureCheckpoint, checkpointSummary, checkpointTaskStatus, settledDecisions } from "../src/state/checkpoint.ts";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "continuity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const task = createTask("TASK-1", "Objective");
  task.plan = "original plan";
  createTaskDir(root, ".pi", task);
  return { root, task, load: () => loadTask(root, ".pi", task.id)! };
}

test("persisted checkpoints survive reload without recapturing changed assignment state", (t) => {
  const { root, task, load } = fixture(t);
  assert.equal(checkpointTaskStatus(load().checkpoint!, task), "current-task-state");
  task.amendments.push("User correction");
  assert.equal(checkpointTaskStatus(task.checkpoint!, task), "stale-task-state");
  saveTask(root, ".pi", task);
  const resumed = load();
  assert.equal(checkpointTaskStatus(resumed.checkpoint!, resumed), "current-task-state");
  assert.deepEqual(resumed.amendments, ["User correction"]);
  assert.match(checkpointSummary(resumed), /still require revalidation/);
  assert.match(checkpointSummary(resumed), /no claims or completed actions are restored/);
});

test("in-flight saves preserve newer amendments and approved plan including removal", (t) => {
  const { root, load } = fixture(t);
  const stale = load();
  const user = load();
  user.amendments.push("New user constraint");
  user.plan = "replacement plan";
  user.approvedPlan = "PLAN-1";
  saveTask(root, ".pi", user);
  stale.amendments.push("Local addition");
  saveTask(root, ".pi", stale);
  assert.deepEqual(load().amendments, ["New user constraint", "Local addition"]);
  assert.equal(load().plan, "replacement plan");
  assert.equal(load().approvedPlan, "PLAN-1");
  const inFlight = load();
  const removed = load();
  delete removed.plan;
  delete removed.approvedPlan;
  saveTask(root, ".pi", removed);
  saveTask(root, ".pi", inFlight);
  assert.equal(load().plan, undefined);
  assert.equal(load().approvedPlan, undefined);
});

test("intentional local edits survive when persisted constraints did not change", (t) => {
  const { root, load } = fixture(t);
  const task = listTasks(root, ".pi")[0]!;
  task.plan = "intentional revision";
  task.approvedPlan = "PLAN-1";
  saveTask(root, ".pi", task);
  task.plan = "second intentional revision";
  saveTask(root, ".pi", task);
  assert.equal(load().plan, "second intentional revision");
  assert.equal(load().approvedPlan, "PLAN-1");
});

test("task-only saves retain existing advisory references without opening or replaying them", (t) => {
  const { root, task, load } = fixture(t);
  const inFlight = load();
  task.checkpoint = captureCheckpoint(task, root, { artifactRefs: ["O-ref"], ownershipRefs: ["claim:old"], deliveryRefs: ["board:3"] });
  saveTask(root, ".pi", task);
  saveTask(root, ".pi", inFlight);
  const resumed = load();
  assert.deepEqual(resumed.checkpoint!.artifacts.items, ["O-ref"]);
  assert.deepEqual(resumed.checkpoint!.ownership.items, ["claim:old"]);
  assert.deepEqual(resumed.checkpoint!.delivery.items, ["board:3"]);
  assert.equal(resumed.ownerSessionId, undefined);
});

test("settled decisions survive stale saves and are directly available without ranking", (t) => {
  const { root, load } = fixture(t);
  const stale = load();
  const user = load();
  user.decisions.push({ domain: "backend", text: "Preserve existing authorization", createdAt: "now" });
  saveTask(root, ".pi", user);
  saveTask(root, ".pi", stale);
  assert.match(settledDecisions(load()), /backend: Preserve existing authorization/);
  assert.equal(settledDecisions(load()).match(/Preserve existing authorization/g)?.length, 1);
});
