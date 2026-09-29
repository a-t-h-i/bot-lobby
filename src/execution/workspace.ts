/**
 * Where a task's work lives in git. A task can get a branch of its own
 * (`branch`: created and checked out in the working folder) or a worktree of
 * its own (`worktree`: a second checkout on that branch, which every agent of
 * the task runs in, so tasks never trample each other's files). Both are named
 * after the task. Every failure comes back as one readable line and the task
 * simply runs without isolation: git being unusable must never stop a task.
 */
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { TaskGit } from "../schemas/task.ts";
import { dataRoot } from "../state/project.ts";

const run = promisify(execFile);
const TIMEOUT_MS = 30_000;

/** Runs git in a folder; resolves with trimmed stdout, rejects with git's own message. */
export type GitRunner = (cwd: string, args: readonly string[]) => Promise<string>;

export const runGit: GitRunner = async (cwd, args) => {
  try {
    const { stdout } = await run("git", [...args], { cwd, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    return stdout.trim();
  } catch (error) {
    const failure = error as { stderr?: string; message: string; code?: unknown };
    // A missing git binary reads as that, not as a spawn error.
    if (failure.code === "ENOENT") throw new Error("git is not installed");
    throw new Error(firstLine(failure.stderr) || firstLine(failure.message) || "git failed");
  }
};

function firstLine(text: string | undefined): string {
  return text?.split("\n").find((line) => line.trim())?.trim().replace(/^(fatal|error):\s*/i, "") ?? "";
}

/** Where a task's worktrees live: `<project>/<configDir>/bot-lobby/worktrees`. */
export function worktreesRoot(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "worktrees");
}

/** A branch name git accepts, made from a task's friendly name (which already is one, bar odd characters). */
export function branchName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\s~^:?*[\\]+/g, "-")
    .replace(/@\{/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\/{2,}/g, "/")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^[-./]+|[-./]+$/g, "")
    .replace(/\.lock$/i, "");
  return cleaned || "task";
}

/** The first of `name`, `name-2`, `name-3`… that no branch (local or remote) already uses. */
async function freeBranch(git: GitRunner, top: string, name: string): Promise<string> {
  const base = branchName(name);
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const taken = await git(top, ["for-each-ref", "--count=1", "--format=%(refname)", `refs/heads/${candidate}`, `refs/remotes/*/${candidate}`]).catch(() => "");
    if (!taken) return candidate;
  }
  throw new Error(`every branch name like ${base} is taken`);
}

/** Keep the worktrees out of `git add -A` in the main checkout (a local exclude; nothing is committed). */
async function excludeWorktrees(git: GitRunner, top: string, root: string, configDir: string): Promise<void> {
  try {
    const inside = relative(top, worktreesRoot(root, configDir));
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) return;
    const file = resolve(top, await git(top, ["rev-parse", "--git-path", "info/exclude"]));
    const line = `/${inside.split(sep).join("/")}/`;
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (current.split("\n").some((entry) => entry.trim() === line)) return;
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}# bot-lobby: one worktree per task\n${line}\n`);
  } catch {
    // Only a convenience: a read-only .git leaves the worktrees showing as untracked.
  }
}

export interface WorkspaceRequest {
  /** The folder the task starts from (the session's working folder). */
  cwd: string;
  root: string;
  configDir: string;
  /** The task's friendly name: the branch takes it. */
  name: string;
  mode: "branch" | "worktree";
  git?: GitRunner;
}

/**
 * Give a task its branch (or worktree and branch). Returns what was made, or
 * one line saying why not (not a repository, no commits for a worktree, a
 * failed checkout); the task then runs without.
 */
export async function createWorkspace(request: WorkspaceRequest): Promise<TaskGit | string> {
  const git = request.git ?? runGit;
  let top: string;
  try {
    top = await git(request.cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return "this folder is not a git repository";
  }
  const [current, head] = await Promise.all([
    git(top, ["branch", "--show-current"]).catch(() => ""),
    git(top, ["rev-parse", "--verify", "HEAD"]).catch(() => ""),
  ]);
  let branch: string;
  try {
    branch = await freeBranch(git, top, request.name);
    await git(top, ["check-ref-format", "--branch", branch]);
  } catch (error) {
    return `no valid branch name for ${request.name} — ${(error as Error).message}`;
  }
  const from = current || (head ? `detached at ${head.slice(0, 7)}` : undefined);
  const base = { branch, ...(from ? { from } : {}), ...(head ? { base: head } : {}) };
  if (request.mode === "branch") {
    try {
      await git(top, ["checkout", "-b", branch]);
    } catch (error) {
      return `could not create branch ${branch} — ${(error as Error).message}`;
    }
    return { mode: "branch", ...base };
  }
  if (!head) return "a worktree needs at least one commit to start from; commit first, or use a branch";
  const path = join(worktreesRoot(request.root, request.configDir), branch);
  try {
    mkdirSync(dirname(path), { recursive: true });
    await git(top, ["worktree", "add", "-b", branch, path, head]);
  } catch (error) {
    return `could not create a worktree for ${branch} — ${(error as Error).message}`;
  }
  await excludeWorktrees(git, top, request.root, request.configDir);
  return { mode: "worktree", ...base, path };
}

/** The folder a task's agents run in: its worktree when it has one, otherwise where the session works. */
export function taskCwd(task: { git?: TaskGit }, cwd: string): string {
  return task.git?.mode === "worktree" && task.git.path ? task.git.path : cwd;
}

/** Why a task's worktree cannot be used (it was removed), or undefined when it is there or the task has none. */
export function missingWorktree(task: { git?: TaskGit }): string | undefined {
  const git = task.git;
  if (git?.mode !== "worktree" || !git.path || existsSync(git.path)) return undefined;
  return `the worktree ${git.path} of branch ${git.branch} is gone. Restore it with: git worktree add ${JSON.stringify(git.path)} ${git.branch}`;
}

/** The line that tells the oracle where the task's work lives; empty for a task without isolation. */
export function gitLine(git: TaskGit | undefined): string {
  if (!git) return "";
  const from = git.from ? ` (from ${git.from})` : "";
  if (git.mode === "branch") return `Git: this task works on its own branch ${git.branch}${from}, checked out in the working folder. Commit there; never switch branches.`;
  return [
    `Git: this task works in its own worktree ${git.path} on branch ${git.branch}${from}. Every agent runs there.`,
    `Your own tools run in the main checkout, so look at the task's files under ${git.path} (git -C ${JSON.stringify(git.path)} diff --stat), and never edit outside it.`,
    "Uncommitted changes in the main checkout are not in the worktree.",
  ].join(" ");
}

/** What the lobby's title shows: the repository (or folder) and the branch checked out in it. */
export interface WorkspaceInfo {
  name: string;
  branch?: string;
}

/** Repository (or folder) name and branch of a working folder; a folder outside git has only its name. */
export async function describeWorkspace(cwd: string, git: GitRunner = runGit): Promise<WorkspaceInfo> {
  let top: string;
  try {
    top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return { name: basename(cwd) || cwd };
  }
  const name = basename(top) || top;
  const branch = await git(top, ["branch", "--show-current"]).catch(() => "");
  if (branch) return { name, branch };
  // Detached (or an unborn branch): the commit, when there is one.
  const head = await git(top, ["rev-parse", "--short", "HEAD"]).catch(() => "");
  return head ? { name, branch: `detached ${head}` } : { name };
}
