import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, type Task } from "../src/schemas/task.ts";
import { captureCheckpoint, checkpointTaskStatus, persistedRunMarks, reconcileCheckpoint, type TaskCheckpoint } from "../src/state/checkpoint.ts";
import type { BookmarkRecord } from "../src/knowledge/bookmarks.ts";

const allow = () => true;
function fixture(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), "checkpoint-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, task: createTask("TASK-1", "Title", "2026-01-01", "objective") };
}

const bookmark: BookmarkRecord = { ref: "K-example-1", recipient: "DEV", authority: "oracle", reason: "evidence only", sourceVersion: "1", revision: 1, at: "2026-01-01" };

test("checkpoint bounds previews and records while retaining constraint references only", (t) => {
  const { cwd, task } = fixture(t);
  task.request = "x".repeat(1000);
  task.plan = "secret full plan";
  task.amendments = Array.from({ length: 20 }, (_, i) => `amendment ${i}`);
  task.workerRuns = Array.from({ length: 12 }, (_, i) => ({ runId: `run-${i}`, domain: "backend", instruction: "not copied", status: "success", startedAt: "now" }));
  const checkpoint = captureCheckpoint(task, cwd, { bookmarks: Array(20).fill(bookmark), ownershipRefs: Array(20).fill("desk:claim") });
  assert.equal(checkpoint.objective.preview.length, 800);
  assert.equal(checkpoint.objective.omittedChars, 200);
  assert.deepEqual(checkpoint.completedRunIds.items, Array.from({ length: 8 }, (_, i) => `run-${i + 4}`));
  assert.equal(checkpoint.constraints.amendments.omitted, 12);
  assert.equal(checkpoint.bookmarks.omitted, 4);
  assert.equal(checkpoint.ownership.omitted, 4);
  assert.equal(JSON.stringify(checkpoint).includes(task.plan), false);
  assert.equal(JSON.stringify(checkpoint).includes("not copied"), false);
});

test("reconciliation checks assignment, task, worktree, amendments and current action without authorization side effects", (t) => {
  const { cwd, task } = fixture(t);
  const checkpoint = captureCheckpoint(task, cwd, { assignment: "step A" });
  let authorizations = 0;
  const context = { cwd, task, assignment: "step A", authorize: () => { authorizations++; return true; } };
  assert.equal(reconcileCheckpoint(checkpoint, context).status, "current");
  const other = join(cwd, "other");
  mkdirSync(other);
  for (const changed of [{ assignment: "step B" }, { cwd: other }, { task: { ...task, id: "TASK-2" } }, { task: { ...task, amendments: ["correction"] } }, { task: { ...task, paused: true } }]) {
    assert.equal(reconcileCheckpoint(checkpoint, { ...context, ...changed }).status, "stale-context");
  }
  assert.equal(authorizations, 0);
});

test("bounded authorized fingerprints detect changes and reject symlinks, escapes and oversized files", (t) => {
  const { cwd, task } = fixture(t);
  writeFileSync(join(cwd, "code.ts"), "before");
  writeFileSync(join(cwd, "large"), Buffer.alloc(256 * 1024 + 1));
  symlinkSync(join(cwd, "code.ts"), join(cwd, "link"));
  writeFileSync(join(cwd, "private"), "do not fingerprint through an alias");
  linkSync(join(cwd, "private"), join(cwd, "alias"));
  const inputs = ["code.ts", "link", "large", "../outside", "alias"];
  assert.equal(captureCheckpoint(task, cwd, { changedFiles: inputs }).verification.sources.items.length, 0);
  const checkpoint = captureCheckpoint(task, cwd, { changedFiles: inputs, authorize: allow });
  assert.equal(checkpoint.verification.sources.omitted, 4);
  assert.equal(reconcileCheckpoint(checkpoint, { cwd, task, authorize: allow }).sources[0]?.status, "unchanged");
  writeFileSync(join(cwd, "code.ts"), "after");
  assert.equal(reconcileCheckpoint(checkpoint, { cwd, task, authorize: allow }).sources[0]?.status, "changed-or-unavailable");
  rmSync(join(cwd, "code.ts"));
  assert.equal(reconcileCheckpoint(checkpoint, { cwd, task, authorize: allow }).sources[0]?.status, "changed-or-unavailable");
});

test("revocation filters all references; bookmarks require independent revalidation and never open sources", (t) => {
  const { cwd, task } = fixture(t);
  task.goalCheck = { key: "diff-hash", verdict: "met", gaps: [], at: "now" };
  writeFileSync(join(cwd, "code.ts"), "authorized at capture");
  const checkpoint = captureCheckpoint(task, cwd, { changedFiles: ["code.ts"], authorize: allow, bookmarks: [bookmark], artifactRefs: ["artifact:1"], ownershipRefs: ["desk:1"], deliveryRefs: ["board:1"] });
  const before = JSON.stringify(checkpoint);
  const denied = reconcileCheckpoint(checkpoint, { cwd, task, authorize: () => false });
  assert.deepEqual([denied.sources, denied.bookmarks, denied.artifacts, denied.ownership, denied.delivery], [[], [], [], [], []]);
  assert.equal(denied.requiresBookmarkRevalidation, true);
  const granted = reconcileCheckpoint(checkpoint, { cwd, task, authorize: allow });
  assert.deepEqual(granted.ownership, ["desk:1"]);
  assert.equal(granted.evidence[0]?.status, "recorded");
  task.goalCheck.verdict = "not_met";
  assert.equal(reconcileCheckpoint(checkpoint, { cwd, task, authorize: allow }).evidence[0]?.status, "changed-or-unavailable");
  assert.equal(JSON.stringify(checkpoint), before);
  assert.deepEqual(reconcileCheckpoint(checkpoint, { cwd, task, authorize: () => { throw Error("revoked"); } }).bookmarks, []);
});

test("the checkpoint is versioned derived state with a single owner: the task record alone", (t) => {
  const { cwd, task } = fixture(t);
  const before = readdirSync(cwd).sort();
  const checkpoint = captureCheckpoint(task, cwd, { assignment: "step A" });
  assert.equal(checkpoint.version, 1);
  assert.deepEqual(readdirSync(cwd).sort(), before, "capturing writes nothing: the task record stays the sole store");
  const context = { cwd, task, assignment: "step A", authorize: allow };
  assert.equal(reconcileCheckpoint(checkpoint, context).status, "current");
  const unknown = { ...checkpoint, version: 2 } as unknown as TaskCheckpoint;
  assert.equal(checkpointTaskStatus(unknown, task), "stale-task-state", "a checkpoint of an unknown schema version is not authoritative");
  const denied = reconcileCheckpoint(unknown, context);
  assert.equal(denied.status, "stale-context");
  assert.deepEqual([denied.sources, denied.bookmarks, denied.artifacts, denied.ownership, denied.delivery], [[], [], [], [], []]);
});

test("an unmatched context hands back no references at all, and bookmark claims never come back from a checkpoint", (t) => {
  const { cwd, task } = fixture(t);
  writeFileSync(join(cwd, "code.ts"), "settled");
  const checkpoint = captureCheckpoint(task, cwd, {
    assignment: "step A",
    changedFiles: ["code.ts"],
    bookmarks: [bookmark],
    artifactRefs: ["O-1"],
    ownershipRefs: ["desk:claim"],
    deliveryRefs: ["board:1"],
    authorize: allow,
  });
  const context = { cwd, task, assignment: "step A", authorize: allow };
  const granted = reconcileCheckpoint(checkpoint, context);
  assert.equal(granted.status, "current");
  assert.equal(granted.requiresBookmarkRevalidation, true, "even a clean reconcile never restores bookmark claims");
  const other = join(cwd, "other");
  mkdirSync(other);
  const mismatches: Array<[string, Partial<typeof context>]> = [
    ["assignment", { assignment: "step B" }],
    ["worktree", { cwd: other }],
    ["task id", { task: { ...task, id: "TASK-2" } }],
    ["amendments", { task: { ...task, amendments: ["User correction"] } }],
    ["paused", { task: { ...task, paused: true } }],
    ["state", { task: { ...task, state: "reviewing" as Task["state"] } }],
  ];
  for (const [what, changed] of mismatches) {
    const blocked = reconcileCheckpoint(checkpoint, { ...context, ...changed });
    assert.equal(blocked.status, "stale-context", `a changed ${what} blocks resumption`);
    assert.deepEqual(
      [blocked.sources, blocked.bookmarks, blocked.artifacts, blocked.ownership, blocked.delivery],
      [[], [], [], [], []],
      `a changed ${what} leaves no references to resume from`,
    );
  }
});

test("run marks separate settled from in-flight work, and a revoked resume replays nothing", (t) => {
  const { cwd, task } = fixture(t);
  task.workerRuns = [
    { runId: "run-1", domain: "backend", instruction: "not copied", status: "success", startedAt: "t1" },
    { runId: "run-2", domain: "backend", instruction: "not copied", status: "failed", startedAt: "t2" },
    { runId: "run-3", domain: "backend", instruction: "not copied", status: "running", startedAt: "t3" },
    { runId: "run-4", domain: "backend", instruction: "not copied", status: "success", startedAt: "t4" },
  ];
  const checkpoint = captureCheckpoint(task, cwd, { bookmarks: [bookmark], artifactRefs: ["O-1"], authorize: allow });
  assert.deepEqual(checkpoint.completedRunIds.items, ["run-1", "run-2", "run-4"], "only settled runs are marked complete: the in-flight run stays unsettled after a crash");
  assert.deepEqual(persistedRunMarks(checkpoint, () => true), ["run-1", "run-2", "run-4"]);
  assert.deepEqual(persistedRunMarks(checkpoint, (ref) => ref !== "run-1"), ["run-2", "run-4"], "a mark read through revoked access disappears");
  assert.deepEqual(persistedRunMarks(undefined, () => true), [], "a worker without a checkpoint replays from none");
  const resumed = reconcileCheckpoint(checkpoint, { cwd, task, authorize: () => false });
  assert.deepEqual([resumed.bookmarks, resumed.artifacts], [[], []]);
  assert.equal(resumed.requiresBookmarkRevalidation, true);
  assert.deepEqual(persistedRunMarks(checkpoint, () => false), [], "a fully revoked resume marks nothing as already run");
});
