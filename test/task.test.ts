import { test } from "node:test";
import assert from "node:assert/strict";
import { createTask, isTaskState, TASK_STATES, TERMINAL_STATES } from "../src/schemas/task.ts";
import { isDomain, isRole } from "../src/schemas/agent.ts";

test("createTask produces a valid initial task", () => {
  const task = createTask("TASK-1", "Add feature X", "2026-01-01T00:00:00.000Z");
  assert.equal(task.state, "created");
  assert.equal(task.title, "Add feature X");
  assert.deepEqual(task.domains, []);
  assert.equal(task.paused, false);
  assert.deepEqual(task.reviewIterations, { qa: 0 });
  assert.deepEqual(task.reviewRecords, []);
});

test("state and domain guards", () => {
  assert.ok(TASK_STATES.includes("implementing"));
  assert.ok(isTaskState("completed"));
  assert.ok(!isTaskState("nonsense"));
  assert.ok(isDomain("backend"));
  assert.ok(!isDomain("master"));
  assert.ok(isRole("reviewer"));
  assert.ok(!isRole("orchestrator"));
  assert.ok(TERMINAL_STATES.includes("completed"));
  assert.ok(TERMINAL_STATES.includes("abandoned"));
});
