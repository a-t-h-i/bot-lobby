import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../src/execution/agent-runner.ts";
import { runWorkflowAction } from "../src/workflow/workflow.ts";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";

/**
 * Real end-to-end check against the installed pi binary. Skipped unless
 * BOT_LOBBY_E2E=1 because it spends tokens and needs a configured model.
 */
const enabled = process.env.BOT_LOBBY_E2E === "1";

test("backend scout runs in an isolated pi process", { skip: !enabled, timeout: 300_000 }, async () => {
  const run = await runAgent({
    taskId: "TASK-E2E",
    domain: "backend",
    role: "scout",
    instruction: "List the top-level files of this repository in one short paragraph. Do not modify anything.",
    context: { task: "Verify the bot-lobby agent runner works end to end." },
    timeoutMs: 240_000,
    cwd: process.cwd(),
  });
  assert.equal(run.status, "success", `expected success, got ${run.status}: ${run.error ?? ""}`);
  assert.ok(run.output.length > 0, "scout should return findings");
  assert.equal(run.role, "scout");
  assert.ok(run.usage && run.usage.turns > 0);
});

test("workflow runs a real scout and advances to synthesizing", { skip: !enabled, timeout: 300_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "dh-e2e-wf-"));
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-E2E", "Document the repository layout");
  createTaskDir(root, ".pi", task);
  transition(task, "clarifying");
  const result = await runWorkflowAction(
    { action: "scout", taskId: "TASK-E2E", domains: ["backend"], instruction: "List the top-level entries of this repository." },
    {
      root,
      configDir: ".pi",
      cwd: process.cwd(),
      config: DEFAULT_CONFIG,
      ask: async () => undefined,
      choose: async () => undefined,
      notify: () => {},
    },
  );
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state, "synthesizing");
  assert.equal(loadTask(root, ".pi", "TASK-E2E")!.state, "synthesizing");
  assert.match(result.message, /Scout results/);
});

test("an active task injects the Master prompt into a real pi session", { skip: !enabled, timeout: 180_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "dh-e2e-inject-"));
  ensureProjectStructure(root, ".pi");
  const sessionId = "e2e-inject";
  const task = createTask("TASK-INJECT", "Document the repository layout");
  createTaskDir(root, ".pi", task);
  for (const step of ["clarifying", "scouting", "synthesizing"] as const) transition(task, step);
  transition(task, "awaiting_approval");
  transition(task, "planning");
  transition(task, "implementing");
  const { saveTask } = await import("../src/state/persistence.ts");
  task.ownerSessionId = sessionId;
  saveTask(root, ".pi", task);

  const entry = join(process.cwd(), "src", "index.ts");
  const result = spawnSync(
    "pi",
    ["-e", entry, "--no-session", "--session-id", sessionId, "-p", "State the active bot-lobby task id and the exact 'Next legal states' line from your instructions. Nothing else."],
    { cwd: root, encoding: "utf8", timeout: 150_000 },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /TASK-INJECT/, `expected the injected task id, got: ${output.slice(0, 400)}`);
  assert.match(output, /reviewing, blocked, abandoned/, "expected the injected workflow context");
});
