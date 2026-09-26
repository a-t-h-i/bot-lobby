import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_TICK_MS, LIVE_TICK_MS, MAX_RETAINED_RUNS, expressionTickDelay, mergeRuns, persistedRuns, statusText, summarizeRun } from "../src/pi/ui.ts";
import { planChecklist } from "../src/pi/zen.ts";
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
  assert.equal(statusText(undefined), "bot-lobby · tools hidden (alt+t)");
  setQuiet(false);
  assert.equal(statusText(undefined), "bot-lobby · tools shown");
  setQuiet(true);
});

test("status text shows the task and state, including paused", () => {
  setQuiet(true);
  assert.equal(statusText(task()), "bot-lobby TASK-1 · created · tools hidden (alt+t)");
  assert.equal(statusText(task({ paused: true })), "bot-lobby TASK-1 · created (paused) · tools hidden (alt+t)");
});

test("summarizeRun marks running, success, and failure", () => {
  assert.equal(summarizeRun(run()), "⏳ backend/scout");
  assert.equal(summarizeRun(run({ status: "success" })), "✓ backend/scout (success)");
  assert.equal(summarizeRun(run({ status: "failed" })), "✗ backend/scout (failed)");
  assert.equal(summarizeRun(run({ status: "timeout" })), "✗ backend/scout (timeout)");
  assert.equal(summarizeRun(run({ status: "success", attempts: 2 })), "✓ backend/scout (success) ×2");
});

test("the zen clock speeds up while an expression plays", () => {
  const resting = { nextAt: 10_000, until: 0, startedAt: 0, frame: 0, variant: 0 };
  const blinking = { nextAt: 10_000, until: 1_000, startedAt: 0, frame: 1, variant: 0 };
  assert.equal(expressionTickDelay([resting], 0, true), LIVE_TICK_MS);
  assert.equal(expressionTickDelay([resting], 0, false), IDLE_TICK_MS);
  assert.equal(expressionTickDelay([blinking], 0, false), FAST_TICK_MS);
  assert.equal(expressionTickDelay([resting, blinking], 0, true), FAST_TICK_MS);
  assert.ok(FAST_TICK_MS < BLINK_MS, "a blink must survive one fast tick");
  assert.equal(expressionTickDelay([resting], Number.NaN, true), LIVE_TICK_MS);
  assert.equal(expressionTickDelay([resting], 0, false, true), FAST_TICK_MS, "the oracle's lip-sync runs on the fast clock");
});

test("mergeRuns returns a fresh copy of the previous set when nothing arrives", () => {
  const previous = [run({ runId: "r1" })];
  const merged = mergeRuns(previous, []);
  assert.deepEqual(merged, previous);
  assert.notEqual(merged, previous, "the retained set must not be aliased");
  assert.deepEqual(mergeRuns([], []), []);
});

test("mergeRuns updates a run in place and moves it to the end", () => {
  const first = run({ runId: "r1", status: "running" });
  const second = run({ runId: "r2", status: "running" });
  const updated = run({ runId: "r1", status: "success" });
  const merged = mergeRuns([first, second], [updated]);
  assert.deepEqual(merged.map((entry) => entry.runId), ["r2", "r1"]);
  assert.equal(merged.at(-1), updated, "the newest entry stays last");
});

test("mergeRuns accumulates runs reported by later orchestrate calls", () => {
  const previous = [run({ runId: "r1", taskId: "TASK-1", role: "worker", status: "success" })];
  const incoming = [run({ runId: "q1", taskId: "TASK-2", domain: "qa", role: "reviewer", status: "running" })];
  const merged = mergeRuns(previous, incoming);
  assert.deepEqual(merged.map((entry) => entry.runId), ["r1", "q1"]);
});

test("mergeRuns caps retention and keeps the newest runs", () => {
  const incoming = Array.from({ length: MAX_RETAINED_RUNS + 10 }, (_value, index) => run({ runId: `r${index}` }));
  const merged = mergeRuns([], incoming);
  assert.equal(merged.length, MAX_RETAINED_RUNS);
  assert.equal(merged[0]!.runId, "r10");
  assert.equal(merged.at(-1)!.runId, `r${MAX_RETAINED_RUNS + 9}`);
});

test("persisted worker records replay the checklist after a reload, and live copies win", () => {
  const record = (runId: string, instruction: string, minute: number) => ({
    runId,
    domain: "backend" as const,
    instruction,
    status: "success" as const,
    startedAt: `2026-01-01T00:0${minute}:00.000Z`,
    finishedAt: `2026-01-01T00:0${minute}:30.000Z`,
  });
  const reloaded = task({ plan: "1. First thing\n2. Second thing\n3. Third thing", workerRuns: [record("w1", "Step 1", 1), record("w2", "Step 2", 2)] });
  const runs = persistedRuns(reloaded);
  assert.deepEqual(runs.map((entry) => [entry.runId, entry.role, entry.taskId]), [["w1", "worker", "TASK-1"], ["w2", "worker", "TASK-1"]]);
  assert.deepEqual(planChecklist(reloaded.plan!, runs).map((step) => step.status), ["done", "done", "current"]);
  const live = run({ runId: "w2", role: "worker", status: "success", instruction: "Step 2", activity: "editing", startedAt: "2026-01-01T00:02:00.000Z" });
  const merged = mergeRuns(runs, [live]);
  assert.equal(merged.length, 2, "the live copy replaces its persisted record");
  assert.equal(merged.at(-1)!.activity, "editing");
  assert.deepEqual(persistedRuns(task()), []);
  assert.deepEqual(persistedRuns(undefined), []);
});

import { isReaction, situationKey } from "../src/pi/ui.ts";

test("agents react to starting, finishing, failing, flags and handovers, but not to going idle", () => {
  const working = situationKey({ status: "working" });
  assert.equal(isReaction(undefined, { status: "working" }), false, "no reaction on the first sighting");
  assert.equal(isReaction(situationKey({ status: "idle" }), { status: "working" }), true, "starts work");
  assert.equal(isReaction(working, { status: "done" }), true, "finishes");
  assert.equal(isReaction(working, { status: "failed" }), true, "fails");
  assert.equal(isReaction(working, { status: "working", flag: "quiet" }), true, "goes quiet");
  assert.equal(isReaction(working, { status: "working", flag: "waiting" }), true, "starts waiting");
  assert.equal(isReaction(working, { status: "working", handover: true }), true, "receives a file");
  assert.equal(isReaction(situationKey({ status: "working", flag: "quiet" }), { status: "working" }), false, "a flag clearing is quiet");
  assert.equal(isReaction(situationKey({ status: "done" }), { status: "idle" }), false, "going idle is quiet");
  assert.equal(isReaction(working, { status: "working" }), false, "no change, no reaction");
});
