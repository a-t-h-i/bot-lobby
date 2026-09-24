import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
 * DEV_HOUSE_E2E=1 because it spends tokens and needs a configured model.
 */
const enabled = process.env.DEV_HOUSE_E2E === "1";

test("backend scout runs in an isolated pi process", { skip: !enabled, timeout: 300_000 }, async () => {
  const run = await runAgent({
    taskId: "TASK-E2E",
    domain: "backend",
    role: "scout",
    instruction: "List the top-level files of this repository in one short paragraph. Do not modify anything.",
    context: { task: "Verify the dev-house agent runner works end to end." },
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
