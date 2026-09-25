import { test } from "node:test";
import assert from "node:assert/strict";
import { transition } from "../src/state/task-state.ts";
import { createTask } from "../src/schemas/task.ts";

test("transition advances state and stamps updatedAt", () => {
  const task = createTask("TASK-1", "X", "2026-01-01T00:00:00.000Z");
  transition(task, "clarifying", "2026-01-02T00:00:00.000Z");
  assert.equal(task.state, "clarifying");
  assert.equal(task.updatedAt, "2026-01-02T00:00:00.000Z");
});

test("transition rejects an illegal move without mutating the task", () => {
  const task = createTask("TASK-2", "Y");
  assert.throws(() => transition(task, "completed"), /Invalid state transition/);
  assert.equal(task.state, "created");
});

test("same-state transitions are allowed for non-terminal states", () => {
  const task = createTask("TASK-3", "Z");
  transition(task, "clarifying");
  transition(task, "clarifying");
  assert.equal(task.state, "clarifying");
});
