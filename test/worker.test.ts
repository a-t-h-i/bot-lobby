import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorkerResult, validateWorkerResult } from "../src/roles/worker.ts";
import { parseSections } from "../src/roles/markdown.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask, taskDirFor } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { scratchpadPath } from "../src/knowledge/paths.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import { pendingApprovals } from "../src/workflow/approvals.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const WELL_FORMED = [
  "## Completed",
  "Added pagination to the users endpoint.",
  "",
  "## Files Changed",
  "- `src/api/users.ts` — added limit/offset handling",
  "",
  "## Verification",
  "- `npm test` — 12 passing",
  "",
  "## Notes",
  "Reused the existing query builder.",
  "",
  "## Dependencies Needed",
  "- zod for request validation",
  "",
  "## Architecture Changes",
  "- introduce a repository layer",
].join("\n");

const BLOCKED = [
  "## Completed",
  "Could not change the schema.",
  "",
  "## Files Changed",
  "",
  "## Verification",
  "",
  "## Blockers",
  "**Blocker:** The migration table is owned by another service.",
  "**Tried:** Checked src/db/migrations; asked the schema owner in the repo docs.",
  "**Need:** Confirmation on whether we may add the column.",
].join("\n");

function workerReply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

function makeDeps(overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    root: mkdtempSync(join(tmpdir(), "dh-w-")),
    configDir: ".pi",
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    ask: async () => undefined,
    choose: async () => undefined,
    notify: () => {},
    runProcess: async () => ({ exitCode: 0, stdout: workerReply(WELL_FORMED), stderr: "", killed: false, timedOut: false }),
    ...overrides,
  };
}

const PATHS: Record<string, TaskState[]> = {
  planning: ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning"],
  reviewing: ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "reviewing"],
};

function withTask(deps: WorkflowDeps, state: TaskState): Task {
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Add pagination");
  createTaskDir(deps.root, deps.configDir, task);
  for (const step of PATHS[state] ?? []) transition(task, step);
  saveTask(deps.root, deps.configDir, task);
  return task;
}

function act(deps: WorkflowDeps, params: Partial<OrchestrateParams>) {
  return runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
}

test("parseWorkerResult extracts every contract section", () => {
  const result = parseWorkerResult("backend", WELL_FORMED, "2026-01-01T00:00:00.000Z");
  assert.match(result.completed, /Added pagination/);
  assert.deepEqual(result.filesChanged, [{ path: "src/api/users.ts", change: "added limit/offset handling" }]);
  assert.match(result.verification, /12 passing/);
  assert.equal(result.notes, "Reused the existing query builder.");
  assert.deepEqual(result.dependencyNeeds, ["zod for request validation"]);
  assert.deepEqual(result.architectureChanges, ["introduce a repository layer"]);
  assert.deepEqual(validateWorkerResult(result), []);
});

test("parseWorkerResult extracts a structured blocker", () => {
  const result = parseWorkerResult("backend", BLOCKED, "2026-01-01T00:00:00.000Z");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0]!.domain, "backend");
  assert.match(result.blockers[0]!.reason, /owned by another service/);
  assert.equal(result.blockers[0]!.need, "Confirmation on whether we may add the column.");
  assert.ok(result.blockers[0]!.tried.length >= 1);
});

test("validateWorkerResult flags unverified or empty work", () => {
  const unverified = parseWorkerResult("backend", "## Completed\nDid things.\n\n## Files Changed\n- src/a.ts — change");
  assert.deepEqual(validateWorkerResult(unverified), ["changed files without verification"]);
  const empty = parseWorkerResult("backend", "## Completed\n");
  assert.deepEqual(validateWorkerResult(empty), ["missing Completed section", "no files changed and no blocker reported"]);
  const nothing = parseWorkerResult("backend", "I did nothing at all.");
  assert.match(validateWorkerResult(nothing)[0]!, /missing Completed/);
  const claimedNothing = parseWorkerResult("backend", "## Completed\nNo changes were needed.\n\n## Verification\n- read the code");
  assert.deepEqual(validateWorkerResult(claimedNothing), []);
});

test("parseSections keeps heading case-insensitive and marks missing sections", () => {
  const sections = parseSections("## Files Changed\n- a");
  assert.equal(sections.get("files changed"), "- a\n");
  assert.equal(sections.get("notes"), undefined);
});

test("implement runs a worker and records dependency and architecture approvals", async () => {
  const deps = makeDeps();
  withTask(deps, "planning");
  const result = await act(deps, { action: "implement", domain: "backend", task: "Add pagination." });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "implementing");
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  const pending = pendingApprovals(task, "backend");
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map((a) => a.kind).sort(), ["architecture", "dependency"]);
  assert.match(result.message, /Approvals required/);
});

test("pending approvals block further work in that domain and are resolvable", async () => {
  const deps = makeDeps();
  const task = withTask(deps, "planning");
  const first = await act(deps, { action: "implement", domain: "backend", task: "Step one." });
  assert.equal(first.ok, true);
  const blocked = await act(deps, { action: "implement", domain: "backend", task: "Step two." });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /unresolved approvals/);

  const resolved = await act(deps, { action: "resolve_approval", approvalId: "APR-1", decision: "approved", note: "zod is fine" });
  assert.equal(resolved.ok, true, resolved.message);
  assert.match(resolved.message, /approved/);
  assert.equal(pendingApprovals(loadTask(deps.root, deps.configDir, task.id)!, "backend").length, 1);
  const unknown = await act(deps, { action: "resolve_approval", approvalId: "APR-99", decision: "approved" });
  assert.equal(unknown.ok, false);
});

test("a designer worker is not blocked by backend approvals", async () => {
  const deps = makeDeps();
  withTask(deps, "planning");
  await act(deps, { action: "implement", domain: "backend", task: "Backend step." });
  const designer = await act(deps, { action: "implement", domain: "designer", task: "Designer step." });
  assert.equal(designer.ok, true, designer.message);
});

test("implement updates the domain scratchpad with the worker summary", async () => {
  const deps = makeDeps();
  withTask(deps, "planning");
  await act(deps, { action: "implement", domain: "backend", task: "Add pagination." });
  const scratchpad = readFileSync(scratchpadPath(taskDirFor(deps.root, deps.configDir, "TASK-1"), "backend"), "utf8");
  assert.match(scratchpad, /Added pagination/);
  assert.match(scratchpad, /src\/api\/users.ts/);
});

test("a failed worker run is reported without changing the workflow state", async () => {
  const failing: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "agent exploded", killed: false, timedOut: false });
  const deps = makeDeps({ runProcess: failing });
  withTask(deps, "planning");
  const result = await act(deps, { action: "implement", domain: "backend", task: "Do work." });
  assert.equal(result.ok, true, result.message);
  assert.match(result.message, /failed/);
  assert.match(result.message, /agent exploded/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.state, "implementing");
});

test("auto-approval is recorded as a decision when the config disables the gate", async () => {
  const config = {
    ...DEFAULT_CONFIG,
    workflow: { ...DEFAULT_CONFIG.workflow, requireApprovalForDependencies: false, requireApprovalForArchitectureChanges: false },
  };
  const deps = makeDeps({ config });
  withTask(deps, "planning");
  await act(deps, { action: "implement", domain: "backend", task: "Add pagination." });
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(pendingApprovals(task, "backend").length, 0);
  assert.ok(task.decisions.some((decision) => decision.text.includes("Auto-approved")));
});

test("implement requires a domain and an instruction", async () => {
  const deps = makeDeps();
  withTask(deps, "planning");
  const noDomain = await act(deps, { action: "implement", task: "x" });
  assert.equal(noDomain.ok, false);
  assert.match(noDomain.message, /requires domain/);
  const noTask = await act(deps, { action: "implement", domain: "backend" });
  assert.equal(noTask.ok, false);
  assert.match(noTask.message, /requires task/);
});

test("implement is rejected before the plan is approved", async () => {
  const deps = makeDeps();
  withTask(deps, "synthesizing");
  const result = await act(deps, { action: "implement", domain: "backend", task: "x" });
  assert.equal(result.ok, false);
  assert.match(result.message, /not allowed in state/);
});
