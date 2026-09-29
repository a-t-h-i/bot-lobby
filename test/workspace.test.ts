import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { branchName, createWorkspace, describeWorkspace, gitLine, missingWorktree, taskCwd, worktreesRoot, type GitRunner } from "../src/execution/workspace.ts";

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A repository on `main` with one commit (or none), in a real temp folder. */
function repo(commit = true): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bl-ws-")));
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.email", "test@example.com");
  sh(root, "config", "user.name", "Test");
  if (commit) {
    writeFileSync(join(root, "readme.md"), "hello\n");
    sh(root, "add", "-A");
    sh(root, "commit", "-qm", "init");
  }
  return root;
}

const NAME = "Task-Change-Table-Font-27-09-2026";

test("branch mode creates and checks out a branch named after the task, keeping uncommitted work", async () => {
  const root = repo();
  writeFileSync(join(root, "wip.txt"), "not committed yet\n");
  const made = await createWorkspace({ cwd: root, root, configDir: ".pi", name: NAME, mode: "branch" });
  assert.equal(typeof made, "object");
  const git = made as Exclude<typeof made, string>;
  assert.deepEqual([git.mode, git.branch, git.from], ["branch", NAME, "main"]);
  assert.equal(git.base, sh(root, "rev-parse", "HEAD"));
  assert.equal(git.path, undefined, "a branch has no folder of its own");
  assert.equal(sh(root, "branch", "--show-current"), NAME);
  assert.ok(existsSync(join(root, "wip.txt")), "work in progress comes along");
});

test("a branch name already taken gets a number, also when only a remote has it", async () => {
  const root = repo();
  sh(root, "branch", NAME);
  const second = await createWorkspace({ cwd: root, root, configDir: ".pi", name: NAME, mode: "branch" });
  assert.equal((second as { branch: string }).branch, `${NAME}-2`);
  sh(root, "checkout", "-q", "main");
  sh(root, "update-ref", `refs/remotes/origin/${NAME}-3`, "HEAD");
  const third = await createWorkspace({ cwd: root, root, configDir: ".pi", name: NAME, mode: "branch" });
  assert.equal((third as { branch: string }).branch, `${NAME}-4`, "-2 is a local branch, -3 a remote one");
});

test("worktree mode makes a second checkout on the new branch and leaves the main one alone", async () => {
  const root = repo();
  const made = await createWorkspace({ cwd: root, root, configDir: ".pi", name: NAME, mode: "worktree" });
  const git = made as Exclude<typeof made, string>;
  assert.equal(git.mode, "worktree");
  assert.equal(git.path, join(worktreesRoot(root, ".pi"), NAME));
  assert.equal(git.path, join(root, ".pi", "bot-lobby", "worktrees", NAME));
  assert.ok(existsSync(join(git.path!, "readme.md")), "the files are checked out there");
  assert.equal(sh(git.path!, "branch", "--show-current"), NAME);
  assert.equal(sh(root, "branch", "--show-current"), "main", "the main checkout stays where it was");
  // The worktree never shows up as untracked in the main checkout.
  assert.match(readFileSync(join(root, ".git", "info", "exclude"), "utf8"), /# bot-lobby: one worktree per task\n\/\.pi\/bot-lobby\/worktrees\/\n/);
  writeFileSync(join(root, ".pi", "bot-lobby", "note.txt"), "x");
  assert.doesNotMatch(sh(root, "status", "--porcelain", "--untracked-files=all"), /worktrees/);
  // A second task adds a second worktree and the exclude stays one line.
  const other = await createWorkspace({ cwd: root, root, configDir: ".pi", name: "Task-Other-27-09-2026", mode: "worktree" });
  assert.ok(existsSync((other as { path: string }).path));
  assert.equal(readFileSync(join(root, ".git", "info", "exclude"), "utf8").split("/.pi/bot-lobby/worktrees/").length, 2);
});

test("a folder that is not a repository, or a repository git cannot use, runs the task without isolation", async () => {
  const plain = realpathSync(mkdtempSync(join(tmpdir(), "bl-ws-plain-")));
  assert.equal(await createWorkspace({ cwd: plain, root: plain, configDir: ".pi", name: NAME, mode: "branch" }), "this folder is not a git repository");
  // No commit yet: a branch can still be made, a worktree has nothing to start from.
  const fresh = repo(false);
  const branch = await createWorkspace({ cwd: fresh, root: fresh, configDir: ".pi", name: NAME, mode: "branch" });
  assert.equal((branch as { branch: string }).branch, NAME);
  const empty = repo(false);
  assert.match(await createWorkspace({ cwd: empty, root: empty, configDir: ".pi", name: NAME, mode: "worktree" }) as string, /needs at least one commit/);
  // A failing checkout comes back as one line.
  const failing: GitRunner = async (_cwd, args) => {
    if (args[0] === "checkout") throw new Error("your local changes would be overwritten");
    return args[0] === "rev-parse" ? "/repo" : "";
  };
  assert.equal(await createWorkspace({ cwd: "/repo", root: "/repo", configDir: ".pi", name: NAME, mode: "branch", git: failing }), `could not create branch ${NAME} — your local changes would be overwritten`);
});

test("the agents' folder is the worktree; a worktree that was removed is reported, not worked around", async () => {
  const root = repo();
  const made = await createWorkspace({ cwd: root, root, configDir: ".pi", name: NAME, mode: "worktree" }) as { mode: "worktree"; branch: string; path: string };
  assert.equal(taskCwd({ git: made }, root), made.path);
  assert.equal(taskCwd({}, root), root, "a task without isolation works where the session does");
  assert.equal(taskCwd({ git: { mode: "branch", branch: NAME } }, root), root, "a branch shares the working folder");
  assert.equal(missingWorktree({ git: made }), undefined);
  rmSync(made.path, { recursive: true, force: true });
  assert.match(missingWorktree({ git: made })!, new RegExp(`the worktree .* of branch ${NAME} is gone\\. Restore it with: git worktree add`));
  assert.equal(missingWorktree({}), undefined);
});

test("the oracle is told where the task's work lives", () => {
  assert.equal(gitLine(undefined), "");
  assert.match(gitLine({ mode: "branch", branch: NAME, from: "main" }), /its own branch Task-Change-Table-Font-27-09-2026 \(from main\), checked out in the working folder/);
  const worktree = gitLine({ mode: "worktree", branch: NAME, path: "/repo/.pi/bot-lobby/worktrees/x" });
  assert.match(worktree, /own worktree \/repo\/\.pi\/bot-lobby\/worktrees\/x on branch/);
  assert.match(worktree, /git -C "\/repo\/\.pi\/bot-lobby\/worktrees\/x" diff --stat/);
  assert.match(worktree, /Uncommitted changes in the main checkout are not in the worktree/);
});

test("branch names are cleaned into something git accepts", () => {
  assert.equal(branchName(NAME), NAME);
  assert.equal(branchName("Task Foo~bar^baz:qux"), "Task-Foo-bar-baz-qux");
  assert.equal(branchName("..hidden..name.lock"), "hidden.name");
  assert.equal(branchName("///"), "task");
  assert.equal(branchName("a//b"), "a/b");
});

test("the lobby's title reads the repository name and its branch, or just the folder outside git", async () => {
  const root = repo();
  assert.deepEqual(await describeWorkspace(root), { name: basename(root), branch: "main" });
  mkdirSync(join(root, "sub"));
  assert.deepEqual(await describeWorkspace(join(root, "sub")), { name: basename(root), branch: "main" }, "from inside the repository too");
  sh(root, "checkout", "-q", "-b", "feature/x");
  assert.equal((await describeWorkspace(root)).branch, "feature/x");
  sh(root, "checkout", "-q", "--detach");
  assert.equal((await describeWorkspace(root)).branch, `detached ${sh(root, "rev-parse", "--short", "HEAD")}`);
  assert.deepEqual(await describeWorkspace(repo(false)).then((info) => info.branch), "main", "an unborn branch still has its name");
  const plain = realpathSync(mkdtempSync(join(tmpdir(), "my-folder-")));
  assert.deepEqual(await describeWorkspace(plain), { name: basename(plain) });
});
