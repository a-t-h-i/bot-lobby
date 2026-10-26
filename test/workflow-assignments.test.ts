import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { ASSIGNMENT_ENV } from "../src/pi/assignment-guard.ts";
import { assignedSessionFile } from "../src/execution/assigned-session.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkerAssignment } from "../src/execution/assignment.ts";
import { validateAssignment } from "../src/execution/assignment.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask } from "../src/schemas/task.ts";
import { checkWorkerAssignments, createTaskDir, ensureProjectStructure, loadTask, recordWorkerAssignments, saveTask, taskDirFor } from "../src/state/persistence.ts";
import { describeTask, workerAssignmentHolds, runWorkflowAction, type WorkflowDeps } from "../src/workflow/workflow.ts";
import { WorkerAssignmentSchema } from "../src/pi/tools.ts";
import { readAssignmentDiscovery } from "../src/execution/assignment-discovery.ts";
import { contentHash } from "../src/knowledge/file-notes.ts";

function brief(id = "backend-step"): WorkerAssignment {
  return {
    id, revision: 1, objective: "Step 1: inspect the source",
    actions: [{ step: 1, instruction: "Read source.ts and report the contract" }],
    files: [{ path: "source.ts", access: "reference", purpose: "Inspect existing behavior" }],
    contracts: [], constraints: ["No edits"], exclusions: [], tools: [],
    verification: ["Report the observed contract"], evidence: [], completedWork: [], needs: [],
    discoveryLimit: 2,
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "workflow-assignments-"));
  writeFileSync(join(root, "source.ts"), "export const value = 1;\n");
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-assignments", "Inspect source");
  task.state = "planning";
  createTaskDir(root, ".pi", task);
  let calls = 0;
  const deps: WorkflowDeps = {
    root, cwd: root, configDir: ".pi", config: DEFAULT_CONFIG,
    ask: async () => undefined, choose: async () => undefined, notify: () => {},
    runProcess: async () => { calls++; throw new Error("Assigned execution must remain disabled"); },
  };
  return { root, task, deps, calls: () => calls, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("orchestrate schema exposes the exact assignment keys and closed nested shapes", () => {
  const closed = (schema: unknown) => (schema as { additionalProperties?: boolean }).additionalProperties;
  assert.equal(closed(WorkerAssignmentSchema), false);
  assert.deepEqual(Object.keys(WorkerAssignmentSchema.properties).sort(), Object.keys(brief()).sort());
  assert.equal(closed(WorkerAssignmentSchema.properties.files.items), false);
  assert.equal(closed(WorkerAssignmentSchema.properties.needs.items), false);
});

test("implement rejects invalid explicit briefs without process fallback", async () => {
  const f = fixture();
  try {
    for (const workerAssignment of [null, { ...brief(), files: [{ path: "../outside", access: "edit", purpose: "bad" }] }]) {
      const result = await runWorkflowAction({ action: "implement", taskId: f.task.id, domain: "backend", task: "Legacy prose", workerAssignment: workerAssignment as WorkerAssignment }, f.deps);
      assert.equal(result.ok, false);
      assert.match(result.message, /assignment|outside project scope/i);
      assert.equal(f.calls(), 0);
      assert.equal(loadTask(f.root, ".pi", f.task.id)?.workerAssignments, undefined);
    }
  } finally { f.cleanup(); }
});

test("parallel preflight validates the entire batch before persisting any brief", async () => {
  const f = fixture();
  try {
    const result = await runWorkflowAction({ action: "implement", taskId: f.task.id, assignments: [
      { domain: "backend", workerAssignment: brief() },
      { domain: "designer", workerAssignment: { ...brief("designer-step"), files: [{ path: "missing.ts", access: "reference", purpose: "missing" }] } },
    ] }, f.deps);
    assert.equal(result.ok, false);
    assert.match(result.message, /missing.ts/);
    assert.equal(f.calls(), 0);
    assert.equal(loadTask(f.root, ".pi", f.task.id)?.workerAssignments, undefined);
  } finally { f.cleanup(); }
});

test("a valid reference-only brief runs under its guard, succeeds without edits and keeps its conversation", async () => {
  const f = fixture();
  try {
    const report = ["## Completed", "Read source.ts: it exports value = 1.", "## Files Changed", "## Verification", "- Report the observed contract — value is 1", "## Brief Check", "- Report the observed contract — met — source.ts:1", "## Notes", "None.", "## Blockers", "None."].join("\n");
    let guard: { tools: string[]; attestation: string; assignmentId: string; revision: number } | undefined;
    f.deps.runProcess = async (_args, options) => {
      guard = JSON.parse(options.env![ASSIGNMENT_ENV]!);
      writeFileSync(guard!.attestation, JSON.stringify({ assignmentId: guard!.assignmentId, revision: guard!.revision, allowed: guard!.tools, declared: guard!.tools, blockedCallable: [], unauthorized: [], ok: true }));
      return { exitCode: 0, killed: false, stderr: "", stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: report }], stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } }) };
    };
    const result = await runWorkflowAction({ action: "implement", taskId: f.task.id, domain: "backend", workerAssignment: { ...brief(), tools: [{ name: "read", purpose: "Read the source" }] } }, f.deps);
    const saved = loadTask(f.root, ".pi", f.task.id)!;
    assert.deepEqual(guard?.tools, ["read"], "an empty or narrow selection is not widened");
    const outcome = saved.workerAssignments?.[0]?.outcomes[0];
    assert.equal(outcome?.status, "success", result.message);
    assert.deepEqual(outcome?.issues, []);
    assert.match(describeTask(saved), /backend-step r1.*success/);
    assert.ok(existsSync(assignedSessionFile({ taskDir: taskDirFor(f.root, ".pi", f.task.id), assignmentId: "backend-step" })));
  } finally { f.cleanup(); }
});

test("an ungranted tool selection fails the run with an actionable error and never starts a process", async () => {
  const f = fixture();
  try {
    const result = await runWorkflowAction({ action: "implement", taskId: f.task.id, domain: "backend", workerAssignment: { ...brief(), tools: [{ name: "mcp__nowhere__thing", purpose: "x" }] } }, f.deps);
    assert.equal(f.calls(), 0);
    const outcome = loadTask(f.root, ".pi", f.task.id)!.workerAssignments?.[0]?.outcomes[0];
    assert.equal(outcome?.status, "failed", result.message);
    assert.match(result.message, /unknown tool mcp__nowhere__thing/);
  } finally { f.cleanup(); }
});

test("durable revisions reject stale/conflicting/domain changes and retain full history", async () => {
  const f = fixture();
  try {
    const assignment = await validateAssignment(brief(), f.root);
    recordWorkerAssignments(f.task, [{ domain: "backend", assignment }]);
    assert.doesNotThrow(() => checkWorkerAssignments(f.task, [{ domain: "backend", assignment: structuredClone(assignment) }]));
    assert.throws(() => checkWorkerAssignments(f.task, [{ domain: "backend", assignment: { ...assignment, objective: "changed" } }]), /Conflicting/);
    assert.throws(() => checkWorkerAssignments(f.task, [{ domain: "designer", assignment }]), /domain stable/);
    assert.throws(() => checkWorkerAssignments(f.task, [{ domain: "backend", assignment }, { domain: "designer", assignment }]), /Duplicate/);
    const revision = { ...assignment, revision: 2, completedWork: ["Inspected source"], needs: [{ kind: "tools" as const, reason: "Need a reader", requested: ["read"] }] };
    recordWorkerAssignments(f.task, [{ domain: "backend", assignment: revision }]);
    assert.throws(() => checkWorkerAssignments(f.task, [{ domain: "backend", assignment }]), /Stale/);
    // Approval is enforced at workflow preflight, not by the pure history validator.
    assert.doesNotThrow(() => checkWorkerAssignments(f.task, [{ domain: "backend", assignment: { ...revision, revision: 3, discoveryLimit: 3 } }]));
    saveTask(f.root, ".pi", f.task);
    const saved = loadTask(f.root, ".pi", f.task.id)!;
    assert.deepEqual(saved.workerAssignments?.[0]?.revisions, [assignment, revision]);
    assert.match(describeTask(saved), /Need a reader/);
  } finally { f.cleanup(); }
});

test("stale task saves retain newer briefs and independently recorded outcomes", () => {
  const f = fixture();
  try {
    recordWorkerAssignments(f.task, [{ domain: "backend", assignment: brief() }]);
    saveTask(f.root, ".pi", f.task);
    const stale = loadTask(f.root, ".pi", f.task.id)!;
    const current = loadTask(f.root, ".pi", f.task.id)!;
    recordWorkerAssignments(current, [{ domain: "backend", assignment: { ...brief(), revision: 2 } }]);
    saveTask(f.root, ".pi", current);
    stale.workerAssignments![0]!.outcomes.push({ revision: 1, runId: "old-run", status: "success", completedWork: ["Read contract"], needs: [] });
    saveTask(f.root, ".pi", stale);
    const saved = loadTask(f.root, ".pi", f.task.id)!.workerAssignments![0]!;
    assert.equal(saved.brief.revision, 2);
    assert.equal(saved.revisions.length, 2);
    assert.equal(saved.outcomes[0]!.runId, "old-run");
  } finally { f.cleanup(); }
});

test("omitted assignment retains legacy dispatch without persisting a structured brief", async () => {
  const f = fixture();
  try {
    let dispatched = 0;
    f.deps.config = { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false, maxAgentRetries: 0 } };
    f.deps.runProcess = async () => {
      dispatched++;
      return { exitCode: 0, stdout: "", stderr: "", killed: false };
    };
    await runWorkflowAction({ action: "implement", taskId: f.task.id, domain: "backend", task: "Inspect source" }, f.deps);
    assert.ok(dispatched > 0);
    assert.equal(loadTask(f.root, ".pi", f.task.id)?.workerAssignments, undefined);
  } finally { f.cleanup(); }
});

test("master allowance validates current identity and durably audits before approval", async () => {
  const f = fixture();
  try {
    recordWorkerAssignments(f.task, [{ domain: "backend", assignment: brief() }]);
    saveTask(f.root, ".pi", f.task);
    const allowance = { assignmentId: brief().id, revision: 1, decisionId: "D1", reason: "Need callers", limit: 4 };
    const decide = (extra = {}) => runWorkflowAction({ action: "decide", taskId: f.task.id, discoveryAllowance: allowance, ...extra }, f.deps);
    assert.equal((await decide({ domain: "backend" })).ok, false);
    assert.equal((await decide({ discoveryAllowance: { ...allowance, revision: 2 } })).ok, false);
    const result = await decide();
    assert.equal(result.ok, true, result.message);
    const saved = loadTask(f.root, ".pi", f.task.id)!;
    assert.ok(saved.decisions.some((entry) => entry.domain === "master" && entry.text.includes(JSON.stringify(allowance))));
    assert.deepEqual(saved.decisions.at(-1)!.discoveryAllowance, allowance);
    const ledger = await readAssignmentDiscovery(taskDirFor(f.root, ".pi", f.task.id), allowance.assignmentId, 1);
    assert.equal(ledger.limit, 4);
    assert.deepEqual(ledger.decisions, [{ decisionId: "D1", reason: "Need callers", limit: 4 }]);
    assert.equal((await decide()).ok, true);
  } finally { f.cleanup(); }
});

test("latest outcome acceptance requires issues, freshness, resolved needs and edit verification", () => {
  const f = fixture();
  try {
    recordWorkerAssignments(f.task, [{ domain: "backend", assignment: brief() }]);
    const record = f.task.workerAssignments![0]!;
    assert.equal(workerAssignmentHolds(f.task).length, 1);
    record.outcomes.push({ revision: 1, runId: "R1", status: "success", completedWork: [], needs: [], issues: [], verification: "", freshness: { assignmentId: brief().id, revision: 1, status: "verified", hintIds: [], hints: [] } });
    assert.deepEqual(workerAssignmentHolds(f.task), []);
    record.outcomes[0]!.issues = ["invalid output"];
    assert.equal(workerAssignmentHolds(f.task).length, 1);
    record.outcomes[0]!.issues = [];
    record.brief = { ...brief(), revision: 2 };
    assert.equal(workerAssignmentHolds(f.task).length, 1);
    record.brief = { ...brief(), files: [{ path: "source.ts", access: "edit", purpose: "Change source" }] };
    assert.equal(workerAssignmentHolds(f.task).length, 1);
    record.outcomes[0]!.verification = "Read resulting source";
    assert.deepEqual(workerAssignmentHolds(f.task), []);
  } finally { f.cleanup(); }
});

test("completion invalidates changed evidence before review or completion side effects", async () => {
  const f = fixture();
  try {
    recordWorkerAssignments(f.task, [{ domain: "backend", assignment: brief() }]);
    f.task.state = "reviewing";
    f.task.workerAssignments![0]!.outcomes.push({ revision: 1, runId: "R1", status: "success", completedWork: [], needs: [], issues: [], freshness: { assignmentId: brief().id, revision: 1, status: "verified", hintIds: ["source"], hints: [{ id: "source", scope: "file", source: "source.ts", fingerprint: (await contentHash(f.root, "source.ts"))! }] } });
    saveTask(f.root, ".pi", f.task);
    writeFileSync(join(f.root, "source.ts"), "changed source");
    const result = await runWorkflowAction({ action: "complete", taskId: f.task.id }, f.deps);
    assert.equal(result.ok, false);
    assert.match(result.message, /issue-free latest outcome/);
    const saved = loadTask(f.root, ".pi", f.task.id)!;
    assert.equal(saved.workerAssignments![0]!.outcomes[0]!.freshness!.status, "invalidated");
    assert.match(saved.workerAssignments![0]!.outcomes[0]!.issues!.join(), /Evidence changed/);
  } finally { f.cleanup(); }
});

test("a structured assignment for a domain on a third-party harness is refused before anything is recorded", async () => {
  const f = fixture();
  try {
    f.deps.profile = (domain, role) => ({ kind: domain, model: "inherit", thinking: "medium", harness: { kind: "codex" } } as never);
    const result = await runWorkflowAction({ action: "implement", taskId: f.task.id, domain: "backend", workerAssignment: brief() }, f.deps);
    assert.equal(result.ok, false);
    assert.match(result.message, /third-party harness.*prose task/);
    assert.equal(f.calls(), 0);
    assert.equal(loadTask(f.root, ".pi", f.task.id)?.workerAssignments, undefined);
  } finally { f.cleanup(); }
});
