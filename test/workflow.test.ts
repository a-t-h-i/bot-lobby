import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask, taskDirFor } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import {
  runWorkflowAction,
  validatePlan,
  describeTask,
  type WorkflowDeps,
  type OrchestrateParams,
} from "../src/workflow/workflow.ts";
import { pendingApprovals, requestApproval } from "../src/workflow/approvals.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

/** Paths through the state machine so test setup exercises real transitions. */
const PATHS: Partial<Record<TaskState, TaskState[]>> = {
  created: [],
  clarifying: ["clarifying"],
  scouting: ["clarifying", "scouting"],
  synthesizing: ["clarifying", "scouting", "synthesizing"],
  awaiting_approval: ["clarifying", "scouting", "synthesizing", "awaiting_approval"],
  planning: ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning"],
  implementing: ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing"],
  reviewing: ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "reviewing"],
};

function scoutReply(): string {
  const text = ["## Scope", "x", "", "## Findings", "- found", "", "## Confidence", "High"].join("\n");
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

function makeDeps(overrides: Partial<WorkflowDeps> = {}): WorkflowDeps {
  const root = mkdtempSync(join(tmpdir(), "dh-wf-"));
  return {
    root,
    configDir: ".pi",
    cwd: root,
    config: DEFAULT_CONFIG,
    ask: async () => undefined,
    choose: async () => undefined,
    notify: () => {},
    runProcess: async () => ({ exitCode: 0, stdout: scoutReply(), stderr: "", killed: false, timedOut: false }),
    ...overrides,
  };
}

function withTask(deps: WorkflowDeps, state: TaskState = "created"): Task {
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Add feature X");
  createTaskDir(deps.root, deps.configDir, task);
  for (const step of PATHS[state] ?? []) transition(task, step);
  saveTask(deps.root, deps.configDir, task);
  return task;
}

function act(deps: WorkflowDeps, params: Partial<OrchestrateParams> = {}) {
  return runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
}

test("clarify moves created to clarifying and returns the user's answer", async () => {
  const deps = makeDeps({ ask: async () => "Only admins" });
  withTask(deps);
  const result = await act(deps, { action: "clarify", question: "Who may see this?" });
  assert.equal(result.ok, true);
  assert.equal(result.state, "clarifying");
  assert.match(result.message, /Only admins/);
});

test("clarify without UI tells the Master to ask directly", async () => {
  const deps = makeDeps();
  withTask(deps);
  const result = await act(deps, { action: "clarify", question: "Which env?" });
  assert.match(result.message, /No answer captured/);
  assert.match(result.message, /Which env\?/);
});

test("scout requires valid domains", async () => {
  const deps = makeDeps();
  withTask(deps);
  const result = await act(deps, { action: "scout", domains: ["nonsense"] });
  assert.equal(result.ok, false);
  assert.match(result.message, /at least one of/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.state, "created");
});

test("scout runs the domains and moves to synthesizing", async () => {
  const seen: string[] = [];
  const runner: ProcessRunner = async (args) => {
    seen.push(String(args.at(-1)));
    return { exitCode: 0, stdout: scoutReply(), stderr: "", killed: false, timedOut: false };
  };
  const deps = makeDeps({ runProcess: runner });
  withTask(deps, "clarifying");
  const result = await act(deps, { action: "scout", domains: ["backend", "qa"] });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "synthesizing");
  assert.equal(seen.length, 2);
  assert.match(result.message, /Scout results/);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.deepEqual(task.domains, ["backend", "qa"]);
});

test("a scout pushback is recorded as a decision and does not gate the domain", async () => {
  const text = ["## Scope", "x", "", "## Findings", "- found", "", "## Pushback", "**Request:** Cache sessions in the client", "**Reason:** It would leak credentials", "", "## Confidence", "High"].join("\n");
  const stdout = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
  const deps = makeDeps({ runProcess: async () => ({ exitCode: 0, stdout, stderr: "", killed: false, timedOut: false }) });
  withTask(deps, "clarifying");
  const result = await act(deps, { action: "scout", domains: ["backend"] });
  assert.equal(result.ok, true, result.message);
  assert.match(result.message, /pushed back/);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(pendingApprovals(task, "backend").length, 0, "an advisory pushback does not gate");
  assert.match(task.decisions.map((decision) => decision.text).join("\n"), /pushed back/);
});

test("scout from synthesizing is a targeted verification that stays in synthesizing", async () => {
  const deps = makeDeps();
  withTask(deps, "synthesizing");
  const result = await act(deps, { action: "scout", domains: ["backend"], instruction: "Confirm auth lives in session.ts" });
  assert.equal(result.state, "synthesizing");
  assert.match(result.message, /Targeted verification/);
});

test("propose approval moves to planning", async () => {
  const deps = makeDeps({ choose: async () => "Approve" });
  withTask(deps, "synthesizing");
  const result = await act(deps, { action: "propose", proposal: "Add Z while keeping the login flow." });
  assert.equal(result.ok, true);
  assert.equal(result.state, "planning");
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.proposal, "Add Z while keeping the login flow.");
});

test("propose decline abandons the task", async () => {
  const deps = makeDeps({ choose: async () => "Decline" });
  withTask(deps, "synthesizing");
  const result = await act(deps, { action: "propose", proposal: "Risky change." });
  assert.equal(result.state, "abandoned");
});

test("propose amend records the amendment and stays awaiting approval", async () => {
  const deps = makeDeps({ choose: async () => "Amend", ask: async () => "Keep the old endpoint" });
  withTask(deps, "synthesizing");
  const result = await act(deps, { action: "propose", proposal: "Replace the endpoint." });
  assert.equal(result.state, "awaiting_approval");
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.deepEqual(task.amendments, ["Keep the old endpoint"]);
  const again = await act(deps, { action: "propose", proposal: "Keep the old endpoint and add a new one." });
  assert.equal(again.ok, true, again.message);
});

test("propose without UI leaves the proposal awaiting approval", async () => {
  const deps = makeDeps();
  withTask(deps, "synthesizing");
  const result = await act(deps, { action: "propose", proposal: "Do the thing." });
  assert.equal(result.state, "awaiting_approval");
  assert.match(result.message, /Awaiting approval/);
});

test("implementation cannot start before approval", async () => {
  const deps = makeDeps();
  withTask(deps, "synthesizing");
  const result = await act(deps, { action: "plan", plan: "# Plan\nObjective: x" });
  assert.equal(result.ok, false);
  assert.match(result.message, /not allowed in state/);
});

test("plan rejects a plan missing required areas and accepts a complete one", async () => {
  const deps = makeDeps();
  withTask(deps, "planning");
  const incomplete = await act(deps, { action: "plan", plan: "## Objective\nDo it." });
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.message, /plan is missing/);

  const plan = [
    "## Objective", "Add pagination.", "## Domains", "backend",
    "## Files", "src/api/users.ts", "## Sequence", "1. add query params",
    "## Dependencies", "none", "## Testing", "unit tests",
    "## Acceptance Criteria", "page size respected", "## Rollback", "revert the commit",
    "## Review", "backend reviewer",
  ].join("\n");
  const accepted = await act(deps, { action: "plan", plan });
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.plan, plan);
});

test("cancel abandons and terminal tasks reject further actions", async () => {
  const deps = makeDeps();
  withTask(deps, "implementing");
  const cancelled = await act(deps, { action: "cancel" });
  assert.equal(cancelled.state, "abandoned");
  const after = await act(deps, { action: "scout", domains: ["backend"] });
  assert.equal(after.ok, false);
  assert.match(after.message, /already abandoned/);
});

test("paused tasks reject workflow actions but still report status", async () => {
  const deps = makeDeps();
  const task = withTask(deps, "synthesizing");
  task.paused = true;
  saveTask(deps.root, deps.configDir, task);
  const blocked = await act(deps, { action: "propose", proposal: "x" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /paused/);
  const status = await act(deps, { action: "status" });
  assert.equal(status.ok, true);
  assert.match(status.message, /paused/);
});

test("decide records a decision on the task", async () => {
  const deps = makeDeps();
  withTask(deps, "implementing");
  const result = await act(deps, { action: "decide", text: "Use the existing session store.", domain: "backend" });
  assert.equal(result.ok, true);
  const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
  assert.equal(task.decisions[0]!.text, "Use the existing session store.");
  assert.equal(task.decisions[0]!.domain, "backend");
});

test("pending approvals surface in status and gate the domain", () => {
  const deps = makeDeps();
  const task = withTask(deps, "implementing");
  requestApproval(task, "dependency", "backend", "install zod", "2026-01-01T00:00:00.000Z");
  assert.equal(pendingApprovals(task, "backend").length, 1);
  assert.match(describeTask(task), /APR-1 dependency for backend/);
});

test("validatePlan reports every missing area", () => {
  assert.equal(validatePlan("Objective: x\nDomains: backend\nFiles: a.ts\nSequence: 1\nDependencies: none\nTesting: unit\nAcceptance: works\nRollback: revert\nReview: peer").length, 0);
  assert.equal(validatePlan("nothing useful here").length, 9);
});

const RESEARCH_REPLY = [
  "## Question",
  "Does pi support a web search tool?",
  "",
  "## Findings",
  "- Web tools ship as the pi-web-access extension",
  "",
  "## Sources",
  "- https://example.com/docs — documents the web_search tool (2026-01-02)",
  "",
  "## Unverified",
  "- Windows support was not confirmed",
  "",
  "## Recommendations",
  "- Install pi-web-access and allowlist its tools",
  "",
  "## Confidence",
  "High",
].join("\n");

function researchRunner(text: string): ProcessRunner {
  return async () => ({
    exitCode: 0,
    stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } }),
    stderr: "",
    killed: false,
    timedOut: false,
  });
}

test("research requires an instruction and a valid domain", async () => {
  const deps = makeDeps({ runProcess: researchRunner(RESEARCH_REPLY) });
  withTask(deps, "created");
  const noInstruction = await act(deps, { action: "research", domain: "backend" });
  assert.equal(noInstruction.ok, false);
  assert.match(noInstruction.message, /requires instruction/);
  const noDomain = await act(deps, { action: "research", instruction: "Any trends?" });
  assert.equal(noDomain.ok, false);
  assert.match(noDomain.message, /requires domain/);
  const badDomain = await act(deps, { action: "research", domain: "nonsense", instruction: "Any trends?" });
  assert.equal(badDomain.ok, false);
  assert.match(badDomain.message, /requires domain/);
});

test("research runs in clarifying, planning and implementing without changing the task", async () => {
  for (const state of ["clarifying", "planning", "implementing"] as const) {
    const deps = makeDeps({ runProcess: researchRunner(RESEARCH_REPLY) });
    withTask(deps, state);
    const result = await act(deps, { action: "research", domain: "backend", instruction: "Any trends?" });
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /Research for backend \(confidence: high\)/);
    assert.match(result.message, /https:\/\/example\.com\/docs/);
    const task = loadTask(deps.root, deps.configDir, "TASK-1")!;
    assert.equal(task.state, state);
    assert.deepEqual(task.domains, []);
  }
});

test("research persists its artifact and appends the research log", async () => {
  const deps = makeDeps({ runProcess: researchRunner(RESEARCH_REPLY) });
  withTask(deps, "implementing");
  await act(deps, { action: "research", domain: "qa", instruction: "Which versions?" });
  const taskDir = taskDirFor(deps.root, deps.configDir, "TASK-1");
  assert.ok(existsSync(join(taskDir, "research-qa.json")), "research artifact is persisted");
  const log = readFileSync(join(taskDir, "research.md"), "utf8");
  assert.match(log, /Which versions\?|Does pi support a web search tool\?/);
  assert.match(log, /https:\/\/example\.com\/docs/);
});

test("an unusable research run is reported as degraded, never as findings", async () => {
  const sourceless = ["## Question", "Why?", "", "## Findings", "- a claim", "", "## Confidence", "High"].join("\n");
  const deps = makeDeps({ runProcess: researchRunner(sourceless) });
  withTask(deps, "clarifying");
  const result = await act(deps, { action: "research", domain: "backend", instruction: "Why?" });
  assert.equal(result.ok, true);
  assert.match(result.message, /No usable cited research report/);
  assert.match(result.message, /pi-web-access/);
  assert.match(result.message, /no sources reported/);
  assert.doesNotMatch(result.message, /^Findings:/m);
});

test("a failed research process reports the failure and the artifact path", async () => {
  const failing: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom", killed: false, timedOut: false });
  const deps = makeDeps({ runProcess: failing });
  withTask(deps, "clarifying");
  const result = await act(deps, { action: "research", domain: "designer", instruction: "Any trends?" });
  assert.equal(result.ok, true);
  assert.match(result.message, /No usable cited research report \(run failed\)/);
  assert.match(result.message, /Error: boom/);
  assert.match(result.message, /research-designer\.json/);
});
