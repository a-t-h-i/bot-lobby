import { test } from "node:test";
import assert from "node:assert/strict";
import { statusLines, statusText, summarizeRun } from "../src/pi/ui.ts";
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
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return { ...createTask("TASK-1", "Add pagination to the users endpoint"), ...overrides };
}

test("no task means no status output", () => {
  assert.equal(statusText(undefined), undefined);
  assert.deepEqual(statusLines(undefined), []);
});

test("status text shows the task and state, including paused", () => {
  assert.equal(statusText(task()), "dev-house TASK-1 · created");
  assert.equal(statusText(task({ paused: true })), "dev-house TASK-1 · created (paused)");
});

test("status lines include the request and live agent badges", () => {
  const lines = statusLines(task({ domains: ["backend"] }), [run(), run({ role: "worker", status: "success" })]);
  assert.equal(lines[0], "dev-house TASK-1 · created");
  assert.equal(lines[1], "Add pagination to the users endpoint");
  assert.match(lines[2]!, /⏳ backend\/scout/);
  assert.match(lines[2]!, /✓ backend\/worker/);
});

test("status lines surface pending approvals and blockers", () => {
  const withApproval = task({
    approvals: [
      { id: "APR-1", kind: "dependency", domain: "backend", detail: "install zod", status: "pending", createdAt: "now" },
      { id: "APR-2", kind: "dependency", domain: "backend", detail: "already handled", status: "approved", createdAt: "now" },
    ],
  });
  assert.deepEqual(statusLines(withApproval).slice(2), ["approvals pending: APR-1"]);

  const blocked = task({ blockers: [{ domain: "backend", reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }] });
  assert.deepEqual(statusLines(blocked).slice(2), ["blocked: schema owner must confirm"]);
});

test("summarizeRun marks running, success, and failure", () => {
  assert.equal(summarizeRun(run()), "⏳ backend/scout");
  assert.equal(summarizeRun(run({ status: "success" })), "✓ backend/scout (success)");
  assert.equal(summarizeRun(run({ status: "failed" })), "✗ backend/scout (failed)");
  assert.equal(summarizeRun(run({ status: "timeout" })), "✗ backend/scout (timeout)");
});
