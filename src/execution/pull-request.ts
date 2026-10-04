/**
 * Open the pull request for a task that has finished. Every agent of a task
 * commits its own work on the task's branch, so a completed task usually has
 * commits nobody has pushed and no review anyone can see. Pushing and opening
 * the pull request here means the oracle reports a link the user can click.
 * Nothing in here may throw: a missing git, a missing GitHub CLI, a repository
 * with no remote or a read-only branch must never make a completion fail, so
 * every path returns either the pull request's URL or one readable line saying
 * why there is none.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Task } from "../schemas/task.ts";
import { runGit, taskCwd, type GitRunner } from "./workspace.ts";

const run = promisify(execFile);
const TIMEOUT_MS = 60_000;

/** Runs the GitHub CLI in a folder; resolves with trimmed stdout, rejects with gh's own message. */
export type GhRunner = (cwd: string, args: readonly string[]) => Promise<string>;

export const runGh: GhRunner = async (cwd, args) => {
  try {
    const { stdout } = await run("gh", [...args], { cwd, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    return stdout.trim();
  } catch (error) {
    const failure = error as { stderr?: string; message: string; code?: unknown };
    // A missing gh binary reads as that, not as a spawn error.
    if (failure.code === "ENOENT") throw new Error("the GitHub CLI is not installed");
    throw new Error(firstLine(failure.stderr) || firstLine(failure.message) || "gh failed");
  }
};

function firstLine(text: string | undefined): string {
  return text?.split("\n").find((line) => line.trim())?.trim() ?? "";
}

export interface PullRequestResult {
  /** The pull request's URL, from the one already open or the one just created. */
  url?: string;
  /** One short line saying why there is no pull request; never a stack trace. */
  skipped?: string;
}

export interface PullRequestDeps {
  /** The session's working folder; a worktree task works in its own folder instead. */
  cwd: string;
  git?: GitRunner;
  gh?: GhRunner;
  /** What the task achieved, for the pull request's body. */
  summary?: string;
}

/** One line, for a task title used as a commit message or a pull request title. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Commit whatever the agents left uncommitted; failing here is not fatal (nothing to commit, no git identity). */
async function commitLeftovers(git: GitRunner, cwd: string, title: string): Promise<void> {
  const dirty = await git(cwd, ["status", "--porcelain"]).catch(() => "");
  if (!dirty.trim()) return;
  await git(cwd, ["add", "-A"]).catch(() => "");
  await git(cwd, ["commit", "-m", oneLine(title)]).catch(() => "");
}

/** The pull request already open for the branch, if any (a rerun must not open a second one). */
async function existingPr(gh: GhRunner, cwd: string, branch: string): Promise<string | undefined> {
  const raw = await gh(cwd, ["pr", "view", branch, "--json", "url"]).catch(() => "");
  if (!raw) return undefined;
  try {
    return (JSON.parse(raw) as { url?: string }).url?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The pull request's body: the task, its id, what it did, and QA's verdict. */
function prBody(task: Task, summary: string): string {
  const lines = [oneLine(task.title), "", `Task: ${task.id}`, ...summary.trim().split("\n").map((line) => `- ${line.trim()}`)];
  if (task.qaVerdict) lines.push(`QA: ${task.qaVerdict}`);
  return lines.join("\n");
}

/** Create the pull request and read its URL out of gh's output. */
async function createPr(gh: GhRunner, cwd: string, task: Task, branch: string, summary: string): Promise<PullRequestResult> {
  const args = ["pr", "create", "--title", oneLine(task.title), "--head", branch, "--body", prBody(task, summary)];
  if (task.git?.from) args.push("--base", task.git.from);
  const url = (await gh(cwd, args)).match(/https:\/\/\S+/g)?.at(-1);
  return url ? { url } : { skipped: "GitHub did not return a pull request URL" };
}

/**
 * Push the task's branch and make its pull request. Resolves to the pull
 * request's URL, or to one line saying why there is none; it never throws.
 */
export async function openPullRequest(task: Task, deps: PullRequestDeps): Promise<PullRequestResult> {
  const branch = task.git?.branch;
  if (!branch) return { skipped: "the task has no branch of its own" };
  const git = deps.git ?? runGit;
  const gh = deps.gh ?? runGh;
  const cwd = taskCwd(task, deps.cwd);
  const summary = deps.summary?.trim() || task.proposal?.trim() || oneLine(task.title);
  try {
    await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    return { skipped: `the task's folder is not a git repository — ${(error as Error).message}` };
  }
  await commitLeftovers(git, cwd, task.title);
  try {
    await git(cwd, ["push", "-u", "origin", branch]);
  } catch (error) {
    return { skipped: `the branch could not be pushed — ${(error as Error).message}` };
  }
  const open = await existingPr(gh, cwd, branch);
  if (open) return { url: open };
  try {
    return await createPr(gh, cwd, task, branch, summary);
  } catch (error) {
    return { skipped: `no pull request could be created — ${(error as Error).message}` };
  }
}
