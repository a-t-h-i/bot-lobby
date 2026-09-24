import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_CAP, runStatus, sceneMetrics } from "../src/pi/zen-metrics.ts";
import { formatDuration } from "../src/pi/zen.ts";
import { SLOT_IDS } from "../src/pi/mascot-art.ts";
import { createTask, type Task } from "../src/schemas/task.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");

/** Local HH:MM, computed the same way the module does so no ambient TZ leaks in. */
function clock(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

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

function percentById(runs: AgentRun[], taskOverrides: Partial<Task> = {}): Record<string, number> {
  const metrics = sceneMetrics(task(taskOverrides), runs, NOW);
  return Object.fromEntries(metrics.slots.map((slot) => [slot.id, slot.percent]));
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
  assert.deepEqual(metrics.slots.map((slot) => slot.percent), [0, 0, 0, 0]);
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

test("a researcher run on any domain fills the RESEARCH column and keeps its domain in the LOG", () => {
  const runs = [
    run({ runId: "res-des", domain: "designer", role: "researcher", status: "success", startedAt: "2026-01-01T00:01:00.000Z" }),
    run({ runId: "res-be", domain: "backend", role: "researcher", status: "running", startedAt: "2026-01-01T00:03:00.000Z" }),
  ];
  const metrics = sceneMetrics(task(), runs, NOW);
  assert.equal(metrics.slots.find((slot) => slot.id === "research")!.status, "working");
  assert.equal(metrics.slots.find((slot) => slot.id === "dev")!.status, "idle");
  assert.deepEqual(metrics.log.map((row) => row.label), ["ORACLE", "RES/DES", "RES/BE"]);
  assert.deepEqual(metrics.log.slice(1).map((row) => row.status), ["done", "working"]);
});

// --- percent and ETA rules ---

test("a working slot reads its own plan step and the rest read measured progress", () => {
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
  // dev's own worker instruction targets step 2 of 4; research has no worker
  // instruction so it inherits the shared plan progress; design succeeded (100).
  assert.deepEqual(metrics.slots.map((slot) => slot.percent), [25, 100, 25, 0]);
  assert.equal(metrics.etaLabel, `ETA ~${formatDuration(600_000 * 3)}`);
  assert.equal(metrics.elapsedLabel, "10m 00s");
});

test("a succeeded slot reads 100 even when it is the current plan step", () => {
  const runs = [
    run({ runId: "dev", domain: "backend", role: "worker", status: "success", instruction: "implement `src/b.ts` now", startedAt: "2026-01-01T00:09:00.000Z", finishedAt: "2026-01-01T00:09:30.000Z" }),
  ];
  const planText = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third");
  const metrics = sceneMetrics(task({ plan: planText }), runs, NOW);
  assert.equal(metrics.progress, 33);
  assert.equal(percentById(runs, { plan: planText }).dev, 100);
  assert.deepEqual(metrics.slots.map((slot) => slot.status), ["done", "idle", "idle", "idle"]);
});

test("a working slot measures its plan step instead of its run duration", () => {
  const planText = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third", "`src/d.ts`: fourth");
  const measured = (startedAt: string) =>
    percentById([run({ domain: "backend", role: "worker", status: "running", instruction: "implement `src/c.ts` now", startedAt })], { plan: planText }).dev;
  // The percent follows the matched plan step (3 of 4 -> 50), never the clock.
  assert.equal(measured("2026-01-01T00:10:00.000Z"), 50);
  assert.equal(measured("2025-12-31T00:00:00.000Z"), 50);
});

test("a working slot with no matching plan step falls back to the plan's completed/total progress", () => {
  const planText = plan("`src/a.ts`: first", "`src/b.ts`: second", "`src/c.ts`: third", "`src/d.ts`: fourth");
  const runs = [
    run({ runId: "dev", role: "worker", status: "running", instruction: "implement `src/c.ts` now", startedAt: "2026-01-01T00:09:00.000Z" }),
    run({ runId: "design", domain: "designer", role: "scout", status: "running", startedAt: "2026-01-01T00:09:30.000Z" }),
  ];
  const metrics = sceneMetrics(task({ plan: planText }), runs, NOW);
  assert.equal(metrics.progress, 50);
  assert.equal(percentById(runs, { plan: planText }).design, 50);
  assert.equal(percentById([run({ domain: "designer", role: "scout", status: "running" })], {}).design, 0);
});

test("a zero plan reports no progress and an em-dash ETA estimate", () => {
  const metrics = sceneMetrics(task(), [run({ domain: "backend", role: "scout", status: "success", startedAt: "2026-01-01T00:01:00.000Z" })], NOW);
  assert.equal(metrics.done, 0);
  assert.equal(metrics.total, 0);
  assert.equal(metrics.progress, 0);
  assert.equal(metrics.etaLabel, "ETA —");
  assert.equal(metrics.slots.find((slot) => slot.id === "dev")!.percent, 100);
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

test("the elapsed label measures from the task's created time", () => {
  assert.equal(sceneMetrics(task({ createdAt: "2026-01-01T00:09:00.000Z" }), [], NOW).elapsedLabel, "1m 00s");
  assert.equal(sceneMetrics(task({ createdAt: "2026-01-01T00:10:00.000Z" }), [], NOW).elapsedLabel, "0s");
  assert.equal(sceneMetrics(task({ createdAt: "2026-01-01T01:00:00.000Z" }), [], NOW).elapsedLabel, "0s");
});

// --- LOG ---

test("the LOG starts with the oracle row and lists the runs oldest first", () => {
  const runs = [
    run({ runId: "b", domain: "backend", role: "worker", status: "running", startedAt: "2026-01-01T00:05:00.000Z" }),
    run({ runId: "a", domain: "designer", role: "worker", status: "success", startedAt: "2026-01-01T00:03:00.000Z" }),
    run({ runId: "c", domain: "qa", role: "worker", status: "failed", startedAt: "2026-01-01T00:07:00.000Z" }),
  ];
  const metrics = sceneMetrics(task(), runs, NOW);
  assert.deepEqual(metrics.log, [
    { time: clock("2026-01-01T00:00:00.000Z"), label: "ORACLE", status: "oracle" },
    { time: clock("2026-01-01T00:03:00.000Z"), label: "DESIGN", status: "done" },
    { time: clock("2026-01-01T00:05:00.000Z"), label: "DEV", status: "working" },
    { time: clock("2026-01-01T00:07:00.000Z"), label: "QA", status: "failed" },
  ]);
});

test("the LOG keeps the oracle row and only the five most recent runs", () => {
  const runs = Array.from({ length: 9 }, (_value, index) =>
    run({ runId: `r${index}`, domain: "backend", role: "scout", status: "success", startedAt: `2026-01-01T00:0${index}:00.000Z` }),
  );
  const metrics = sceneMetrics(task(), runs, NOW);
  assert.equal(metrics.log.length, LOG_CAP);
  assert.equal(metrics.log[0]!.label, "ORACLE");
  assert.equal(metrics.log[1]!.time, clock("2026-01-01T00:04:00.000Z"));
  assert.equal(metrics.log.at(-1)!.time, clock("2026-01-01T00:08:00.000Z"));
  const times = metrics.log.slice(1).map((row) => row.time);
  assert.deepEqual(times, [...times].sort());
});

test("LOG times are the local clock of each run's start, never fabricated", () => {
  const runs = [
    run({ runId: "x", domain: "qa", role: "researcher", status: "success", startedAt: "2026-06-15T23:45:00.000Z" }),
  ];
  const metrics = sceneMetrics(task({ createdAt: "2026-06-15T23:40:00.000Z" }), runs, NOW);
  assert.deepEqual(metrics.log, [
    { time: clock("2026-06-15T23:40:00.000Z"), label: "ORACLE", status: "oracle" },
    { time: clock("2026-06-15T23:45:00.000Z"), label: "RES/QA", status: "done" },
  ]);
  assert.equal(new Date("2026-06-15T23:45:00.000Z").getTime(), Date.parse("2026-06-15T23:45:00.000Z"));
});

test("an unparsable timestamp degrades to a placeholder time", () => {
  const metrics = sceneMetrics(task({ createdAt: "not-a-date" }), [run({ startedAt: "also-not-a-date" })], NOW);
  assert.deepEqual(metrics.log.map((row) => row.time), ["--:--", "--:--"]);
  assert.equal(metrics.elapsedLabel, "0s");
  assert.equal(metrics.etaLabel, "ETA —");
  const percents = metrics.slots.map((slot) => slot.percent);
  assert.deepEqual(percents, [0, 0, 0, 0]);
  assert.ok(percents.every((percent) => Number.isFinite(percent) && percent >= 0 && percent <= 100));
});
