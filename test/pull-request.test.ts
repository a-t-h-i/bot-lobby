import { test } from "node:test";
import assert from "node:assert/strict";
import { openPullRequest, type GhRunner } from "../src/execution/pull-request.ts";
import type { GitRunner } from "../src/execution/workspace.ts";
import type { Task } from "../src/schemas/task.ts";

const BRANCH = "Task-Fix-Chat-01-10-2026";

interface Call {
  cwd: string;
  args: readonly string[];
}

/** Fake git: records every call, answers `status --porcelain` with `dirty`, and fails when `fails` matches. */
function fakeGit(state: { dirty?: string; fails?: string } = {}): { runner: GitRunner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: GitRunner = async (cwd, args) => {
    calls.push({ cwd, args });
    if (state.fails && args.includes(state.fails)) throw new Error(`git says no: ${state.fails}`);
    if (args[0] === "status") return state.dirty ?? "";
    return "";
  };
  return { runner, calls };
}

/** Fake gh: records every call, answers `pr view` with `view` and `pr create` with `created` (or fails when `fails`). */
function fakeGh(state: { view?: string; created?: string; fails?: string } = {}): { runner: GhRunner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: GhRunner = async (cwd, args) => {
    calls.push({ cwd, args });
    if (state.fails) throw new Error(state.fails);
    if (args[1] === "view") {
      if (!state.view) throw new Error("no pull requests found for branch");
      return state.view;
    }
    return state.created ?? "";
  };
  return { runner, calls };
}

function task(overrides: Partial<Task> = {}): Task {
  return { id: "Task-Fix-Chat-01-10-2026", title: "Fix the chat input", proposal: "", ...overrides } as Task;
}

function branchTask(overrides: Partial<Task> = {}): Task {
  return task({ git: { mode: "branch", branch: BRANCH, from: "main" }, ...overrides });
}

test("a task without a branch of its own is skipped before any command runs", async () => {
  const git = fakeGit();
  const gh = fakeGh();
  const result = await openPullRequest(task(), { cwd: "/repo", git: git.runner, gh: gh.runner });
  assert.deepEqual(result, { skipped: "the task has no branch of its own" });
  assert.deepEqual([git.calls.length, gh.calls.length], [0, 0]);
});

test("a worktree task is pushed and opened from its own worktree folder", async () => {
  const git = fakeGit();
  const gh = fakeGh({ created: "https://github.com/o/r/pull/7\n" });
  const path = "/projects/.pi/bot-lobby/worktrees/Task-Fix-Chat";
  const result = await openPullRequest(branchTask({ git: { mode: "worktree", branch: BRANCH, path } }), {
    cwd: "/repo",
    git: git.runner,
    gh: gh.runner,
  });
  assert.equal(result.url, "https://github.com/o/r/pull/7");
  assert.ok(git.calls.every((call) => call.cwd === path), "git works in the worktree");
  assert.ok(gh.calls.every((call) => call.cwd === path), "gh works in the worktree");
});

test("a dirty tree is committed before the push, a clean one is not", async () => {
  const dirty = fakeGit({ dirty: " M src/app/Composer.tsx" });
  await openPullRequest(branchTask(), { cwd: "/repo", git: dirty.runner, gh: fakeGh({ created: "https://github.com/o/r/pull/7" }).runner });
  assert.ok(dirty.calls.some((call) => call.args[0] === "add" && call.args[1] === "-A"));
  assert.deepEqual(dirty.calls.find((call) => call.args[0] === "commit")?.args, ["commit", "-m", "Fix the chat input"]);

  const clean = fakeGit();
  await openPullRequest(branchTask(), { cwd: "/repo", git: clean.runner, gh: fakeGh({ created: "https://github.com/o/r/pull/7" }).runner });
  assert.ok(!clean.calls.some((call) => call.args[0] === "commit"), "a clean tree commits nothing");
});

test("a branch that cannot be pushed is skipped with git's own words, and gh is never called", async () => {
  const git = fakeGit({ fails: "push" });
  const gh = fakeGh({ created: "https://github.com/o/r/pull/7" });
  const result = await openPullRequest(branchTask(), { cwd: "/repo", git: git.runner, gh: gh.runner });
  assert.match(String(result.skipped), /git says no: push/);
  assert.equal(result.url, undefined);
  assert.deepEqual(gh.calls, []);
});

test("an already open pull request is reported, not opened a second time", async () => {
  const gh = fakeGh({ view: JSON.stringify({ url: "https://github.com/o/r/pull/3" }), created: "https://github.com/o/r/pull/9" });
  const result = await openPullRequest(branchTask(), { cwd: "/repo", git: fakeGit().runner, gh: gh.runner });
  assert.equal(result.url, "https://github.com/o/r/pull/3");
  assert.ok(!gh.calls.some((call) => call.args[1] === "create"), "gh pr create never runs");
});

test("the created pull request carries the task title, its branch, and a body with the id and summary", async () => {
  const gh = fakeGh({ created: "Creating pull request\nhttps://github.com/o/r/pull/7\n" });
  const result = await openPullRequest(branchTask({ qaVerdict: "pass" }), {
    cwd: "/repo",
    git: fakeGit().runner,
    gh: gh.runner,
    summary: "- the input grows by itself\n- the expand button is gone",
  });
  assert.equal(result.url, "https://github.com/o/r/pull/7");
  const args = [...(gh.calls.at(-1)?.args ?? [])];
  assert.deepEqual(args.slice(0, 2), ["pr", "create"]);
  assert.deepEqual([args[args.indexOf("--title") + 1], args[args.indexOf("--head") + 1]], ["Fix the chat input", BRANCH]);
  assert.deepEqual([args[args.indexOf("--base") + 1]], ["main"]);
  const body = args[args.indexOf("--body") + 1] ?? "";
  assert.ok(body.includes("Task-Fix-Chat-01-10-2026"), "the body names the task");
  assert.ok(body.includes("- the input grows by itself"), "the body's first summary bullet");
  assert.ok(body.includes("QA: pass"));
});

test("a missing GitHub CLI is one readable line, not a throw", async () => {
  const gh = fakeGh({ fails: "the GitHub CLI is not installed" });
  const result = await openPullRequest(branchTask(), { cwd: "/repo", git: fakeGit().runner, gh: gh.runner });
  assert.equal(result.url, undefined);
  assert.match(String(result.skipped), /CLI/);
});

test("GitHub answering without a URL leaves one short reason", async () => {
  const result = await openPullRequest(branchTask(), { cwd: "/repo", git: fakeGit().runner, gh: fakeGh({ created: "done" }).runner });
  assert.deepEqual(result, { skipped: "GitHub did not return a pull request URL" });
});
