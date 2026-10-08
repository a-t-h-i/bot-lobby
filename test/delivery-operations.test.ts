import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createTask } from "../src/schemas/task.ts";
import { completionReview, refreshReview } from "../src/delivery/review.ts";
import { deliver, type DeliveryRequest } from "../src/delivery/operations.ts";
import { acquireDeliveryLock, recoverDeliveryLock, type LockIdentity } from "../src/delivery/lock.ts";
import type { Exec } from "../src/lobby/issues.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTaskDir, loadTask, saveTask } from "../src/state/persistence.ts";
import { setAutoMode } from "../src/state/auto.ts";
import { runWorkflowAction } from "../src/workflow/workflow.ts";

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function repositories(root: string) {
  const repo = join(root, "repo"), bare = join(root, "remote.git"), source = join(root, "source");
  git(root, "init", "--bare", bare); git(root, "init", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.invalid");
  writeFileSync(join(repo, "base"), "base"); git(repo, "add", "."); git(repo, "commit", "-m", "base");
  git(repo, "remote", "add", "origin", bare); git(repo, "push", "origin", "main");
  git(repo, "worktree", "add", "-b", "task-x", source);
  writeFileSync(join(source, "task"), "task"); git(source, "add", "."); git(source, "commit", "-m", "task");
  return { repo, bare, source };
}
interface Controls { pulls: unknown[]; calls: string[][]; losePush?: boolean; failPush?: boolean; failCreate?: boolean; loseCreate?: boolean; failing?: boolean; unknown?: boolean }
function github(args: string[], controls: Controls): unknown {
  if (args[0] === "pr" && args[1] === "list") return controls.pulls;
  const endpoint = args[1]!;
  if (endpoint.includes("check-runs")) return { total_count: controls.failing ? 1 : 0, check_runs: controls.failing ? [{ name: "ci", head_sha: endpoint.split("/")[4], status: "completed", conclusion: "failure" }] : [] };
  if (endpoint.endsWith("/status")) return { sha: endpoint.split("/")[4], state: "pending", total_count: 0, statuses: [] };
  if (endpoint.includes("/statuses")) return [];
  if (endpoint.endsWith("branches/main")) return { name: "main", protected: false };
  if (endpoint.includes("rules/branches/main")) return [];
  throw new Error(`Unmapped fake GitHub command: ${args.join(" ")}`);
}
function executor(paths: ReturnType<typeof repositories>, controls: Controls): Exec {
  return async (tool, args, options) => {
    controls.calls.push([tool, ...args]);
    if (tool === "git") return executeGit(paths, controls, args, options!.cwd!);
    assert.equal(tool, "gh");
    if (controls.unknown && args[0] === "api") return { code: 1, stdout: "", stderr: "auth" };
    if (args[0] === "pr" && args[1] === "create") return createPull(paths, controls);
    return { code: 0, stdout: JSON.stringify(github(args, controls)), stderr: "" };
  };
}
function executeGit(paths: ReturnType<typeof repositories>, c: Controls, args: string[], cwd: string) {
  if (args[0] === "remote" && args[1] === "get-url") return { code: 0, stdout: "https://github.com/acme/repo.git", stderr: "" };
  if (c.failPush && args[0] === "push") return { code: 1, stdout: "", stderr: "fake rejected push" };
  const mapped = args.map((arg) => arg === "origin" ? paths.bare : arg);
  // Fetch refspec still writes refs/remotes/origin/main; no command ever contacts GitHub.
  const result = spawnSync("git", mapped, { cwd, encoding: "utf8", timeout: 10_000 });
  if (c.losePush && args[0] === "push") return { code: 1, stdout: "", stderr: "lost response" };
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}
function createPull(paths: ReturnType<typeof repositories>, c: Controls) {
  if (!c.failCreate) c.pulls = [{ number: 7, url: "https://github.com/acme/repo/pull/7", state: "OPEN", headRefName: "task-x", baseRefName: "main", headRefOid: git(paths.bare, "rev-parse", "refs/heads/task-x") }];
  return { code: c.failCreate || c.loseCreate ? 1 : 0, stdout: "", stderr: "fake response" };
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "delivery-ops-"));
  try { await run(await setup(root)); } finally { rmSync(root, { recursive: true, force: true }); }
}
async function setup(root: string) {
  const paths = repositories(root), controls: Controls = { pulls: [], calls: [] };
  const ctx = { cwd: paths.repo, exec: executor(paths, controls) };
  const task = createTask("T", "Task"); task.state = "completed"; task.plan = "verified"; task.qaVerdict = "pass";
  task.git = { mode: "worktree", branch: "task-x", path: paths.source };
  task.delivery = await completionReview(task, paths.repo, ctx); await refreshReview(task, ctx);
  let persisted = structuredClone(task);
  const store = { identity: { projectRoot: paths.repo, configDir: root },
    recoveryStore: (identity: LockIdentity) => {
      assert.equal(identity.projectRoot, paths.repo); assert.equal(identity.configDir, root); assert.equal(identity.taskId, task.id);
      return { load: () => structuredClone(persisted), save: (t: typeof task) => { persisted = structuredClone(t); } };
    },
    load: () => structuredClone(persisted), save: (t: typeof task) => { persisted = structuredClone(t); } };
  const request = (action: DeliveryRequest["action"]): DeliveryRequest => ({ reviewId: persisted.delivery!.reviewId, action, confirmMain: true });
  return { root, paths, controls, ctx, store, request, current: () => persisted };
}
test("explicit approval and confirmation mandatory, blocked failing merge and independent PR", async () => fixture(async (f) => {
  await assert.rejects(deliver({ ...f.request("merge_main"), confirmMain: false }, f.ctx, f.store), /confirmation/);
  await assert.rejects(deliver({ ...f.request("create_pr"), reviewId: "wrong" }, f.ctx, f.store), /changed/);
  assert.equal(f.controls.calls.some((c) => c.includes("push") || c.includes("create")), false);
  f.controls.unknown = true;
  let result = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(result.status, "pending_approval"); assert.ok(result.blocked.merge_main);
  result = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.equal(result.result!.pullNumber, 7);
}));
test("PR lost push/create responses reconcile and successful duplicate never republishes", async () => fixture(async (f) => {
  f.controls.losePush = true; f.controls.loseCreate = true;
  const result = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(result.status, "successful");
  const calls = f.controls.calls.filter((c) => c.includes("push") || c.includes("create")).length;
  assert.equal((await deliver(f.request("create_pr"), f.ctx, f.store)).status, "successful");
  assert.equal(f.controls.calls.filter((c) => c.includes("push") || c.includes("create")).length, calls);
}));
test("branch pushed PR failed persists intent and retries stable identity without second push", async () => fixture(async (f) => {
  f.controls.failCreate = true;
  const failed = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(failed.status, "recoverable_failure"); assert.equal(failed.operation!.stage, "branch_pushed");
  const id = failed.operation!.id;
  f.controls.failCreate = false;
  const result = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.equal(result.operation!.id, id);
  assert.equal(f.controls.calls.filter((c) => c.includes("push")).length, 1);
}));
test("isolated merge excludes dirty checkout and unrelated local main commits; lost push reconciles", async () => fixture(async (f) => {
  writeFileSync(join(f.paths.repo, "unrelated"), "local"); git(f.paths.repo, "add", "."); git(f.paths.repo, "commit", "-m", "unrelated local main");
  writeFileSync(join(f.paths.repo, "base"), "dirty");
  f.controls.losePush = true;
  const result = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.ok(result.operation!.mergeCommit);
  assert.equal(git(f.paths.bare, "ls-tree", "--name-only", "main").includes("unrelated"), false);
  assert.equal(readFileSync(join(f.paths.repo, "base"), "utf8"), "dirty");
  assert.equal(f.controls.calls.some((c) => c.includes("--force") && c.includes("push")), false);
  assert.equal(existsSync(f.paths.source), false);
  assert.equal(result.operation!.worktreeRemoved, true);
  assert.equal(git(f.paths.repo, "rev-parse", "task-x"), result.operation!.sourceCommit);
  const removals = f.controls.calls.filter((c) => c[1] === "worktree" && c[2] === "remove" && c[3] === f.paths.source);
  assert.equal(removals.length, 1);
  await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(f.controls.calls.filter((c) => c[1] === "worktree" && c[2] === "remove" && c[3] === f.paths.source).length, 1);
}));
test("merge succeeded push failed restart retries recorded commit and identity", async () => fixture(async (f) => {
  f.controls.failPush = true;
  const failed = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(failed.status, "recoverable_failure"); assert.ok(failed.operation!.mergeCommit);
  assert.equal(existsSync(f.paths.source), true);
  const id = failed.operation!.id, commit = failed.operation!.mergeCommit;
  f.controls.failPush = false;
  const result = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.equal(result.operation!.id, id); assert.equal(result.operation!.mergeCommit, commit);
  assert.equal(f.controls.calls.filter((c) => c[1] === "merge").length, 1);
}));
test("stale source and remote main consume approval without publishing", async () => fixture(async (f) => {
  writeFileSync(join(f.paths.source, "new"), "new"); git(f.paths.source, "add", "."); git(f.paths.source, "commit", "-m", "changed source");
  const old = f.request("create_pr");
  const result = await deliver(old, f.ctx, f.store);
  assert.equal(result.status, "pending_approval"); assert.notEqual(result.reviewId, old.reviewId);
  assert.equal(f.controls.calls.some((c) => c.includes("push") || c.includes("create")), false);
}));
test("remote main movement invalidates reviewed approval", async () => fixture(async (f) => {
  writeFileSync(join(f.paths.repo, "remote-change"), "remote"); git(f.paths.repo, "add", "."); git(f.paths.repo, "commit", "-m", "remote update");
  git(f.paths.repo, "push", "origin", "main");
  const old = f.request("merge_main"); const result = await deliver(old, f.ctx, f.store);
  assert.equal(result.status, "pending_approval"); assert.notEqual(result.reviewId, old.reviewId);
  assert.equal(f.controls.calls.some((c) => c.includes("push") || c[1] === "merge"), false);
}));
test("normal isolated merge supports divergent history and conflict leaves remote unchanged", async () => fixture(async (f) => {
  writeFileSync(join(f.paths.repo, "main-only"), "main"); git(f.paths.repo, "add", "."); git(f.paths.repo, "commit", "-m", "main update");
  git(f.paths.repo, "push", "origin", "main");
  const task = f.store.load(); await refreshReview(task, f.ctx); f.store.save(task);
  const result = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(result.status, "successful");
  assert.equal(git(f.paths.bare, "rev-list", "--parents", "-n", "1", "main").split(" ").length, 3);
}));
test("conflicting isolated merge aborts without source or main changes", async () => fixture(async (f) => {
  writeFileSync(join(f.paths.repo, "base"), "main change"); git(f.paths.repo, "add", "."); git(f.paths.repo, "commit", "-m", "conflicting main"); git(f.paths.repo, "push", "origin", "main");
  writeFileSync(join(f.paths.source, "base"), "task change"); git(f.paths.source, "add", "."); git(f.paths.source, "commit", "-m", "conflicting task");
  const task = f.store.load(); await refreshReview(task, f.ctx); f.store.save(task);
  const before = git(f.paths.bare, "rev-parse", "main"), source = git(f.paths.source, "rev-parse", "HEAD");
  const result = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(result.status, "recoverable_failure"); assert.match(result.error!, /merge failed/);
  assert.equal(git(f.paths.bare, "rev-parse", "main"), before); assert.equal(git(f.paths.source, "rev-parse", "HEAD"), source);
}));
test("concurrent tasks targeting same canonical repository fail busy without a second push", async () => fixture(async (f) => {
  const release = acquireDeliveryLock(git(f.paths.repo, "rev-parse", "--absolute-git-dir"));
  try { await assert.rejects(deliver(f.request("create_pr"), f.ctx, f.store), /busy/); }
  finally { release(); }
  let other = f.store.load(); other.id = "other";
  const otherStore = { load: () => structuredClone(other), save: (task: typeof other) => { other = structuredClone(task); } };
  const results = await Promise.allSettled([deliver(f.request("create_pr"), f.ctx, f.store), deliver(f.request("create_pr"), f.ctx, otherStore)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.controls.calls.filter((c) => c.includes("push")).length, 1);
}));
test("closed matching PR is recoverable, never claims success or creates duplicate", async () => fixture(async (f) => {
  f.controls.pulls = [{ number: 9, url: "https://github.com/acme/repo/pull/9", state: "CLOSED", headRefName: "task-x", baseRefName: "main", headRefOid: f.current().delivery!.sourceCommit }];
  const result = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(result.status, "recoverable_failure"); assert.match(result.error!, /closed/);
  assert.equal(f.controls.calls.some((c) => c.includes("push") || c.includes("create")), false);
}));
test("fresh source approval supersedes non-delivered PR intent without losing history", async () => fixture(async (f) => {
  f.controls.failCreate = true;
  const failed = await deliver(f.request("create_pr"), f.ctx, f.store);
  const oldId = failed.operation!.id;
  writeFileSync(join(f.paths.source, "new"), "new"); git(f.paths.source, "add", "."); git(f.paths.source, "commit", "-m", "new source");
  const task = f.store.load(); await refreshReview(task, f.ctx); f.store.save(task);
  assert.notEqual(task.delivery!.reviewId, failed.reviewId);
  assert.equal(task.delivery!.operation!.id, oldId);
  f.controls.failCreate = false;
  const result = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.notEqual(result.operation!.id, oldId);
  assert.equal(result.previousOperations![0]!.id, oldId);
}));
test("moved source after remote success is reconciled against persisted SHA before source validation", async () => fixture(async (f) => {
  const exec: Exec = async (tool, args, options) => {
    const result = await f.ctx.exec(tool, args, options);
    if (tool === "git" && args[0] === "push") {
      writeFileSync(join(f.paths.source, "later"), "later"); git(f.paths.source, "add", "."); git(f.paths.source, "commit", "-m", "later source");
    }
    return result;
  };
  const result = await deliver(f.request("merge_main"), { ...f.ctx, exec }, f.store);
  assert.equal(existsSync(f.paths.source), true); assert.match(result.cleanupError!, /source.*changed/i);
  const task = f.store.load(); task.delivery!.status = "in_progress"; delete task.delivery!.result; f.store.save(task);
  const before = f.controls.calls.filter((c) => c.includes("push")).length;
  const recovered = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(recovered.status, "successful"); assert.equal(recovered.result!.commit, result.result!.commit);
  assert.equal(f.controls.calls.filter((c) => c.includes("push")).length, before);
  assert.equal(existsSync(f.paths.source), true);
}));

test("dirty worktree after a verified push is retained; explicit cleanup retry never pushes again", async () => fixture(async (f) => {
  const later = join(f.paths.source, "later");
  const exec: Exec = async (tool, args, options) => {
    const result = await f.ctx.exec(tool, args, options);
    if (tool === "git" && args[0] === "push") writeFileSync(later, "keep me");
    return result;
  };
  const result = await deliver(f.request("merge_main"), { ...f.ctx, exec }, f.store);
  assert.equal(result.status, "successful"); assert.match(result.cleanupError!, /uncommitted/);
  assert.equal(readFileSync(later, "utf8"), "keep me");
  const pushes = f.controls.calls.filter((c) => c[1] === "push").length;
  await assert.rejects(deliver({ ...f.request("merge_main"), confirmMain: false }, f.ctx, f.store), /confirmation/);
  await assert.rejects(deliver({ ...f.request("merge_main"), reviewId: "stale" }, f.ctx, f.store), /changed/);
  unlinkSync(later);
  const retried = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(retried.operation!.worktreeRemoved, true); assert.equal(retried.cleanupError, undefined);
  assert.equal(existsSync(f.paths.source), false);
  assert.equal(f.controls.calls.filter((c) => c[1] === "push").length, pushes);
}));

test("completion offers verified merge and cleanup, including auto mode; no approval or failed delivery retains work", async () => {
  for (const mode of ["approve", "decline", "unanswered", "free-text", "checks-fail", "push-fails", "main-moves", "review-changes"] as const) {
    await fixture(async (f) => {
      const task = f.store.load(); task.state = "reviewing"; delete task.delivery;
      createTaskDir(f.paths.repo, ".pi", task); saveTask(f.paths.repo, ".pi", task);
      setAutoMode(f.paths.repo, ".pi", task.id, true);
      f.controls.failing = mode === "checks-fail";
      f.controls.failPush = mode === "push-fails";
      const before = git(f.paths.bare, "rev-parse", "main");
      let asked = 0;
      const result = await runWorkflowAction({ action: "complete", taskId: task.id }, {
        root: f.paths.repo, cwd: f.paths.repo, configDir: ".pi",
        config: { ...DEFAULT_CONFIG, lint: { ...DEFAULT_CONFIG.lint, mode: "off" } },
        exec: f.ctx.exec, ask: async () => undefined, notify: () => {},
        choose: async (title, options) => {
          asked++;
          const saved = loadTask(f.paths.repo, ".pi", task.id)!;
          assert.equal(saved.state, "completed"); assert.ok(saved.delivery!.fingerprint);
          assert.match(title, /pushes? main/); assert.ok(title.includes(f.paths.source));
          assert.ok(title.includes(saved.delivery!.sourceCommit!));
          if (mode === "review-changes") { saved.delivery!.status = "deferred"; saveTask(f.paths.repo, ".pi", saved); }
          if (mode === "main-moves") {
            writeFileSync(join(f.paths.repo, "remote-update"), "new main"); git(f.paths.repo, "add", "remote-update"); git(f.paths.repo, "commit", "-m", "remote update"); git(f.paths.repo, "push", "origin", "main");
          }
          return mode === "decline" ? options[1] : mode === "unanswered" ? undefined : mode === "free-text" ? "maybe later" : options[0];
        },
      });
      assert.equal(result.ok, true, `${mode}: ${result.message}`); assert.equal(result.state, "completed");
      assert.equal(asked, mode === "checks-fail" ? 0 : 1);
      const saved = loadTask(f.paths.repo, ".pi", task.id)!;
      assert.equal(existsSync(f.paths.source), mode !== "approve", `${mode}: ${result.message}`);
      if (mode === "approve") {
        assert.equal(saved.delivery!.status, "successful"); assert.equal(saved.delivery!.operation!.worktreeRemoved, true);
        assert.equal(git(f.paths.bare, "rev-parse", "main"), saved.delivery!.result!.commit);
        assert.match(result.message, /Merged and pushed main.*worktree removed/);
      } else {
        assert.equal(saved.delivery!.status, mode === "decline" || mode === "review-changes" ? "deferred" : mode === "push-fails" ? "recoverable_failure" : "pending_approval");
        if (mode !== "main-moves") assert.equal(git(f.paths.bare, "rev-parse", "main"), before);
        assert.equal(f.controls.calls.filter((c) => c[1] === "push").length, mode === "push-fails" ? 1 : 0);
      }
    });
  }
});
test("fresh main approval supersedes failed merge; check resolution requires a new explicit action", async () => fixture(async (f) => {
  f.controls.failPush = true;
  const failed = await deliver(f.request("merge_main"), f.ctx, f.store);
  writeFileSync(join(f.paths.repo, "main-only"), "main"); git(f.paths.repo, "add", "."); git(f.paths.repo, "commit", "-m", "external main"); git(f.paths.repo, "push", "origin", "main");
  f.controls.failing = true; f.controls.failPush = false;
  let task = f.store.load(); await refreshReview(task, f.ctx); f.store.save(task);
  const blockedId = task.delivery!.reviewId;
  const blocked = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.notEqual(blocked.status, "successful");
  f.controls.failing = false;
  const pushes = f.controls.calls.filter((c) => c.includes("push")).length;
  task = f.store.load(); await refreshReview(task, f.ctx); f.store.save(task);
  assert.notEqual(task.delivery!.reviewId, blockedId);
  assert.equal(f.controls.calls.filter((c) => c.includes("push")).length, pushes);
  const result = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.notEqual(result.operation!.mergeCommit, failed.operation!.mergeCommit);
  assert.equal(result.previousOperations![0]!.id, failed.operation!.id);
}));
test("partial merge with moved source requires fresh approval and a new integration", async () => fixture(async (f) => {
  f.controls.failPush = true;
  const failed = await deliver(f.request("merge_main"), f.ctx, f.store);
  writeFileSync(join(f.paths.source, "new-source"), "new"); git(f.paths.source, "add", "."); git(f.paths.source, "commit", "-m", "changed source");
  f.controls.failPush = false;
  const stale = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(stale.status, "pending_approval"); assert.notEqual(stale.reviewId, failed.reviewId);
  assert.equal(stale.operation!.mergeCommit, failed.operation!.mergeCommit);
  const result = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.notEqual(result.operation!.mergeCommit, failed.operation!.mergeCommit);
  assert.equal(result.previousOperations![0]!.mergeCommit, failed.operation!.mergeCommit);
}));
test("recovery aborts when dead owner identity changes and leaves replacement lock intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "delivery-changed-owner-")), path = join(root, "dev-house-delivery-main.lock");
  try {
    writeFileSync(path, JSON.stringify({ token: "dead", pid: 2147483647 }));
    await assert.rejects(recoverDeliveryLock(root, undefined, async () => {
      writeFileSync(path, JSON.stringify({ token: "replacement", pid: process.pid }));
    }), /changed/);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).token, "replacement");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("action change after conclusive non-delivery needs explicit approval, never converts automatically", async () => fixture(async (f) => {
  f.controls.failCreate = true;
  const failed = await deliver(f.request("create_pr"), f.ctx, f.store);
  const task = f.store.load(); await refreshReview(task, f.ctx); f.store.save(task);
  assert.equal(task.delivery!.operation!.action, "create_pr");
  const result = await deliver(f.request("merge_main"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.equal(result.operation!.action, "merge_main");
  assert.equal(result.previousOperations![0]!.id, failed.operation!.id);
}));
test("dead owner cross-task recovery is read-only; unavailable lookup keeps old intent locked", async () => fixture(async (f) => {
  f.controls.failCreate = true;
  const failed = await deliver(f.request("create_pr"), f.ctx, f.store);
  const lock = join(git(f.paths.repo, "rev-parse", "--absolute-git-dir"), "dev-house-delivery-main.lock");
  const identity = { ...f.store.identity, taskId: "T", operationId: failed.operation!.id };
  writeFileSync(lock, JSON.stringify({ token: "dead", pid: 2147483647, identity }));
  let other = f.store.load(); other.id = "other"; delete other.delivery!.operation;
  const store = { ...f.store, load: () => structuredClone(other), save: (t: typeof other) => { other = structuredClone(t); } };
  const exec: Exec = async (tool, args, options) => tool === "gh" && args[0] === "pr" && args[1] === "list" ? { code: 1, stdout: "", stderr: "auth" } : f.ctx.exec(tool, args, options);
  await assert.rejects(deliver(f.request("create_pr"), { ...f.ctx, exec }, store), /lookup failed/);
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, "dead");
  assert.equal(f.current().delivery!.operation!.id, failed.operation!.id);
  const before = f.controls.calls.filter((c) => c.includes("push") || c.includes("create")).length;
  await assert.rejects(deliver({ ...f.request("create_pr"), reviewId: "invalid" }, f.ctx, store), /changed/);
  assert.equal(f.current().delivery!.status, "recoverable_failure");
  assert.equal(f.controls.calls.filter((c) => c.includes("push") || c.includes("create")).length, before);
}));
test("dead recovery marker and two recovery racers serialize; live and EPERM owner never stolen", async () => {
  const root = mkdtempSync(join(tmpdir(), "delivery-race-")), path = join(root, "dev-house-delivery-main.lock");
  try {
    writeFileSync(path, JSON.stringify({ token: "dead", pid: 2147483647 }));
    writeFileSync(`${path}.recovery`, JSON.stringify({ token: "dead-marker", pid: 2147483647 }));
    let finish!: () => void; let count = 0;
    const first = recoverDeliveryLock(root, undefined, async () => { count++; await new Promise<void>((resolve) => { finish = resolve; }); });
    await assert.rejects(recoverDeliveryLock(root, undefined, async () => { count++; }), /busy/);
    assert.throws(() => acquireDeliveryLock(root), /busy/);
    finish(); const release = await first; assert.equal(count, 1);
    await assert.rejects(recoverDeliveryLock(root, undefined, async () => { count++; }), /busy/); release();
    writeFileSync(path, JSON.stringify({ token: "eperm", pid: 2147483647 }));
    const kill = process.kill;
    try { process.kill = (() => { throw Object.assign(new Error("permission"), { code: "EPERM" }); }) as typeof process.kill;
      await assert.rejects(recoverDeliveryLock(root, undefined, async () => { count++; }), /busy/);
    } finally { process.kill = kill; }
    assert.equal(count, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("missing isolation and target main fail closed for both actions", async () => fixture(async (f) => {
  let task = f.store.load(); delete task.git; f.store.save(task);
  let result = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(result.status, "pending_approval"); assert.ok(result.blocked.create_pr);
  task = f.store.load(); task.git = { mode: "worktree", branch: "task-x", path: f.paths.source }; f.store.save(task);
  git(f.paths.bare, "update-ref", "-d", "refs/heads/main");
  result = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(result.status, "pending_approval"); assert.ok(result.blocked.create_pr); assert.ok(result.blocked.merge_main);
  assert.equal(f.controls.calls.some((c) => c.includes("push") || c.includes("create")), false);
}));
test("lost PR response with moved source and dead owner records observable success without publishing", async () => fixture(async (f) => {
  await deliver(f.request("create_pr"), f.ctx, f.store);
  const task = f.store.load(); task.delivery!.status = "in_progress"; delete task.delivery!.result; f.store.save(task);
  const lock = join(git(f.paths.repo, "rev-parse", "--absolute-git-dir"), "dev-house-delivery-main.lock");
  writeFileSync(lock, JSON.stringify({ token: "dead", pid: 2147483647, identity: { ...f.store.identity, taskId: "T", operationId: task.delivery!.operation!.id } }));
  writeFileSync(join(f.paths.source, "later"), "later"); git(f.paths.source, "add", "."); git(f.paths.source, "commit", "-m", "later");
  const before = f.controls.calls.filter((c) => c.includes("push") || c.includes("create")).length;
  const result = await deliver(f.request("create_pr"), f.ctx, f.store);
  assert.equal(result.status, "successful"); assert.equal(result.result!.pullNumber, 7);
  assert.equal(f.controls.calls.filter((c) => c.includes("push") || c.includes("create")).length, before);
}));
test("remote authentication failure blocks publishing and tampered owner identity blocks recovery", async () => fixture(async (f) => {
  const exec: Exec = async (tool, args, options) => tool === "git" && args[0] === "remote" ? { code: 1, stdout: "", stderr: "remote missing" } : f.ctx.exec(tool, args, options);
  const result = await deliver(f.request("create_pr"), { ...f.ctx, exec }, f.store);
  assert.notEqual(result.status, "successful"); assert.ok(result.blocked.create_pr);
  const lock = join(git(f.paths.repo, "rev-parse", "--absolute-git-dir"), "dev-house-delivery-main.lock");
  writeFileSync(lock, JSON.stringify({ token: "dead", pid: 2147483647, identity: { ...f.store.identity, taskId: "foreign", operationId: "unknown" } }));
  await assert.rejects(deliver(f.request("create_pr"), f.ctx, f.store));
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, "dead");
  assert.equal(f.controls.calls.some((c) => c.includes("push") || c.includes("create")), false);
}));
test("filesystem locks refuse live/dead/symlink owners and never remove replacement token", () => {
  const root = mkdtempSync(join(tmpdir(), "delivery-lock-"));
  const path = join(root, "dev-house-delivery-main.lock");
  try {
    const release = acquireDeliveryLock(root); assert.throws(() => acquireDeliveryLock(root), /busy/);
    writeFileSync(path, JSON.stringify({ token: "replacement", pid: process.pid })); release();
    assert.equal(JSON.parse(readFileSync(path, "utf8")).token, "replacement");
    writeFileSync(path, JSON.stringify({ token: "dead", pid: 2147483647 })); assert.throws(() => acquireDeliveryLock(root), /Interrupted/);
    rmSync(path); symlinkSync(join(root, "elsewhere"), path); assert.throws(() => acquireDeliveryLock(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
