import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completionBlockers } from "../src/master/decisions.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask, taskDirFor } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { dataRoot } from "../src/state/project.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

function review(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

const PASS = "## Verdict\nPASS\n\n## Verification\n- `npm test` — passing";
const FAIL = "## Verdict\nCHANGES_REQUIRED\n\n## Findings\n- [major] regression in the empty state\n\n## Required Changes\n- handle empty list";

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "reviewing"];

function makeDeps(overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    root: mkdtempSync(join(tmpdir(), "dh-qa-")),
    configDir: ".pi",
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    ask: async () => undefined,
    choose: async () => undefined,
    notify: () => {},
    runProcess: async () => ({ exitCode: 0, stdout: review(PASS), stderr: "", killed: false, timedOut: false }),
    ...overrides,
  };
}

function withTask(deps: WorkflowDeps, options: { state?: "implementing" | "reviewing"; qa?: "pass" | "changes_required" } = {}): Task {
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Add pagination");
  createTaskDir(deps.root, deps.configDir, task);
  const until = options.state ?? "reviewing";
  for (const step of FLOW) {
    transition(task, step);
    if (step === until) break;
  }
  task.domains = ["backend"];
  task.plan = "## Objective\nAdd pagination.\n## Domains\nbackend\n## Files\nsrc/api/users.ts\n## Sequence\n1\n## Dependencies\nnone\n## Testing\nunit\n## Acceptance Criteria\nworks\n## Rollback\nrevert\n## Review\npeer";
  if (options.qa) task.qaVerdict = options.qa;
  saveTask(deps.root, deps.configDir, task);
  return task;
}

function act(deps: WorkflowDeps, params: Partial<OrchestrateParams>) {
  return runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
}

test("completionBlockers lists every unmet gate", () => {
  const task = createTask("TASK-1", "x");
  assert.deepEqual(completionBlockers(task, 0), ["no approved plan is recorded", "QA gate is not run"]);
  task.plan = "plan";
  task.domains = ["backend"];
  task.qaVerdict = "pass";
  assert.deepEqual(completionBlockers(task, 0), []);
  assert.deepEqual(completionBlockers(task, 2), ["2 unresolved approval request(s)"]);
  task.blockers.push({ domain: "backend", reason: "x", tried: [], need: "y", createdAt: "now" });
  assert.deepEqual(completionBlockers(task, 0), ["1 unresolved blocker(s)"]);
});

test("qa runs the gate, records the verdict, and reports a pass", async () => {
  const deps = makeDeps();
  withTask(deps);
  const result = await act(deps, { action: "qa" });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "reviewing");
  assert.match(result.message, /QA gate: PASS/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.qaVerdict, "pass");
});

test("a failing QA gate tells the Master to send work back", async () => {
  const runner: ProcessRunner = async () => ({ exitCode: 0, stdout: review(FAIL), stderr: "", killed: false, timedOut: false });
  const deps = makeDeps({ runProcess: runner });
  withTask(deps);
  const result = await act(deps, { action: "qa" });
  assert.match(result.message, /QA gate: CHANGES_REQUIRED/);
  assert.match(result.message, /re-run action=qa/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.qaVerdict, "changes_required");
});

test("qa is accepted from implementing and transitions to reviewing", async () => {
  const deps = makeDeps();
  withTask(deps, { state: "implementing" });
  const result = await act(deps, { action: "qa" });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "reviewing");
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.reviewIterations.qa, 1);
});

test("a failing QA gate iterates until the review limit, then blocks", async () => {
  const runner: ProcessRunner = async () => ({ exitCode: 0, stdout: review(FAIL), stderr: "", killed: false, timedOut: false });
  const deps = makeDeps({ runProcess: runner });
  withTask(deps, { state: "implementing" });
  const first = await act(deps, { action: "qa" });
  assert.match(first.message, /re-run action=qa/);
  const second = await act(deps, { action: "qa" });
  assert.match(second.message, /mark the task blocked/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.reviewIterations.qa, 2);
});

test("complete is refused until every gate passes", async () => {
  const deps = makeDeps();
  withTask(deps, { qa: "changes_required" });
  const result = await act(deps, { action: "complete" });
  assert.equal(result.ok, false);
  assert.match(result.message, /cannot complete/);
  assert.match(result.message, /QA gate is changes_required/);
  assert.doesNotMatch(result.message, /accepted review/);
});

test("complete records history, clears scratchpads, and finishes the task", async () => {
  const deps = makeDeps();
  withTask(deps, { qa: "pass" });
  const taskDir = taskDirFor(deps.root, deps.configDir, "TASK-1");
  assert.ok(existsSync(join(taskDir, "proposal.md")));

  const result = await act(deps, { action: "complete", text: "Added pagination to the users endpoint." });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "completed");
  assert.ok(!existsSync(join(taskDir, "proposal.md")), "scratchpads are removed");
  assert.ok(existsSync(join(taskDir, "state.json")), "the completion record is kept");

  const log = readFileSync(join(knowledgeDir(dataRoot(deps.root, deps.configDir), "backend"), "completed-tasks.md"), "utf8");
  assert.match(log, /TASK-1: Added pagination/);
});

test("a completed task rejects further workflow actions", async () => {
  const deps = makeDeps();
  withTask(deps, { qa: "pass" });
  await act(deps, { action: "complete" });
  const result = await act(deps, { action: "implement", domain: "backend", task: "more" });
  assert.equal(result.ok, false);
  assert.match(result.message, /already completed/);
});

test("qa and complete are rejected outside implementing/reviewing", async () => {
  const deps = makeDeps();
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "x");
  createTaskDir(deps.root, deps.configDir, task);
  transition(task, "clarifying");
  saveTask(deps.root, deps.configDir, task);
  const qa = await act(deps, { action: "qa" });
  assert.equal(qa.ok, false);
  const complete = await act(deps, { action: "complete" });
  assert.equal(complete.ok, false);
  assert.match(complete.message, /not allowed in state/);
});

test("legacy per-domain review state still loads and completes after a qa pass", async () => {
  const deps = makeDeps();
  withTask(deps);
  const statePath = join(taskDirFor(deps.root, deps.configDir, "TASK-1"), "state.json");
  const legacy = {
    ...JSON.parse(readFileSync(statePath, "utf8")),
    reviewIterations: { designer: 1, backend: 1, qa: 0 },
    reviewRecords: [{ domain: "backend", verdict: "pass", findings: [], requiredChanges: [], createdAt: "2026-01-01T00:00:00.000Z" }],
  };
  writeFileSync(statePath, JSON.stringify(legacy));

  const qa = await act(deps, { action: "qa" });
  assert.equal(qa.ok, true, qa.message);
  const complete = await act(deps, { action: "complete" });
  assert.equal(complete.ok, true, complete.message);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(task.state, "completed");
  assert.deepEqual(task.reviewIterations, { qa: 1 });
});

test("each action records its finished runs in the task's run log and the Master's report", async () => {
  const deps = makeDeps();
  withTask(deps);
  const result = await act(deps, { action: "qa" });
  assert.equal(result.runs?.length, 1);
  assert.match(result.message, /\n\nRuns:\n- ✓ QA reviewer · /);
  const saved = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(saved.runLog?.length, 1);
  assert.equal(saved.runLog![0]!.role, "reviewer");
  assert.equal(saved.runLog![0]!.status, "success");
  const again = await act(deps, { action: "qa" });
  assert.equal(again.runs?.length, 1);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.runLog?.length, 2);
  const status = await act(deps, { action: "status" });
  assert.ok(!status.message.includes("Runs:"), "actions without subagents carry no footer");
});
