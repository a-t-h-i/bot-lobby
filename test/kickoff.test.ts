import { test } from "node:test";
import assert from "node:assert/strict";
import { createTask, taskRequest } from "../src/schemas/task.ts";
import { kickoff } from "../src/pi/commands.ts";

test("the kickoff carries the full request, not just the short title", () => {
  const request = "let's create a landing page for our website with a pricing section";
  const task = createTask("TASK-x", "create landing page", "2026-01-01T00:00:00.000Z", request);
  const text = kickoff(task);
  assert.ok(text.includes(request), "the full request is present");
  assert.ok(text.includes("create landing page"), "the short title is present");
});

test("taskRequest falls back to the title for pre-request state", () => {
  const legacy = { ...createTask("TASK-y", "old task"), request: "" } as ReturnType<typeof createTask>;
  assert.equal(taskRequest(legacy), "old task");
});
