import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent, cancelAllRuns, type AgentRequest } from "../src/execution/agent-runner.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask, taskHealth, taskDirFor } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { ProcessOutcome, ProcessRunner } from "../src/execution/pi-runner.ts";

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

function outcome(stdout: string, overrides: Partial<ProcessOutcome> = {}): ProcessOutcome {
  return { exitCode: 0, stdout, stderr: "", killed: false, timedOut: false, ...overrides };
}

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    taskId: "TASK-1",
    domain: "backend",
    role: "scout",
    instruction: "Inspect",
    context: { task: "x" },
    timeoutMs: 1000,
    cwd: process.cwd(),
    ...overrides,
  };
}

test("a crashed agent is retried once by default and succeeds on the second attempt", async () => {
  let calls = 0;
  const flaky: ProcessRunner = async () => {
    calls += 1;
    return calls === 1 ? outcome("", { exitCode: 1, stderr: "transient" }) : outcome(reply("recovered"));
  };
  const run = await runAgent(request({ retries: DEFAULT_CONFIG.workflow.maxAgentRetries }), flaky);
  assert.equal(calls, 2);
  assert.equal(run.status, "success");
  assert.equal(run.output, "recovered");
  assert.equal(run.attempts, 2);
});

test("retries are bounded and report the last failure", async () => {
  let calls = 0;
  const broken: ProcessRunner = async () => {
    calls += 1;
    return outcome("", { exitCode: 1, stderr: "still broken" });
  };
  const run = await runAgent(request({ retries: 2 }), broken);
  assert.equal(calls, 3, "one initial attempt plus two retries");
  assert.equal(run.status, "failed");
  assert.match(run.error!, /still broken/);
  assert.equal(run.attempts, 3);
});

test("timeouts are retried but never reported as success", async () => {
  let calls = 0;
  const slow: ProcessRunner = async () => {
    calls += 1;
    return outcome(reply("partial"), { killed: true, timedOut: true });
  };
  const run = await runAgent(request({ retries: 1 }), slow);
  assert.equal(calls, 2);
  assert.equal(run.status, "timeout");
});

test("cancellation is never retried", async () => {
  let calls = 0;
  const hanging: ProcessRunner = async (_args, options) => {
    calls += 1;
    return new Promise((resolve) => {
      options.signal?.addEventListener("abort", () => resolve(outcome("", { killed: true })));
    });
  };
  const pending = runAgent(request({ retries: 3, timeoutMs: 60_000 }), hanging);
  cancelAllRuns();
  const run = await pending;
  assert.equal(calls, 1, "an aborted run must not be repeated");
  assert.equal(run.status, "cancelled");
});

test("taskHealth reports unreadable task state instead of silently ignoring it", () => {
  const root = mkdtempSync(join(tmpdir(), "dh-rel-"));
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-1", "Fine");
  createTaskDir(root, ".pi", task);
  const broken = createTask("TASK-2", "Broken");
  createTaskDir(root, ".pi", broken);
  writeFileSync(join(taskDirFor(root, ".pi", "TASK-2"), "state.json"), "{not json");
  const unnamed = createTask("TASK-3", "Mismatched");
  createTaskDir(root, ".pi", unnamed);
  writeFileSync(join(taskDirFor(root, ".pi", "TASK-3"), "state.json"), JSON.stringify({ ...unnamed, id: "OTHER" }));

  const health = taskHealth(root, ".pi");
  assert.deepEqual(health.tasks.map((entry) => entry.id), ["TASK-1"]);
  assert.deepEqual(health.corrupted.sort(), ["TASK-2", "TASK-3"]);
});

test("an interrupted task can be resumed from the state it stopped in", async () => {
  const deps: WorkflowDeps = {
    root: mkdtempSync(join(tmpdir(), "dh-rel2-")),
    configDir: ".pi",
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    ask: async () => undefined,
    choose: async () => undefined,
    notify: () => {},
    runProcess: async () => outcome(reply("## Scope\nx\n\n## Findings\n- found\n\n## Confidence\nHigh")),
  };
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Interrupted");
  createTaskDir(deps.root, deps.configDir, task);
  for (const step of ["clarifying", "scouting"] as TaskState[]) transition(task, step);
  saveTask(deps.root, deps.configDir, task);

  const resumed = await runWorkflowAction(
    { action: "scout", taskId: "TASK-1", domains: ["backend"] } as OrchestrateParams,
    deps,
  );
  assert.equal(resumed.ok, true, resumed.message);
  assert.equal(resumed.state, "synthesizing");
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.state, "synthesizing");
});

test("a task left mid-review can re-run the review after a crash", async () => {
  const deps: WorkflowDeps = {
    root: mkdtempSync(join(tmpdir(), "dh-rel3-")),
    configDir: ".pi",
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    ask: async () => undefined,
    choose: async () => undefined,
    notify: () => {},
    runProcess: async () => outcome(reply("## Verdict\nPASS\n\n## Verification\n- npm test")),
  };
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Interrupted review");
  createTaskDir(deps.root, deps.configDir, task);
  for (const step of ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "reviewing"] as TaskState[]) {
    transition(task, step);
  }
  saveTask(deps.root, deps.configDir, task);

  const resumed = await runWorkflowAction({ action: "review", taskId: "TASK-1", domain: "backend" } as OrchestrateParams, deps);
  assert.equal(resumed.ok, true, resumed.message);
  assert.equal(resumed.state, "reviewing");
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.reviewIterations.backend, 1);
});
