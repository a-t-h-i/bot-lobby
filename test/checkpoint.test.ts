import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../src/schemas/task.ts";
import { captureCheckpoint, reconcileCheckpoint } from "../src/state/checkpoint.ts";
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
