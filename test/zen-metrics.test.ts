import { test } from "node:test";
import assert from "node:assert/strict";
import { runStatus, sceneMetrics } from "../src/pi/zen-metrics.ts";
import { formatDuration } from "../src/pi/zen.ts";
import { SLOT_IDS } from "../src/pi/mascot-art.ts";
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

function plan(...steps: string[]): string {
  return ["Objective: ship it", ...steps.map((step, index) => `${index + 1}. ${step}`)].join("\n");
}

// --- status mapping ---

test("runStatus maps every AgentRun status onto the slot vocabulary", () => {
  assert.equal(runStatus("running"), "working");
  assert.equal(runStatus("success"), "done");
  assert.equal(runStatus("failed"), "failed");
  assert.equal(runStatus("cancelled"), "failed");
  assert.equal(runStatus("timeout"), "failed");
});

test("every slot is idle without runs and reports its fixed label", () => {
  const metrics = sceneMetrics(task(), [], NOW);
  assert.deepEqual(metrics.slots.map((slot) => slot.id), [...SLOT_IDS]);
  assert.deepEqual(metrics.slots.map((slot) => slot.status), ["idle", "idle", "idle", "idle"]);
  assert.deepEqual(metrics.slots.map((slot) => slot.label), ["DEV", "DESIGN", "RESEARCH", "QA"]);
});

test("slots take the latest run per column and the full run-status vocabulary", () => {
  const runs = [
    run({ runId: "dev-old", domain: "backend", role: "worker", status: "success", startedAt: "2026-01-01T00:01:00.000Z" }),
    run({ runId: "dev-new", domain: "backend", role: "scout", status: "running", startedAt: "2026-01-01T00:05:00.000Z" }),
    run({ runId: "design", domain: "designer", role: "worker", status: "success", startedAt: "2026-01-01T00:02:00.000Z" }),
    run({ runId: "qa", domain: "qa", role: "worker", status: "timeout", startedAt: "2026-01-01T00:03:00.000Z" }),
    run({ runId: "research", domain: "qa", role: "researcher", status: "cancelled", startedAt: "2026-01-01T00:04:00.000Z" }),
  ];
  const metrics = sceneMetrics(task(), runs, NOW);
  assert.deepEqual(metrics.slots.map((slot) => slot.status), ["working", "done", "failed", "failed"]);
});

test("a researcher run on any domain fills the RESEARCH column", () => {
  const runs = [
    run({ runId: "res-des", domain: "designer", role: "researcher", status: "success", startedAt: "2026-01-01T00:01:00.000Z" }),
    run({ runId: "res-be", domain: "backend", role: "researcher", status: "running", startedAt: "2026-01-01T00:03:00.000Z" }),
  ];
  const metrics = sceneMetrics(task(), runs, NOW);
  assert.equal(metrics.slots.find((slot) => slot.id === "research")!.status, "working");
  assert.equal(metrics.slots.find((slot) => slot.id === "dev")!.status, "idle");
});

// --- plan progress and ETA rules ---

test("a working slot's instruction sets the plan's completed/total progress", () => {
  const runs = [
    run({ runId: "design", domain: "designer", role: "scout", status: "success", startedAt: "2026-01-01T00:01:00.000Z", finishedAt: "2026-01-01T00:02:00.000Z" }),
    run({ runId: "research", domain: "backend", role: "researcher", status: "running", startedAt: "2026-01-01T00:00:10.000Z" }),
    run({ runId: "qa", domain: "qa", role: "reviewer", status: "failed", startedAt: "2026-01-01T00:03:00.000Z" }),
    run({ runId: "dev", domain: "backend", role: "worker", status: "running", instruction: "implement `src/b.ts` now", startedAt: "2026-01-01T00:09:00.000Z" }),
  ];
  const planText = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third", "`src/d.ts`: fourth");
  const metrics = sceneMetrics(task({ plan: planText }), runs, NOW);
  assert.equal(metrics.done, 1);
  assert.equal(metrics.total, 4);
  assert.equal(metrics.progress, 25);
  assert.equal(metrics.etaLabel, `ETA ~${formatDuration(600_000 * 3)}`);
  assert.equal(metrics.elapsedLabel, "10m 00s");
});

test("a zero plan reports no progress and an em-dash ETA estimate", () => {
  const metrics = sceneMetrics(task(), [run({ domain: "backend", role: "scout", status: "success", startedAt: "2026-01-01T00:01:00.000Z" })], NOW);
  assert.equal(metrics.done, 0);
  assert.equal(metrics.total, 0);
  assert.equal(metrics.progress, 0);
  assert.equal(metrics.etaLabel, "ETA —");
  assert.equal(metrics.slots.find((slot) => slot.id === "dev")!.status, "done");
});

test("the ETA stays an em-dash estimate until one plan step is done", () => {
  const planText = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  assert.equal(sceneMetrics(task({ plan: planText }), [], NOW).etaLabel, "ETA —");
  const runs = [run({ runId: "dev", domain: "backend", role: "worker", status: "running", instruction: "implement `src/c.ts` now", startedAt: "2026-01-01T00:09:00.000Z" })];
  const metrics = sceneMetrics(task({ plan: planText }), runs, NOW);
  assert.equal(metrics.done, 2);
  assert.equal(metrics.progress, 67);
  assert.equal(metrics.etaLabel, `ETA ~${formatDuration((600_000 * 1) / 2)}`);
  assert.ok(metrics.etaLabel.startsWith("ETA ~"));
});

test("a succeeded final step completes the plan, reaching 100% and an em-dash ETA", () => {
  const planText = plan("`src/a.ts`: first", "`src/b.ts`: second");
  const runs = [run({ runId: "dev", domain: "backend", role: "worker", status: "success", instruction: "implement `src/b.ts`", finishedAt: "2026-01-01T00:09:30.000Z" })];
  const metrics = sceneMetrics(task({ plan: planText }), runs, NOW);
  assert.equal(metrics.done, 2);
  assert.equal(metrics.total, 2);
  assert.equal(metrics.progress, 100);
  assert.equal(metrics.etaLabel, "ETA —");
});

test("the elapsed label measures from the task's created time", () => {
  assert.equal(sceneMetrics(task({ createdAt: "2026-01-01T00:09:00.000Z" }), [], NOW).elapsedLabel, "1m 00s");
  assert.equal(sceneMetrics(task({ createdAt: "2026-01-01T00:10:00.000Z" }), [], NOW).elapsedLabel, "0s");
  assert.equal(sceneMetrics(task({ createdAt: "2026-01-01T01:00:00.000Z" }), [], NOW).elapsedLabel, "0s");
});

test("an unparsable timestamp degrades to zero elapsed and an em-dash ETA", () => {
  const metrics = sceneMetrics(task({ createdAt: "not-a-date" }), [run({ startedAt: "also-not-a-date" })], NOW);
  assert.equal(metrics.elapsedLabel, "0s");
  assert.equal(metrics.etaLabel, "ETA —");
  assert.equal(metrics.progress, 0);
  assert.ok(Number.isFinite(metrics.progress) && metrics.progress >= 0 && metrics.progress <= 100);
});
