import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask } from "../src/schemas/task.ts";
import type { Exec } from "../src/lobby/issues.ts";
import { readChecks } from "../src/delivery/checks.ts";
import { readRules } from "../src/delivery/rules.ts";
import { completionReview, deferReview, refreshReview, localVerified, validateReview } from "../src/delivery/review.ts";
import { createTaskDir, loadTask, saveTask } from "../src/state/persistence.ts";

const commit = "a".repeat(40);
const main = "b".repeat(40);
function injected(responses: Record<string, unknown>): Exec {
  return async (_tool, args, options) => {
    assert.equal(options?.timeout, 20_000);
    const value = responses[args[1]!] ?? responses[args[1]!.split("?")[0]!];
    if (value === undefined || value instanceof Error) return { code: 1, stdout: "", stderr: "lookup failed" };
    return { code: 0, stdout: JSON.stringify(value), stderr: "" };
  };
}
function emptyChecks(): Record<string, unknown> {
  const base = `repos/acme/repo/commits/${commit}`;
  return { [`${base}/check-runs`]: { total_count: 0, check_runs: [] },
    [`${base}/status`]: { sha: commit, state: "pending", total_count: 0, statuses: [] }, [`${base}/statuses`]: [] };
}
function openRules(): Record<string, unknown> {
  return { "repos/acme/repo/branches/main": { name: "main", protected: false }, "repos/acme/repo/rules/branches/main": [] };
}
test("checks absent requires both well-formed successful check and status reads", async () => {
  assert.equal((await readChecks({ cwd: "/", exec: injected(emptyChecks()) }, "acme/repo", commit)).state, "absent");
  for (const suffix of ["check-runs", "status", "statuses"]) {
    for (const bad of [new Error("404"), {}, null]) {
      const responses = { ...emptyChecks(), [`repos/acme/repo/commits/${commit}/${suffix}`]: bad };
      assert.equal((await readChecks({ cwd: "/", exec: injected(responses) }, "acme/repo", commit)).state, "unavailable");
    }
  }
});
test("checks distinguish pending failing passing and stale source identities", async () => {
  for (const [status, conclusion, head_sha, expected] of [
    ["in_progress", null, commit, "pending"], ["completed", "failure", commit, "failing"],
    ["completed", "success", commit, "passing"], ["completed", "success", main, "stale"],
  ]) {
    const responses = { ...emptyChecks(), [`repos/acme/repo/commits/${commit}/check-runs`]: { total_count: 1, check_runs: [{ name: "ci", status, conclusion, head_sha }] } };
    assert.equal((await readChecks({ cwd: "/", exec: injected(responses) }, "acme/repo", commit)).state, expected);
  }
});
test("rules fail closed for malformed responses errors and unsupported/restricted push policies", async () => {
  const ctx = (responses: Record<string, unknown>) => ({ cwd: "/", exec: injected(responses) });
  assert.equal((await readRules(ctx(openRules()), "acme/repo")).known, true);
  for (const bad of [new Error("404"), {}, { name: "main" }, { name: "main", protected: "false" }]) {
    assert.equal((await readRules(ctx({ ...openRules(), "repos/acme/repo/branches/main": bad }), "acme/repo")).known, false);
  }
  for (const type of ["pull_request", "merge_queue", "required_linear_history", "required_signatures", "update", "unknown_future_policy"]) {
    assert.ok((await readRules(ctx({ ...openRules(), "repos/acme/repo/rules/branches/main": [{ type }] }), "acme/repo")).blocked);
  }
  assert.equal((await readRules(ctx({ ...openRules(), "repos/acme/repo/rules/branches/main": new Error("404") }), "acme/repo")).known, false);
});
function fixture(root: string, responses: Record<string, unknown>, changes: { source?: string; dirty?: boolean; main?: string } = {}): Exec {
  const gh = injected(responses);
  return async (tool, args, options) => {
    if (tool === "gh") return gh(tool, args, options);
    assert.equal(options?.timeout, 20_000);
    assert.equal(args.includes("push") || args.includes("merge"), false);
    let stdout = "";
    if (args.includes("--git-common-dir")) stdout = root;
    else if (args[0] === "symbolic-ref") stdout = "task-x";
    else if (args[0] === "status") stdout = changes.dirty ? " M file" : "";
    else if (args[0] === "rev-parse") stdout = args[1]?.includes("origin/main") ? changes.main ?? main : changes.source ?? commit;
    else if (args[0] === "remote") stdout = "https://github.com/acme/repo.git";
    return { code: 0, stdout, stderr: "" };
  };
}
test("review stable snapshots deferral source/main/check changes missing required and PR independence", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-delivery-"));
  try {
    const task = createTask("T", "Delivery"); task.state = "completed"; task.plan = "verified"; task.qaVerdict = "pass";
    task.git = { mode: "branch", branch: "task-x" };
    const responses = { ...emptyChecks(), ...openRules() };
    const changes: { source?: string; dirty?: boolean; main?: string } = {};
    const ctx = { cwd: root, exec: fixture(root, responses, changes) };
    task.delivery = await completionReview(task, root, ctx);
    assert.equal(task.delivery.status, "pending_approval");
    await refreshReview(task, ctx);
    assert.equal(task.delivery.verification?.checks, "absent"); assert.equal(task.delivery.blocked.merge_main, undefined);
    const id = task.delivery.reviewId;
    deferReview(task, id); await refreshReview(task, ctx);
    assert.equal(task.delivery.reviewId, id); assert.equal(task.delivery.status, "deferred");
    createTaskDir(root, ".pi", task); saveTask(root, ".pi", task);
    assert.equal(loadTask(root, ".pi", "T")!.delivery!.status, "deferred");
    changes.main = "c".repeat(40); await refreshReview(task, ctx);
    assert.notEqual(task.delivery.reviewId, id); assert.throws(() => validateReview(task, id), /changed/);
    responses["repos/acme/repo/rules/branches/main"] = [{ type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "ci", integration_id: null }] } }];
    await refreshReview(task, ctx); assert.match(task.delivery.blocked.merge_main!, /Required checks missing/);
    responses["repos/acme/repo/rules/branches/main"] = new Error("404");
    await refreshReview(task, ctx); assert.equal(task.delivery.blocked.create_pr, undefined); assert.ok(task.delivery.blocked.merge_main);
    changes.dirty = true; await refreshReview(task, ctx); assert.ok(task.delivery.blocked.create_pr);
    task.delivery.status = "successful"; task.delivery.result = { action: "merge_main", commit };
    assert.equal((await refreshReview(task, ctx)).result?.commit, commit);
    delete task.delivery; await assert.rejects(refreshReview(task, ctx), /historical/);
    task.qaWaiver = { at: "now", open: [] }; assert.equal(localVerified(task), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
