import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_TICK_MS, LIVE_TICK_MS, expressionTickDelay, statusText, summarizeRun } from "../src/pi/ui.ts";
import { BLINK_MS, FAST_TICK_MS } from "../src/pi/expressions.ts";
import { setQuiet } from "../src/pi/quiet.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: "r1",
    taskId: "TASK-1",
    domain: "backend",
    role: "scout",
    status: "running",
    output: "",
    attempts: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return { ...createTask("TASK-1", "Add pagination to the users endpoint"), ...overrides };
}

test("status text always carries the quiet-mode hint", () => {
  setQuiet(true);
  assert.equal(statusText(undefined), "dev-house · tools hidden (alt+t)");
  setQuiet(false);
  assert.equal(statusText(undefined), "dev-house · tools shown");
  setQuiet(true);
});

test("status text shows the task and state, including paused", () => {
  setQuiet(true);
  assert.equal(statusText(task()), "dev-house TASK-1 · created · tools hidden (alt+t)");
  assert.equal(statusText(task({ paused: true })), "dev-house TASK-1 · created (paused) · tools hidden (alt+t)");
});

test("summarizeRun marks running, success, and failure", () => {
  assert.equal(summarizeRun(run()), "⏳ backend/scout");
  assert.equal(summarizeRun(run({ status: "success" })), "✓ backend/scout (success)");
  assert.equal(summarizeRun(run({ status: "failed" })), "✗ backend/scout (failed)");
  assert.equal(summarizeRun(run({ status: "timeout" })), "✗ backend/scout (timeout)");
  assert.equal(summarizeRun(run({ status: "success", attempts: 2 })), "✓ backend/scout (success) ×2");
});

test("the zen clock speeds up while an expression plays", () => {
  const resting = { nextAt: 10_000, until: 0, frame: 0 };
  const blinking = { nextAt: 10_000, until: 1_000, frame: 1 };
  assert.equal(expressionTickDelay([resting], 0, true), LIVE_TICK_MS);
  assert.equal(expressionTickDelay([resting], 0, false), IDLE_TICK_MS);
  assert.equal(expressionTickDelay([blinking], 0, false), FAST_TICK_MS);
  assert.equal(expressionTickDelay([resting, blinking], 0, true), FAST_TICK_MS);
  assert.ok(FAST_TICK_MS < BLINK_MS, "a blink must survive one fast tick");
  assert.equal(expressionTickDelay([resting], Number.NaN, true), LIVE_TICK_MS);
});
