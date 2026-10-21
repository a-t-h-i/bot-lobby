import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_VERDICT, parseReviewResult, UNVERIFIED_PASS, validateReviewResult } from "../src/roles/reviewer.ts";
import { decideReviewLoop } from "../src/master/decisions.ts";
import { DEFAULT_CONFIG, type BotLobbyConfig } from "../src/schemas/configuration.ts";
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
    runProcess: async () => ({ exitCode: 0, stdout: review(PASS), stderr: "", killed: false }),
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
  assert.equal(parseReviewResult("backend", `${CHANGES}\n\n## Pushback\n**Request:** x\n**Reason:** y`).pushback?.reason, "y");
});

test("an unknown or missing verdict is never a pass, and never stops the task: the review runs again", () => {
  for (const raw of ["Looks fine to me!", "## Verdict\nMAYBE\n\n## Findings\n- [minor] x", ""]) {
    const result = parseReviewResult("backend", raw);
    assert.equal(result.verdict, "changes_required", raw);
    assert.equal(result.unread, NO_VERDICT);
    assert.ok(result.requiredChanges.some((change) => /Re-run the QA gate/.test(change)));
    assert.equal(decideReviewLoop(result.verdict, 1, 2), "iterate");
  }
  const missing = parseReviewResult("backend", "no sections here");
  assert.ok(validateReviewResult(missing).includes("missing Verdict section"));
});

test("a FAIL verdict asks for a fix round instead of blocking the task", () => {
  const result = parseReviewResult("qa", "## Verdict\nFAIL\n\n## Findings\n- [major] off by one — `src/page.ts:9`\n\n## Verification\n- `npm test` — 1 failing");
  assert.equal(result.verdict, "changes_required");
  assert.equal(decideReviewLoop(result.verdict, 1, 2), "iterate");
});

test("the verdict is the first verdict word, wherever the reviewer put it", () => {
  const checks = "\n\n## Verification\n- `npm test` — 40 passing";
  const cases: Array<[string, string]> = [
    [`## Verdict\nPASS — no changes required.${checks}`, "pass"],
    [`## Verdict\n**PASS**${checks}`, "pass"],
    [`**Verdict:** PASS${checks}`, "pass"],
    [`**Verdict:** CHANGES_REQUIRED\n\n## Findings\n- [major] x — \`a.ts:1\`${checks}`, "changes_required"],
    [`## Verdict\nCHANGES REQUESTED: the tests passed but criterion 2 is unmet${checks}`, "changes_required"],
    [`## Verdict\nBLOCKED — the project does not build${checks}`, "blocked"],
  ];
  for (const [raw, verdict] of cases) assert.equal(parseReviewResult("qa", raw).verdict, verdict, raw);
  assert.deepEqual(validateReviewResult(parseReviewResult("qa", `**Verdict:** PASS${checks}`)), []);
});

test("checks listed as numbered items, table rows or check marks count as executed", () => {
  for (const verification of [
    "1. `npm test` — 40 passed\n2. `npx tsc --noEmit` — clean",
    "| Command | Result |\n|---|---|\n| npm test | 40 passed |",
    "- ✅ `npm test` (40/40)",
    "- `npm run typecheck` passed",
  ]) {
    const result = parseReviewResult("qa", `## Verdict\nPASS\n\n## Verification\n${verification}`);
    assert.equal(result.verdict, "pass", verification);
    assert.equal(result.downgraded, undefined);
  }
  const header = parseReviewResult("qa", "## Verdict\nPASS\n\n## Verification\n| Command | Result |\n|---|---|");
  assert.equal(header.downgraded, UNVERIFIED_PASS);
});

test("low and nit findings never hold the gate; high ones do", () => {
  const checks = "\n\n## Verification\n- `npm test` — passing";
  const low = parseReviewResult("qa", `## Verdict\nCHANGES_REQUIRED\n\n## Findings\n- [low] rename x\n- **[nit]** spacing${checks}`);
  assert.equal(low.verdict, "pass");
  assert.deepEqual(low.findings.map((finding) => finding.severity), ["minor", "minor"]);
  const high = parseReviewResult("qa", `## Verdict\nCHANGES_REQUIRED\n\n## Findings\n- [high] data loss on retry${checks}`);
  assert.equal(high.verdict, "changes_required");
  assert.equal(high.findings[0]!.severity, "major");
});

test("a PASS token in the verdict heading parses as a pass", () => {
  const result = parseReviewResult("backend", "## Verdict PASS\n\n## Verification\n- `npm run typecheck` — clean");
  assert.equal(result.verdict, "pass");
  assert.equal(result.downgraded, undefined);
});

test("a CHANGES_REQUIRED token in the verdict heading parses as changes_required", () => {
  const result = parseReviewResult(
    "backend",
    "## Verdict CHANGES_REQUIRED\n\n## Findings\n- [major] No validation on the query param — `src/api/users.ts:42`\n\n## Verification\n- `npm test` — passing\n\n## Required Changes\n- Validate limit and offset",
  );
  assert.equal(result.verdict, "changes_required");
});

test("a pass with critical findings is flagged", () => {
  const result = parseReviewResult("backend", "## Verdict\nPASS\n\n## Findings\n- [critical] data loss — `x.ts:1`\n\n## Verification\n- `npm test` — 12 passing");
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

const REVIEW_CONFIG: BotLobbyConfig = {
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
    dataRoots: [mkdtempSync(join(tmpdir(), "dh-review-"))],
    config: REVIEW_CONFIG,
    ...overrides,
  };
}

function outcome(stdout: string, overrides: Partial<ProcessOutcome> = {}): ProcessOutcome {
  return { exitCode: 0, stdout, stderr: "", killed: false, ...overrides };
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
  assert.equal(result.result.verdict, "changes_required");
  assert.equal(result.result.unread, NO_VERDICT);
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

test("a PASS without executed checks is downgraded, never accepted by default", () => {
  for (const raw of [
    "## Verdict\nPASS",
    "## Verdict\nPASS\n\n## Verification\nLooks good.",
    "## Verdict\nPASS\n\n## Verification\n- npm test",
  ]) {
    const result = parseReviewResult("qa", raw);
    assert.equal(result.verdict, "changes_required", raw);
    assert.equal(result.downgraded, UNVERIFIED_PASS);
    assert.ok(validateReviewResult(result).includes(UNVERIFIED_PASS));
    assert.ok(result.requiredChanges.some((change) => /Re-run the QA gate/.test(change)));
  }
  const verified = parseReviewResult("qa", "## Verdict\nPASS\n\n## Verification\n- `npm test` — 42 passing\n- `curl -s /health` → 200");
  assert.equal(verified.verdict, "pass");
  assert.equal(verified.downgraded, undefined);
});
