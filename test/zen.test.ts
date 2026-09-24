import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, isZenActive, mascotFrame, setZenActive, zenLines } from "../src/pi/zen.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return { ...createTask("TASK-1", "Add pagination", "2026-01-01T00:00:00.000Z"), ...overrides };
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: "r1",
    taskId: "TASK-1",
    domain: "backend",
    role: "scout",
    status: "running",
    output: "",
    attempts: 1,
    startedAt: "2026-01-01T00:09:50.000Z",
    ...overrides,
  };
}

test("no task means no zen lines", () => {
  assert.deepEqual(zenLines(undefined, [], NOW), []);
});

test("zen header shows state, elapsed time, and the idle checklist", () => {
  const lines = zenLines(task({ state: "scouting" }), [], NOW);
  assert.equal(lines[0], "dev-house TASK-1 · scouting   ⏱ 10m 00s");
  assert.equal(lines[1], "  ○ waiting for the first agent…");
});

test("zen checklist renders per-agent status, duration, and retries", () => {
  const runs = [
    run({ status: "success", finishedAt: "2026-01-01T00:09:58.000Z" }),
    run({ runId: "r2", domain: "qa", role: "worker", status: "running", attempts: 2 }),
  ];
  const lines = zenLines(task({ state: "implementing" }), runs, NOW);
  assert.match(lines[1]!, /✓ backend\/scout\s+success\s+8s/);
  assert.match(lines[2]!, /◐ qa\/worker\s+running\s+10s ×2/);
});

test("zen surfaces blockers", () => {
  const blocked = task({
    blockers: [{ domain: "backend", reason: "schema owner must confirm", tried: [], need: "answer", createdAt: "now" }],
  });
  assert.deepEqual(zenLines(blocked, [], NOW).slice(1, 2), ["blocked: schema owner must confirm"]);
});

test("formatDuration switches to minutes past 60s and clamps negatives", () => {
  assert.equal(formatDuration(9_000), "9s");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(-5), "0s");
});

test("mascot frames cycle and the zen flag toggles", () => {
  assert.deepEqual(mascotFrame(0), mascotFrame(4));
  assert.notDeepEqual(mascotFrame(0), mascotFrame(1));
  assert.equal(isZenActive(), false);
  setZenActive(true);
  assert.equal(isZenActive(), true);
  setZenActive(false);
});
