import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/execution/agent-runner.ts";

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
