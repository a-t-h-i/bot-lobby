import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReviewResult, validateReviewResult } from "../src/roles/reviewer.ts";
import { decideReviewLoop } from "../src/master/decisions.ts";
import { DEFAULT_CONFIG, type DevHouseConfig } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { ProcessOutcome, ProcessRunner } from "../src/execution/pi-runner.ts";
import { runReviewer, type ReviewerRequest } from "../src/master/master.ts";

function review(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

const PASS = "## Verdict\nPASS\n\n## Verification\n- `npm test` — passing";

const CHANGES = [
  "## Verdict",
  "CHANGES_REQUIRED",
  "",
  "## Findings",
  "- [major] No validation on the query param — `src/api/users.ts:42`",
  "",
  "## Verification",
  "- `npm test` — passing",
  "",
  "## Required Changes",
  "- Validate limit and offset",
].join("\n");

function makeDeps(overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    root: mkdtempSync(join(tmpdir(), "dh-r-")),
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

const PATHS: Record<string, TaskState[]> = {
  implementing: ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing"],
  blocked: ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "blocked"],
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

test("parseReviewResult extracts a pass verdict", () => {
  const result = parseReviewResult("backend", PASS);
  assert.equal(result.verdict, "pass");
  assert.equal(result.findings.length, 0);
  assert.deepEqual(validateReviewResult(result), []);
});

test("parseReviewResult extracts findings with severities and required changes", () => {
  const result = parseReviewResult("backend", CHANGES);
  assert.equal(result.verdict, "changes_required");
  assert.deepEqual(result.findings, [{ severity: "major", text: "No validation on the query param — `src/api/users.ts:42`" }]);
  assert.deepEqual(result.requiredChanges, ["Validate limit and offset"]);
  assert.deepEqual(validateReviewResult(result), []);
});

test("an unknown or missing verdict is never treated as a pass", () => {
  assert.equal(parseReviewResult("backend", "Looks fine to me!").verdict, "blocked");
  assert.equal(parseReviewResult("backend", "## Verdict\nMAYBE\n\n## Findings\n- [minor] x").verdict, "blocked");
  const missing = parseReviewResult("backend", "no sections here");
  assert.ok(validateReviewResult(missing).includes("missing Verdict section"));
});

test("a pass with critical findings is flagged", () => {
  const result = parseReviewResult("backend", "## Verdict\nPASS\n\n## Findings\n- [critical] data loss — `x.ts:1`");
  assert.equal(result.verdict, "pass");
  assert.ok(validateReviewResult(result).includes("PASS declared with critical findings"));
});

test("a non-pass verdict without evidence is flagged", () => {
  const result = parseReviewResult("backend", "## Verdict\nCHANGES_REQUIRED");
  assert.ok(validateReviewResult(result).includes("non-pass verdict without findings or required changes"));
});

test("decideReviewLoop accepts passes, iterates within the limit, then blocks", () => {
  assert.equal(decideReviewLoop("pass", 1, 2), "accept");
  assert.equal(decideReviewLoop("blocked", 1, 2), "blocked");
  assert.equal(decideReviewLoop("changes_required", 1, 2), "iterate");
  assert.equal(decideReviewLoop("changes_required", 2, 2), "blocked");
});

test("block moves the task to blocked and resume restores implementation", async () => {
  const deps = makeDeps();
  withTask(deps, "implementing");
  const blocked = await act(deps, { action: "block", reason: "waiting on schema owner", domain: "backend" });
  assert.equal(blocked.state, "blocked");
  const resumed = await act(deps, { action: "resume", domain: "backend" });
  assert.equal(resumed.state, "implementing");
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.blockers.length, 0);
});

test("block requires a reason", async () => {
  const deps = makeDeps();
  withTask(deps, "implementing");
  const result = await act(deps, { action: "block" });
  assert.equal(result.ok, false);
  assert.match(result.message, /requires reason/);
});

test("resume is rejected when the task is not blocked", async () => {
  const deps = makeDeps();
  withTask(deps, "implementing");
  const result = await act(deps, { action: "resume" });
  assert.equal(result.ok, false);
  assert.match(result.message, /not allowed in state/);
});

const REVIEW_CONFIG: DevHouseConfig = {
  ...DEFAULT_CONFIG,
  workflow: { ...DEFAULT_CONFIG.workflow, maxAgentRetries: 2 },
};

const OFF_CONTRACT = "The changes look reasonable but I have no structured verdict.";

function reviewerRequest(overrides: Partial<ReviewerRequest> = {}): ReviewerRequest {
  return {
    taskId: "TASK-1",
    domain: "backend",
    taskText: "Add pagination",
    workerSummary: "Added pagination.",
    scoutOutcomes: [],
    diff: "diff --git a/src/x.ts b/src/x.ts",
    cwd: process.cwd(),
    dataRoot: mkdtempSync(join(tmpdir(), "dh-review-")),
    config: REVIEW_CONFIG,
    ...overrides,
  };
}

function outcome(stdout: string, overrides: Partial<ProcessOutcome> = {}): ProcessOutcome {
  return { exitCode: 0, stdout, stderr: "", killed: false, timedOut: false, ...overrides };
}

test("an off-contract success is resampled and can still pass", async () => {
  let calls = 0;
  const runner: ProcessRunner = async () => {
    calls += 1;
    return outcome(review(calls === 1 ? OFF_CONTRACT : PASS));
  };
  const result = await runReviewer(reviewerRequest(), runner);
  assert.equal(calls, 2);
  assert.equal(result.run.status, "success");
  assert.equal(result.result.verdict, "pass");
  assert.deepEqual(result.issues, []);
});

test("an always off-contract reviewer is bounded by maxAgentRetries", async () => {
  let calls = 0;
  const runner: ProcessRunner = async () => {
    calls += 1;
    return outcome(review(OFF_CONTRACT));
  };
  const result = await runReviewer(reviewerRequest(), runner);
  assert.equal(calls, REVIEW_CONFIG.workflow.maxAgentRetries + 1);
  assert.equal(result.result.verdict, "blocked");
  assert.ok(result.issues.includes("missing Verdict section"));
});

test("a cancelled reviewer run is never retried", async () => {
  let calls = 0;
  const runner: ProcessRunner = async () => {
    calls += 1;
    return outcome(review(OFF_CONTRACT), { killed: true });
  };
  const result = await runReviewer(reviewerRequest(), runner);
  assert.equal(calls, 1);
  assert.equal(result.run.status, "cancelled");
});
