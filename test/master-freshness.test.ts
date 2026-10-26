import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkerAssignment } from "../src/execution/assignment.ts";
import { recordFileNotes } from "../src/knowledge/file-notes.ts";
import { runWorker, type WorkerFreshness, type WorkerRequest } from "../src/master/master.ts";
import { resolveConfig } from "../src/schemas/configuration.ts";

function assignment(path = "source.ts"): WorkerAssignment {
  return {
    id: "inspect-source", revision: 1, objective: "Inspect source",
    actions: [{ step: 1, instruction: "Read the assigned source" }],
    files: [{ path, access: "reference", purpose: "Current source" }],
    contracts: [], constraints: [], exclusions: [], tools: [],
    verification: ["Report observed source"], evidence: [], completedWork: [], needs: [],
  };
}

function request(root: string): WorkerRequest {
  return {
    taskId: "TASK-1", domain: "backend", instruction: "Inspect source", taskText: "Read source",
    scoutOutcomes: [], cwd: root, dataRoots: [join(root, "data")],
    board: join(root, "board.jsonl"), boardFrom: "backend:dependent",
    config: resolveConfig({ workflow: { knowledgeRetrieval: false, maxAgentRetries: 0 } }),
    assignment: assignment(),
  };
}

test("assigned dispatch labels local hints, rejects stale acceptance and notifies only the dependent worker/master", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-freshness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "source.ts"), "old source");
  await recordFileNotes(join(root, "data"), root, "backend", [{ path: "source.ts", reason: "Local source navigation" }]);
  await writeFile(join(root, "source.ts"), "new source");
  const statuses: WorkerFreshness[] = [];
  let processes = 0;
  const outcome = await runWorker({ ...request(root), onFreshness: (status) => { statuses.push(status); } }, async () => {
    processes++;
    throw new Error("Assigned native execution must remain refused");
  });
  assert.equal(processes, 0);
  assert.equal(statuses[0]?.status, "unverified hints");
  assert.equal(outcome.freshness?.status, "invalidated");
  assert.ok(outcome.issues.some((issue) => issue.includes("acceptance requires current verified hints")));
  const posts = (await readFile(join(root, "board.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(posts.some((post) => post.kind === "blocker" && /Pause only dependent work/.test(post.text)));
  assert.ok(posts.every((post) => JSON.stringify(post.to) === JSON.stringify(["oracle", "backend:dependent"])));
  assert.ok(statuses.some((status) => status.pause && status.status === "invalidated"));
});

test("assigned dispatch verifies only relevant file notes through unrelated changes and normalizes exact paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-freshness-local-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "source.ts"), "source");
  await writeFile(join(root, "unrelated.ts"), "old");
  await recordFileNotes(join(root, "data"), root, "backend", [
    { path: "source.ts", reason: "Source navigation" }, { path: "unrelated.ts", reason: "Unrelated navigation" },
  ]);
  await writeFile(join(root, "unrelated.ts"), "changed");
  const outcome = await runWorker({ ...request(root), assignment: assignment(join(root, "source.ts")) }, async () => {
    throw new Error("Assigned native execution must remain refused");
  });
  assert.equal(outcome.freshness?.status, "verified");
  assert.deepEqual(outcome.freshness?.hintIds, ["file-note:source.ts"]);
  assert.equal(outcome.freshness?.hints?.[0]?.source, "source.ts");
  assert.equal(outcome.freshness?.hints?.[0]?.scope, "file");
  assert.ok(outcome.freshness?.hints?.[0]?.fingerprint);
  assert.ok(!outcome.issues.some((issue) => issue.includes("Assignment evidence")));
  // Verified hints never convert the installed runtime's explicit refusal into success.
  assert.notEqual(outcome.run.status, "success");
});

test("explicit null assignment rejects before any process fallback", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-freshness-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let processes = 0;
  await assert.rejects(runWorker({ ...request(root), assignment: null as unknown as WorkerAssignment }, async () => {
    processes++;
    throw new Error("must not dispatch");
  }), /Invalid worker assignment/);
  assert.equal(processes, 0);
});

test("unassigned worker dispatch retains its existing process path and emits no freshness events", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-freshness-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = request(root);
  delete input.assignment;
  let processes = 0;
  let statuses = 0;
  const outcome = await runWorker({ ...input, onFreshness: () => { statuses++; } }, async () => {
    processes++;
    return { exitCode: 1, stdout: "", stderr: "expected fixture failure", killed: false };
  });
  assert.equal(processes, 1);
  assert.equal(statuses, 0);
  assert.equal(outcome.freshness, undefined);
});
