/**
 * A worktree per worker for a parallel batch. Each worker gets its own
 * checkout of the task's working tree as it stood when the batch began
 * (uncommitted changes included), so workers never queue for each other's
 * files; when the batch ends, each worker's change is applied back to the
 * task's tree in turn. A change that no longer applies (two workers touched
 * the same lines) is kept as a patch for the oracle to hand back to its
 * owner, never forced in.
 *
 * Ignored folders (`node_modules`, virtualenvs, build caches) are linked
 * into each worktree from the main checkout, so workers can build and test.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";

const TIMEOUT_MS = 120_000;
/** Ignored folders linked into a worktree, at most. */
const MAX_LINKS = 200;

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run git, resolving with its output and exit code (never rejecting on a non-zero exit). */
export function git(cwd: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<GitResult> {
  return new Promise((done) => {
    const child = execFile("git", [...args], { cwd, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...options.env } }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
      done({ stdout: String(stdout), stderr: String(stderr), code });
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

async function gitOk(cwd: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<string> {
  const result = await git(cwd, args, options);
  if (result.code !== 0) throw new Error(result.stderr.trim().split("\n")[0]?.replace(/^(fatal|error):\s*/i, "") || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export interface WorkerTree {
  /** The worktree's own folder. */
  dir: string;
  /** Where the worker runs: the task's folder inside the worktree. */
  cwd: string;
  /** Ignored folders linked in from the main checkout, relative to the worktree. */
  links: string[];
}

export interface TreeBatch {
  /** The task tree's repository top, where changes are applied back. */
  top: string;
  /** The commit (never on any branch) holding the tree as the batch began. */
  base: string;
  /** Where the batch's worktrees live, removed when it closes. */
  home: string;
  trees: Map<string, WorkerTree>;
}

/**
 * The working tree as a commit, untracked files included (ignored ones are
 * not), built in a private index so the user's own index is never touched.
 */
export async function snapshotTree(top: string): Promise<string> {
  const head = await gitOk(top, ["rev-parse", "--verify", "HEAD"]);
  const scratch = mkdtempSync(join(tmpdir(), "bl-index-"));
  const env = { GIT_INDEX_FILE: join(scratch, "index") };
  try {
    await gitOk(top, ["read-tree", head], { env });
    await gitOk(top, ["add", "-A"], { env });
    const tree = await gitOk(top, ["write-tree"], { env });
    return await gitOk(top, ["commit-tree", tree, "-p", head, "-m", "bot-lobby: parallel batch base"], { env });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Ignored folders of the main checkout, relative to its top (`node_modules`, `webui/node_modules`). */
async function ignoredFolders(top: string): Promise<string[]> {
  const listed = await gitOk(top, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]).catch(() => "");
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("/"))
    .map((line) => line.slice(0, -1))
    .filter((line) => line && !line.startsWith(".git"))
    .slice(0, MAX_LINKS);
}

/** Link each ignored folder of the main checkout into a worktree, where its parent exists and nothing is there yet. */
function linkIgnored(top: string, dir: string, folders: readonly string[]): string[] {
  const linked: string[] = [];
  for (const folder of folders) {
    const target = join(dir, folder);
    if (existsSync(target) || !existsSync(dirname(target))) continue;
    try {
      symlinkSync(join(top, folder), target, process.platform === "win32" ? "junction" : "dir");
      linked.push(folder);
    } catch {
      // A folder that cannot be linked is left out: the worker finds it missing and says so.
    }
  }
  return linked;
}

/**
 * One worktree per worker, each a detached checkout of the tree as it stands
 * now. Returns why not (not a repository, no commits yet) as one line when it
 * cannot, and the batch then runs on the file desk.
 */
export async function openWorkerTrees(cwd: string, workers: readonly string[]): Promise<TreeBatch | string> {
  let top: string;
  try {
    top = realpathSync(await gitOk(cwd, ["rev-parse", "--show-toplevel"]));
  } catch {
    return "this folder is not a git repository";
  }
  let base: string;
  try {
    base = await snapshotTree(top);
  } catch (error) {
    return `git could not snapshot the working tree (${(error as Error).message})`;
  }
  const home = mkdtempSync(join(tmpdir(), "bl-trees-"));
  const batch: TreeBatch = { top, base, home, trees: new Map() };
  const folders = await ignoredFolders(top);
  const inside = relative(top, realpathSync(cwd));
  try {
    for (const worker of workers) {
      const dir = join(home, worker.replace(/[^A-Za-z0-9_-]/g, "-"));
      await gitOk(top, ["worktree", "add", "--detach", dir, base]);
      const links = linkIgnored(top, dir, folders);
      batch.trees.set(worker, { dir: realpathSync(dir), cwd: inside && !inside.startsWith("..") ? join(realpathSync(dir), inside) : realpathSync(dir), links });
    }
  } catch (error) {
    await closeWorkerTrees(batch);
    return `git could not add a worktree (${(error as Error).message})`;
  }
  return batch;
}

/** What one worker changed in its worktree, as a binary patch against the batch's base; "" when nothing. */
export async function workerPatch(batch: TreeBatch, worker: string): Promise<string> {
  const tree = batch.trees.get(worker);
  if (!tree) return "";
  // The links are the main checkout's folders, never the worker's change.
  const excludes = tree.links.map((link) => `:(exclude,top)${link}`);
  await gitOk(tree.dir, ["add", "-A", "--", ".", ...excludes]);
  const patch = await gitOk(tree.dir, ["diff", "--cached", "--binary", batch.base]);
  return patch ? `${patch}\n` : "";
}

export type MergeOutcome = { worker: string; status: "applied" | "empty" } | { worker: string; status: "conflict"; patch: string; reason: string };

/**
 * Apply each worker's change back to the task's tree, in order. A change
 * that does not apply cleanly is saved under `patchDir` and reported; it is
 * never half-applied.
 */
export async function mergeWorkerTrees(batch: TreeBatch, order: readonly string[], patchDir: string): Promise<MergeOutcome[]> {
  const outcomes: MergeOutcome[] = [];
  for (const worker of order) {
    let patch: string;
    try {
      patch = await workerPatch(batch, worker);
    } catch (error) {
      outcomes.push({ worker, status: "conflict", patch: "", reason: `its change could not be read (${(error as Error).message})` });
      continue;
    }
    if (!patch.trim()) {
      outcomes.push({ worker, status: "empty" });
      continue;
    }
    const check = await git(batch.top, ["apply", "--check", "--binary", "--whitespace=nowarn", "-"], { input: patch });
    const applied = check.code === 0 ? await git(batch.top, ["apply", "--binary", "--whitespace=nowarn", "-"], { input: patch }) : check;
    if (applied.code === 0) {
      outcomes.push({ worker, status: "applied" });
      continue;
    }
    const file = join(patchDir, `${worker}-${Date.now()}.patch`);
    mkdirSync(patchDir, { recursive: true });
    writeFileSync(file, patch);
    outcomes.push({ worker, status: "conflict", patch: file, reason: applied.stderr.trim().split("\n").slice(0, 3).join(" ") || "it does not apply to the tree as the other workers left it" });
  }
  return outcomes;
}

/** A path a worker edited inside its worktree, as the same path in the task's tree. */
export function mapToTop(batch: TreeBatch, worker: string, path: string): string {
  const tree = batch.trees.get(worker);
  if (!tree) return path;
  const rel = relative(tree.dir, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? join(batch.top, rel) : path;
}

/** Remove every worktree of the batch and its folder. Never throws. */
export async function closeWorkerTrees(batch: TreeBatch): Promise<void> {
  for (const tree of batch.trees.values()) {
    // Unlink the borrowed folders first, so removing the worktree can never reach into the main checkout's.
    for (const link of tree.links) {
      try {
        unlinkSync(join(tree.dir, link));
      } catch {
        // Already gone.
      }
    }
    await git(batch.top, ["worktree", "remove", "--force", tree.dir]);
  }
  rmSync(batch.home, { recursive: true, force: true });
  await git(batch.top, ["worktree", "prune"]);
}
