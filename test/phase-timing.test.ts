import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../src/schemas/task.ts";
import { blockPhaseTiming, projectPhaseTiming, resolvePhaseTiming } from "../src/state/phase-timing.ts";
import { transition } from "../src/state/task-state.ts";
import { createTaskDir, loadTask, saveTask } from "../src/state/persistence.ts";
import { updateBlockingRequest, withBlockingRequest } from "../src/state/blocking-requests.ts";
import { requestApproval, resolveApproval } from "../src/workflow/approvals.ts";

const at = (seconds: number) => new Date(seconds * 1000).toISOString();

test("phase clock pauses across overlapping waits, resets on transitions and stops terminal", () => {
  const task = createTask("T", "Timing", at(0));
  blockPhaseTiming(task, "a", at(2));
  blockPhaseTiming(task, "b", at(4));
  assert.equal(task.phaseTiming!.elapsedMs, 2000);
  transition(task, "clarifying", at(5));
  assert.deepEqual(task.phaseTiming, { phase: "clarifying", elapsedMs: 0, blockingRequestIds: ["a", "b"] });
  resolvePhaseTiming(task, "a", at(6));
  assert.equal(task.phaseTiming!.runningSince, undefined);
  resolvePhaseTiming(task, "b", at(8));
  assert.equal(task.phaseTiming!.runningSince, at(8));
  blockPhaseTiming(task, "c", at(9));
  assert.equal(task.phaseTiming!.elapsedMs, 1000);
  assert.equal(projectPhaseTiming(task, at(99))!.waiting, true);
  transition(task, "abandoned", at(10));
  resolvePhaseTiming(task, "c", at(11));
  assert.equal(task.phaseTiming!.runningSince, undefined);
});

test("legacy timing is unavailable until a genuine phase transition", () => {
  const task = createTask("T", "Legacy", at(0));
  delete task.phaseTiming;
  assert.equal(projectPhaseTiming(task), undefined);
  blockPhaseTiming(task, "a", at(2));
  assert.equal(projectPhaseTiming(task), undefined);
  transition(task, "clarifying", at(3));
  assert.deepEqual(task.phaseTiming, { phase: "clarifying", elapsedMs: 0, blockingRequestIds: ["a"] });
  resolvePhaseTiming(task, "a", at(4));
  assert.equal(projectPhaseTiming(task)!.runningSince, at(4));
});

test("reload and stale workflow saves preserve authoritative overlapping waits", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-phase-"));
  const identity = { root, configDir: ".pi", taskId: "T", sessionId: "owner" };
  try {
    createTaskDir(root, ".pi", createTask("T", "Timing", new Date().toISOString(), "Timing", "owner"));
    const legacy = loadTask(root, ".pi", "T")!;
    delete legacy.phaseTiming;
    saveTask(root, ".pi", legacy);
    const stale = loadTask(root, ".pi", "T")!;
    updateBlockingRequest(identity, "a", true);
    updateBlockingRequest(identity, "b", true);
    stale.decisions.push({ domain: "master", text: "keep work", createdAt: at(1) });
    saveTask(root, ".pi", stale);
    assert.equal(loadTask(root, ".pi", "T")!.phaseTiming, undefined);
    assert.deepEqual(loadTask(root, ".pi", "T")!.blockingRequestIds, ["a", "b"]);
    transition(stale, "clarifying");
    saveTask(root, ".pi", stale);
    assert.deepEqual(loadTask(root, ".pi", "T")!.phaseTiming!.blockingRequestIds, ["a", "b"]);
    updateBlockingRequest(identity, "a", false);
    saveTask(root, ".pi", stale);
    assert.equal(loadTask(root, ".pi", "T")!.phaseTiming!.runningSince, undefined);
    updateBlockingRequest(identity, "b", false);
    saveTask(root, ".pi", stale);
    assert.ok(loadTask(root, ".pi", "T")!.phaseTiming!.runningSince);
    await assert.rejects(withBlockingRequest(identity, async () => { throw new Error("cancelled"); }), /cancelled/);
    assert.deepEqual(loadTask(root, ".pi", "T")!.phaseTiming!.blockingRequestIds, []);
    updateBlockingRequest({ ...identity, sessionId: "intruder" }, "x", true);
    assert.deepEqual(loadTask(root, ".pi", "T")!.phaseTiming!.blockingRequestIds, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("persisted approvals overlap rather than prematurely resuming execution", () => {
  const task = createTask("T", "Timing", at(0));
  const a = requestApproval(task, "dependency", "backend", "A", at(1));
  const b = requestApproval(task, "architecture", "backend", "B", at(2));
  resolveApproval(task, a.id, "approved");
  assert.deepEqual(task.phaseTiming!.blockingRequestIds, [`approval:${b.id}`]);
  assert.equal(task.phaseTiming!.runningSince, undefined);
  resolveApproval(task, b.id, "rejected");
  assert.ok(task.phaseTiming!.runningSince);
});
