import { realpathSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import type { Task } from "../schemas/task.ts";
import { command, type DeliveryContext } from "./transport.ts";

export interface Source { repository: string; remote: string; github: string; branch: string; commit: string; cwd: string }
export function sha(value: string): string {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error("Missing or invalid commit identity; commit completed work and refresh review.");
  return value;
}
function githubRemote(remote: string): string {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
  if (!match?.[1] || match[1].split("/").some((v) => v === "." || v === "..")) throw new Error("Origin must identify a GitHub repository without credentials; configure origin and refresh review.");
  return match[1];
}
async function common(ctx: DeliveryContext): Promise<string> {
  const dir = await command(ctx, "git", ["rev-parse", "--git-common-dir"]);
  return realpathSync(resolve(ctx.cwd, dir));
}
export async function readSource(task: Task, ctx: DeliveryContext): Promise<Source> {
  if (!task.git) throw new Error("Task has no Git isolation. Preserve the completed work and configure a task branch before delivery.");
  const branch = task.git.branch;
  if (!branch || branch === "main" || branch.startsWith("-") || /[\s\x00-\x1f]/.test(branch)) throw new Error("Invalid task branch; delivery cannot use main as its source.");
  await command(ctx, "git", ["check-ref-format", "--branch", branch]);
  const repository = await common(ctx);
  const path = task.git.mode === "worktree" ? task.git.path : ctx.cwd;
  if (!path || !isAbsolute(path)) throw new Error("Task working directory is missing; restore its isolated worktree.");
  const sourceCtx = { ...ctx, cwd: realpathSync(path) };
  if (await common(sourceCtx) !== repository) throw new Error("Task worktree belongs to a different repository; restore isolation.");
  if (await command(sourceCtx, "git", ["symbolic-ref", "--short", "HEAD"]) !== branch) throw new Error("Task branch is not checked out in its working directory; restore it and refresh review.");
  if (await command(sourceCtx, "git", ["status", "--porcelain"])) throw new Error("Task source has uncommitted changes. Commit only completed task work, then refresh review.");
  const commit = sha(await command(sourceCtx, "git", ["rev-parse", `refs/heads/${branch}^{commit}`]));
  const remote = await command(sourceCtx, "git", ["remote", "get-url", "origin"]);
  return { repository, remote, github: githubRemote(remote), branch, commit, cwd: sourceCtx.cwd };
}
export async function refreshMain(ctx: DeliveryContext): Promise<string> {
  await command(ctx, "git", ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  return sha(await command(ctx, "git", ["rev-parse", "refs/remotes/origin/main^{commit}"]));
}
