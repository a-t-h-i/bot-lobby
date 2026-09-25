import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { truncate } from "../text.ts";

const run = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout.trim();
}

/** `git diff HEAD`, falling back to index+worktree when HEAD does not exist yet. */
async function diffAgainstHead(cwd: string): Promise<string> {
  try {
    return await git(cwd, ["diff", "HEAD"]);
  } catch {
    const [unstaged, staged] = await Promise.all([git(cwd, ["diff"]), git(cwd, ["diff", "--cached"])]);
    return [unstaged, staged].filter((part) => part.length > 0).join("\n");
  }
}

/**
 * Repository evidence for a reviewer: working-tree status plus the diff against
 * HEAD. Returns an explanatory string instead of throwing when git is unusable
 * so a review can still proceed on other evidence.
 */
export async function readRepositoryDiff(cwd: string, limitChars = 20_000): Promise<string> {
  try {
    const [status, diff] = await Promise.all([
      git(cwd, ["status", "--porcelain"]),
      diffAgainstHead(cwd),
    ]);
    const parts = [
      status ? `Status:\n${status}` : "Status: clean working tree",
      diff ? `Diff (HEAD):\n${diff}` : "Diff (HEAD): none",
    ];
    return truncate(parts.join("\n\n"), limitChars);
  } catch (error) {
    return `Unable to read git state: ${(error as Error).message}`;
  }
}
