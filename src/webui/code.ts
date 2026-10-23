/**
 * The code viewer's files: what changed in the project's working tree against
 * its last commit, one file's text with what the last commit held, and saving
 * an edit. Every path is jailed to the project folder (resolved with
 * `realpath`, so a symlink cannot reach out), `.git` is never read or
 * written, and git runs with arguments only, never a shell.
 */
import { execFile } from "node:child_process";
import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HttpError } from "./api/index.ts";
import type { CodeChange, CodeChanges, CodeFile, CodeSaved } from "./protocol.ts";

/** Past this many bytes a file is not sent (the page says it is too large). */
export const CODE_MAX_BYTES = 900_000;
/** At most this many changed files are listed. */
const MAX_CHANGES = 500;

function git(root: string, args: string[], maxBuffer = 8_000_000): Promise<string | undefined> {
  return new Promise((done) => {
    execFile("git", ["-c", "core.quotepath=off", ...args], { cwd: root, maxBuffer, windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      done(error ? undefined : stdout);
    });
  });
}

/** Repository-relative with forward slashes, whatever the platform. */
function slashed(path: string): string {
  return path.split(sep).join("/");
}

function insideGitDir(rel: string): boolean {
  return rel.split("/").includes(".git");
}

/** A path the page sent, as a project-relative path, or a refusal. Absolute paths must sit inside the project. */
export function projectPath(root: string, path: string): string {
  const raw = path.trim().replace(/^file:\/\//, "");
  if (!raw || raw.includes("\0") || raw.length > 4096) throw new HttpError(400, "bad_request", "name a file in the project");
  const full = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new HttpError(403, "forbidden", "that file is outside the project");
  if (insideGitDir(slashed(rel))) throw new HttpError(403, "forbidden", "the .git folder is not shown");
  return slashed(rel);
}

/** The file's real path, refused when a link leads it out of the project. */
async function jailed(root: string, rel: string): Promise<string> {
  const realRoot = await realpath(root);
  const target = join(realRoot, rel);
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    // A file that does not exist yet: its folder must still be inside.
    real = join(await realpath(dirname(target)).catch(() => dirname(target)), basename(target));
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new HttpError(403, "forbidden", "that file is outside the project");
  if (insideGitDir(slashed(relative(realRoot, real)))) throw new HttpError(403, "forbidden", "the .git folder is not shown");
  return real;
}

const STATUS: Record<string, CodeChange["status"]> = { M: "modified", T: "modified", A: "added", D: "deleted", R: "renamed", C: "added", U: "modified" };

/** `git status --porcelain=v1 -z` read into changes (index and working tree folded together). */
export function parseStatus(out: string): CodeChange[] {
  const parts = out.split("\0");
  const changes: CodeChange[] = [];
  for (let at = 0; at < parts.length; at++) {
    const entry = parts[at]!;
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code === "??") {
      changes.push({ path, status: "untracked" });
      continue;
    }
    if (code === "!!") continue;
    const letter = code[1] !== " " ? code[1]! : code[0]!;
    const renamed = code[0] === "R" || code[0] === "C";
    const from = renamed ? parts[++at] : undefined;
    const status = code.includes("D") ? "deleted" : renamed && code[0] === "R" ? "renamed" : STATUS[letter] ?? "modified";
    changes.push({ path, status, ...(from && status === "renamed" ? { from } : {}) });
  }
  return changes;
}

/** `git diff --numstat -z HEAD` as added and removed lines per path (binary files count none). */
export function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
  const counts = new Map<string, { additions: number; deletions: number }>();
  const parts = out.split("\0");
  for (let at = 0; at < parts.length; at++) {
    const entry = parts[at]!;
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(entry);
    if (!match) continue;
    let path = match[3]!;
    // A rename names no path on its line; the old and new paths follow.
    if (!path) {
      at += 2;
      path = parts[at] ?? "";
    }
    counts.set(path, { additions: Number(match[1]) || 0, deletions: Number(match[2]) || 0 });
  }
  return counts;
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** Every changed file in the working tree against HEAD, with its line counts. */
export async function codeChanges(root: string): Promise<CodeChanges> {
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status === undefined) return { git: false, files: [], truncated: false };
  const head = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const numstat = head ? parseNumstat((await git(root, ["diff", "--numstat", "-z", "-M", "HEAD"])) ?? "") : new Map();
  const all = parseStatus(status).filter((change) => !insideGitDir(change.path));
  const files = all.slice(0, MAX_CHANGES);
  for (const file of files) {
    const counted = numstat.get(file.path);
    if (counted) Object.assign(file, counted);
    else if (file.status === "untracked" || file.status === "added") {
      try {
        const real = await jailed(root, file.path);
        const info = await stat(real);
        if (info.isFile() && info.size <= CODE_MAX_BYTES) {
          const text = await readFile(real, "utf8");
          if (!text.includes("\0")) Object.assign(file, { additions: lineCount(text), deletions: 0 });
        }
      } catch {
        // Counts stay off for a file that cannot be read.
      }
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { git: true, files, truncated: all.length > files.length };
}

/** A bare file name (`zen.ts`, as the activity log says it) as the one project file it names, changed files first. */
async function findByName(root: string, name: string): Promise<string | undefined> {
  if (name.includes("/") || name.includes("\\")) return undefined;
  const changed = (await codeChanges(root)).files.filter((file) => file.status !== "deleted" && basename(file.path) === name);
  if (changed.length > 0) return changed[0]!.path;
  const listed = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], 32_000_000);
  if (!listed) return undefined;
  const matches = listed.split("\0").filter((path) => path && basename(path) === name);
  return matches.length > 0 ? matches.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0] : undefined;
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

/** What HEAD holds for the file, or undefined when it holds nothing (a new file, no commits, no git). */
async function headText(root: string, rel: string, from?: string): Promise<string | undefined> {
  const out = await git(root, ["show", `HEAD:${from ?? rel}`], CODE_MAX_BYTES * 2);
  return out === undefined || out.includes("\0") ? undefined : out;
}

/** One file to show: its text (unless binary or too large), its change, and what the last commit held. */
export async function codeRead(root: string, path: string): Promise<CodeFile> {
  let rel = projectPath(root, path);
  let real = await jailed(root, rel);
  let info = await lstat(real).then(() => stat(real)).catch(() => undefined);
  if (!info) {
    const found = await findByName(root, rel);
    if (found) {
      rel = found;
      real = await jailed(root, rel);
      info = await stat(real).catch(() => undefined);
    }
  }
  const change = (await codeChanges(root)).files.find((file) => file.path === rel);
  if (!info && change?.status !== "deleted") throw new HttpError(404, "not_found", `${rel} is not in the project`);
  if (info && !info.isFile()) throw new HttpError(400, "bad_request", `${rel} is not a file`);
  const original = change && change.status !== "untracked" && change.status !== "added" ? await headText(root, rel, change.from) : undefined;
  const base: CodeFile = { path: rel, size: info?.size ?? 0, mtimeMs: info?.mtimeMs ?? 0, exists: Boolean(info), ...(change ? { change } : {}), ...(original !== undefined ? { original } : {}) };
  if (!info) return { ...base, contents: "" };
  if (info.size > CODE_MAX_BYTES) return { ...base, tooLarge: true };
  const buffer = await readFile(real);
  if (looksBinary(buffer)) return { ...base, binary: true };
  return { ...base, contents: buffer.toString("utf8") };
}

/**
 * Save the file. `mtimeMs` is when the page read it: a file changed on disk
 * since (an agent edited it) is not overwritten unless `force` says so.
 */
export async function codeSave(root: string, body: { path: string; contents: string; mtimeMs?: number; force?: boolean }): Promise<CodeSaved> {
  const rel = projectPath(root, body.path);
  const real = await jailed(root, rel);
  const info = await stat(real).catch(() => undefined);
  if (!info) throw new HttpError(404, "not_found", `${rel} is no longer in the project`);
  if (!info.isFile()) throw new HttpError(400, "bad_request", `${rel} is not a file`);
  if (!body.force && body.mtimeMs !== undefined && Math.abs(info.mtimeMs - body.mtimeMs) > 1) {
    throw new HttpError(409, "conflict", `${rel} changed on disk since you opened it`);
  }
  await writeFile(real, body.contents, "utf8");
  const after = await stat(real);
  return { path: rel, mtimeMs: after.mtimeMs, notice: `saved ${rel}` };
}
