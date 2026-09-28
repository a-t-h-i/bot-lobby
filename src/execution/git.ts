import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { truncate } from "../text.ts";

const run = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout.trim();
}

/** `git diff <base>` (HEAD by default), falling back to index+worktree when HEAD does not exist yet. */
async function diffAgainst(cwd: string, base: string, extra: readonly string[] = [], paths: readonly string[] = []): Promise<string> {
  try {
    return await git(cwd, ["diff", ...extra, base, "--", ...paths]);
  } catch {
    const [unstaged, staged] = await Promise.all([git(cwd, ["diff", ...extra, "--", ...paths]), git(cwd, ["diff", ...extra, "--cached", "--", ...paths])]);
    return [unstaged, staged].filter((part) => part.length > 0).join("\n");
  }
}

/** The commit HEAD points at, or undefined (no commits yet, or no git). */
export async function headCommit(cwd: string): Promise<string | undefined> {
  try {
    return (await git(cwd, ["rev-parse", "--verify", "HEAD"])) || undefined;
  } catch {
    return undefined;
  }
}

/** The newest commit on HEAD made before `iso` (where a task started), or undefined. */
export async function commitBefore(cwd: string, iso: string): Promise<string | undefined> {
  try {
    return (await git(cwd, ["rev-list", "-1", `--before=${iso}`, "HEAD"])) || undefined;
  } catch {
    return undefined;
  }
}

export interface DiffOptions {
  /** Bound on the whole text. */
  limitChars?: number;
  /** The commit to compare with (where the task started), so work already committed still shows; HEAD when absent. */
  base?: string;
  /** Paths (relative to `cwd`) left out: bot-lobby's own records. */
  exclude?: readonly string[];
}

/** Longest new file shown whole; past it (or binary) only its name is listed. */
const MAX_NEW_FILE_CHARS = 4000;
const MAX_NEW_FILE_BYTES = 200 * 1024;

/**
 * Repository evidence for a reviewer: working-tree status, the files changed
 * since `base` (listed first, so a long diff never hides which files moved),
 * the diff itself, and the content of new files (which `git diff` leaves
 * out). Returns an explanatory string instead of throwing when git is
 * unusable so a review can still proceed on other evidence.
 */
export async function readRepositoryDiff(cwd: string, options: DiffOptions = {}): Promise<string> {
  const limit = options.limitChars ?? 20_000;
  const paths = options.exclude?.length ? [".", ...options.exclude.map((path) => `:(exclude)${path}`)] : [];
  const base = options.base ?? "HEAD";
  const label = options.base ? `since ${options.base.slice(0, 7)}, where the task started (committed work included)` : "HEAD";
  try {
    const [status, stat, diff, untracked] = await Promise.all([
      git(cwd, ["status", "--porcelain", "--", ...paths]),
      diffAgainst(cwd, base, ["--stat"], paths),
      diffAgainst(cwd, base, [], paths),
      git(cwd, ["ls-files", "--others", "--exclude-standard", "--", ...paths]),
    ]);
    const head = [
      status ? `Status:\n${status}` : "Status: clean working tree",
      stat ? `Changed files (${label}):\n${stat}` : "",
    ].filter(Boolean).join("\n\n");
    const fresh = untracked ? newFiles(cwd, untracked.split("\n").filter(Boolean)) : "";
    const room = Math.max(0, limit - head.length);
    // The diff and the new files share what is left; new files get at least a third when there are any.
    const diffRoom = fresh ? Math.max(Math.floor(room * 0.66), room - fresh.length) : room;
    const parts = [
      head,
      diff ? `Diff (${label}):\n${truncate(diff, diffRoom)}` : `Diff (${label}): none`,
      fresh ? `New files (untracked):\n${truncate(fresh, Math.max(0, room - Math.min(diff.length, diffRoom)))}` : "",
    ];
    return truncate(parts.filter(Boolean).join("\n\n"), limit + 200);
  } catch (error) {
    return `Unable to read git state: ${(error as Error).message}`;
  }
}

/** New files as a reviewer reads them: each whole when it is small text, otherwise just named. */
function newFiles(cwd: string, files: readonly string[]): string {
  return files.map((file) => {
    try {
      const path = join(cwd, file);
      if (statSync(path).size > MAX_NEW_FILE_BYTES) return `--- ${file} (large; read it directly)`;
      const text = readFileSync(path, "utf8");
      if (text.includes("\0")) return `--- ${file} (binary)`;
      return `--- ${file}\n${truncate(text, MAX_NEW_FILE_CHARS)}`;
    } catch {
      return `--- ${file} (unreadable)`;
    }
  }).join("\n\n");
}

/** Most changed files one look reports; the rest are summarised by the diff. */
export const MAX_CHANGED_FILES = 400;

/**
 * The repository's top folder and every file changed, relative to it: what
 * `git status` reports (renames by their new path, untracked files one by
 * one), plus what was committed since `base`; undefined when git is unusable.
 */
export async function changedFiles(cwd: string, base?: string): Promise<{ top: string; files: string[] } | undefined> {
  try {
    const [top, status, committed] = await Promise.all([
      git(cwd, ["rev-parse", "--show-toplevel"]),
      run("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd, maxBuffer: MAX_BUFFER }),
      // Work committed since the task started is still the task's to review.
      base ? run("git", ["diff", "--name-only", "-z", base], { cwd, maxBuffer: MAX_BUFFER }).then((result) => result.stdout, () => "") : Promise.resolve(""),
    ]);
    const entries = status.stdout.split("\0");
    const files = new Set<string>();
    for (let index = 0; index < entries.length && files.size < MAX_CHANGED_FILES; index += 1) {
      const entry = entries[index]!;
      if (entry.length < 4) continue;
      files.add(entry.slice(3));
      // A rename or copy is followed by the path it came from.
      if (/[RC]/.test(entry.slice(0, 2))) index += 1;
    }
    for (const file of committed.split("\0")) if (file && files.size < MAX_CHANGED_FILES) files.add(file);
    return { top, files: [...files] };
  } catch {
    return undefined;
  }
}
