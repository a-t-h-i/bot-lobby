import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkerAssignment } from "../src/execution/assignment.ts";
import { createTask, type WorkerAssignmentRecord } from "../src/schemas/task.ts";
import { checkWorkerAssignments, createTaskDir, loadTask, recordWorkerAssignments, saveTask } from "../src/state/persistence.ts";

function brief(revision = 1, discoveryLimit = 2): WorkerAssignment {
  return {
    id: "backend-inspection", revision, discoveryLimit, objective: "Inspect source contract",
    actions: [{ step: 1, instruction: "Read source.ts" }],
    files: [{ path: "source.ts", access: "reference", purpose: "Existing contract" }],
    contracts: [], constraints: [], exclusions: [], tools: [],
    verification: ["Report the exported contract"], evidence: [], completedWork: [], needs: [],
  };
}

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "worker-assignment-persistence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const task = createTask("TASK-assignment-persistence", "Inspect source");
  createTaskDir(root, ".pi", task);
  recordWorkerAssignments(task, [{ domain: "backend", assignment: brief() }]);
  saveTask(root, ".pi", task);
  return { root, task };
}

function outcome(runId: string): WorkerAssignmentRecord["outcomes"][number] {
  return { revision: 1, runId, status: "success", completedWork: ["Inspected contract"], needs: [] };
}

test("assignment outcomes round-trip optional evidence without fabricating legacy evidence", (t) => {
  const { root, task } = fixture(t);
  const legacy = outcome("legacy");
  const evidenced = {
    ...outcome("current"), issues: ["Dependency evidence invalidated"], verification: "Read source.ts exports",
    freshness: {
      assignmentId: brief().id, revision: 1, status: "invalidated" as const,
      hintIds: ["file:source.ts"], pause: true as const, recheckCompletedWork: true,
    },
  };
  task.workerAssignments![0]!.outcomes.push(legacy, evidenced);
  saveTask(root, ".pi", task);
  const saved = loadTask(root, ".pi", task.id)!.workerAssignments![0]!.outcomes;
  assert.deepEqual(saved, [legacy, evidenced]);
  for (const field of ["issues", "verification", "freshness"]) assert.equal(Object.hasOwn(saved[0]!, field), false);
});

test("stale saves retain newer revisions and evidence-bearing independent outcomes", (t) => {
  const { root, task } = fixture(t);
  const stale = loadTask(root, ".pi", task.id)!;
  const current = loadTask(root, ".pi", task.id)!;
  recordWorkerAssignments(current, [{ domain: "backend", assignment: brief(2) }]);
  const verified = {
    ...outcome("new-run"), revision: 2, issues: [], verification: "Confirmed export",
    freshness: { assignmentId: brief().id, revision: 2, status: "verified" as const, hintIds: [] },
  };
  current.workerAssignments![0]!.outcomes.push(verified);
  saveTask(root, ".pi", current);
  stale.workerAssignments![0]!.outcomes.push(outcome("old-run"));
  saveTask(root, ".pi", stale);
  const saved = loadTask(root, ".pi", task.id)!.workerAssignments![0]!;
  assert.deepEqual(saved.revisions, [brief(), brief(2)]);
  assert.deepEqual(saved.brief, brief(2));
  assert.deepEqual(saved.outcomes, [verified, outcome("old-run")]);
  saveTask(root, ".pi", stale);
  assert.deepEqual(loadTask(root, ".pi", task.id)!.workerAssignments![0]!.outcomes, saved.outcomes);
});

test("outcome invalidation persists and cannot be undone by a stale save", (t) => {
  const { root, task } = fixture(t);
  task.workerAssignments![0]!.outcomes.push({ ...outcome("R1"), issues: [], freshness: { assignmentId: brief().id, revision: 1, status: "verified", hintIds: [], hints: [] } });
  saveTask(root, ".pi", task);
  const stale = loadTask(root, ".pi", task.id)!;
  const current = loadTask(root, ".pi", task.id)!;
  current.workerAssignments![0]!.outcomes[0]!.freshness!.status = "invalidated";
  current.workerAssignments![0]!.outcomes[0]!.issues = ["Evidence changed"];
  saveTask(root, ".pi", current);
  saveTask(root, ".pi", stale);
  const saved = loadTask(root, ".pi", task.id)!.workerAssignments![0]!.outcomes[0]!;
  assert.equal(saved.freshness!.status, "invalidated");
  assert.deepEqual(saved.issues, ["Evidence changed"]);
});

test("revised discovery limits leave authorization to workflow without relaxing identity safeguards", (t) => {
  const { root, task } = fixture(t);
  const raised = brief(2, 4);
  assert.doesNotThrow(() => checkWorkerAssignments(task, [{ domain: "backend", assignment: raised }]));
  recordWorkerAssignments(task, [{ domain: "backend", assignment: raised }]);
  assert.doesNotThrow(() => checkWorkerAssignments(task, [{ domain: "backend", assignment: structuredClone(raised) }]));
  assert.throws(() => checkWorkerAssignments(task, [{ domain: "backend", assignment: brief() }]), /Stale/);
  assert.throws(() => checkWorkerAssignments(task, [{ domain: "designer", assignment: raised }]), /domain stable/);
  assert.throws(() => checkWorkerAssignments(task, [{ domain: "backend", assignment: { ...raised, discoveryLimit: 5 } }]), /Conflicting/);
  assert.throws(() => checkWorkerAssignments(task, [{ domain: "backend", assignment: raised }, { domain: "backend", assignment: raised }]), /Duplicate/);
  saveTask(root, ".pi", task);
  assert.deepEqual(loadTask(root, ".pi", task.id)!.workerAssignments![0]!.revisions, [brief(), raised]);
});
