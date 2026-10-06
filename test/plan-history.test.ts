import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanningSession, planningId } from "../src/lobby/planner.ts";
import { archivePlan, deletePlan, keepPlan, previousPlans, readPlan } from "../src/state/plan-history.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const PLAN = "## Status\nREADY\n## Title\nExport as CSV\n## Plan\n### Steps\n1. Add the button";
const runner: ProcessRunner = async () => ({ exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: PLAN }], stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } }), stderr: "", killed: false, timedOut: false });

function session(root: string): PlanningSession {
  return new PlanningSession({ cwd: root, root, configDir: ".pi", panel: [], profile: () => ({ thinking: "high", timeoutMs: 60_000 }), runProcess: runner });
}

test("a plan left without saving it is a previous plan: listed, archived, deleted; saved as a task, it is flagged and leaves the list", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-plans-"));
  const empty = session(root);
  keepPlan(root, ".pi", empty.id, empty.createdAt, empty.snapshot());
  assert.deepEqual(previousPlans(root, ".pi"), [], "a plan nobody started is not kept");

  const left = session(root);
  await left.send("export the task list as CSV");
  keepPlan(root, ".pi", left.id, left.createdAt, left.snapshot());
  const saved = session(root);
  await saved.send("plan dark mode");
  keepPlan(root, ".pi", saved.id, saved.createdAt, saved.snapshot());
  assert.deepEqual(previousPlans(root, ".pi").map((plan) => plan.title).sort(), ["Export as CSV", "Export as CSV"]);
  assert.deepEqual(previousPlans(root, ".pi", { except: left.id }).map((plan) => plan.id), [saved.id], "the plan on screen is not a previous plan");

  saved.save();
  keepPlan(root, ".pi", saved.id, saved.createdAt, saved.snapshot());
  assert.match(readPlan(root, ".pi", saved.id)!.savedAs![0]!, /^PLAN-/, "saving it as a task flags it");
  assert.deepEqual(previousPlans(root, ".pi").map((plan) => plan.id), [left.id], "and it leaves the previous plans");
  assert.throws(() => archivePlan(root, ".pi", saved.id, true), /saved as a task/);

  const summary = previousPlans(root, ".pi")[0]!;
  assert.deepEqual([summary.messages, summary.rounds, summary.hasDraft], [2, 1, true]);
  archivePlan(root, ".pi", left.id, true);
  assert.deepEqual(previousPlans(root, ".pi"), []);
  assert.deepEqual(previousPlans(root, ".pi", { archived: true }).map((plan) => plan.id), [left.id]);
  keepPlan(root, ".pi", left.id, left.createdAt, left.snapshot());
  assert.ok(readPlan(root, ".pi", left.id)!.archivedAt, "keeping it again does not unarchive it");
  archivePlan(root, ".pi", left.id, false);
  assert.deepEqual(previousPlans(root, ".pi").map((plan) => plan.id), [left.id]);

  const restored = PlanningSession.restore({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "high", timeoutMs: 60_000 }) }, readPlan(root, ".pi", left.id)!.snapshot);
  assert.equal(restored.id, left.id, "carried on, it is the same plan");
  assert.equal(restored.reply?.plan?.includes("Add the button"), true);

  deletePlan(root, ".pi", left.id);
  assert.equal(readPlan(root, ".pi", left.id), undefined);
  assert.throws(() => deletePlan(root, ".pi", "../escape"), /no plan/);
  assert.match(planningId(), /^PS-[a-z0-9]+$/);
});
