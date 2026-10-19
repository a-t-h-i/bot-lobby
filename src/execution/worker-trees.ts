/**
 * A worktree per worker for a parallel batch. Each worker gets its own
 * checkout of the task's working tree as it stood when the batch began
 * (uncommitted changes included), so workers never queue for each other's
 * files; when the batch ends, each worker's change is applied back to the
 * task's tree in turn. A change that no longer applies (two workers touched
 * the same lines) is kept as a patch and a git ref for the oracle to hand
 * back to its owner, never forced in: a patch that fails part way is rolled
 * back file by file.
 *
 * Ignored folders (`node_modules`, virtualenvs, build caches) are linked
 * into each worktree from the main checkout, so workers can build and test.
 */
import { execFile } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const TIMEOUT_MS = 120_000;
/** The batch's own commits are never on a branch, so they carry the engine's name rather than needing the user's. */
const IDENTITY = { GIT_AUTHOR_NAME: "bot-lobby", GIT_AUTHOR_EMAIL: "bot-lobby@localhost", GIT_COMMITTER_NAME: "bot-lobby", GIT_COMMITTER_EMAIL: "bot-lobby@localhost" };
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
  /** Left on disk when the batch closes, because its change could not be saved any other way. */
  keep?: boolean;
}

export interface TreeBatch {
  /** The task tree's repository top, where changes are applied back. */
  top: string;
  /** The same top as the task's folder names it (through any symlink), for paths reported back. */
  shownTop: string;
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
    return await gitOk(top, ["commit-tree", tree, "-p", head, "-m", "bot-lobby: parallel batch base"], { env: { ...env, ...IDENTITY } });
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
  const realCwd = realpathSync(cwd);
  const inside = relative(top, realCwd);
  const folders = await ignoredFolders(top);
  // A task folder inside a borrowed folder would put every worker back in the main checkout.
  const borrowed = folders.find((folder) => inside === folder || inside.startsWith(`${folder}/`) || inside.startsWith(`${folder}\\`));
  if (borrowed) return `the task's folder is inside the ignored folder ${borrowed}`;
  let base: string;
  try {
    base = await snapshotTree(top);
  } catch (error) {
    return `git could not snapshot the working tree (${(error as Error).message})`;
  }
  const home = mkdtempSync(join(tmpdir(), "bl-trees-"));
  const shownTop = resolve(cwd, relative(realCwd, top));
  const batch: TreeBatch = { top, shownTop, base, home, trees: new Map() };
  try {
    for (const worker of workers) {
      const dir = join(home, worker.replace(/[^A-Za-z0-9_-]/g, "-"));
      await gitOk(top, ["worktree", "add", "--detach", dir, base]);
      const links = linkIgnored(top, dir, folders);
      const real = realpathSync(dir);
      const workerCwd = inside && !inside.startsWith("..") ? join(real, inside) : real;
      // An empty or untracked-only task folder is not in the snapshot; the worker still starts there.
      mkdirSync(workerCwd, { recursive: true });
      batch.trees.set(worker, { dir: real, cwd: workerCwd, links });
    }
  } catch (error) {
    await closeWorkerTrees(batch);
    return `git could not add a worktree (${(error as Error).message})`;
  }
  return batch;
}

/** Pathspecs leaving out a worktree's borrowed folders, matched literally from the top. */
function linkExcludes(tree: WorkerTree): string[] {
  return tree.links.map((link) => `:(exclude,top,literal)${link}`);
}

/**
 * What one worker changed, as a commit on top of the batch's base (never on
 * a branch). Staged from everything in its worktree except the borrowed
 * folders, including anything the worker staged or committed itself.
 */
export async function workerCommit(batch: TreeBatch, worker: string): Promise<string> {
  const tree = batch.trees.get(worker);
  if (!tree) return batch.base;
  await gitOk(tree.dir, ["add", "-A", "--", ".", ...linkExcludes(tree)]);
  // A borrowed folder the worker staged itself is the main checkout's, never its change.
  if (tree.links.length > 0) await gitOk(tree.dir, ["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", ...tree.links.map((link) => `:(top,literal)${link}`)]);
  const written = await gitOk(tree.dir, ["write-tree"]);
  const baseTree = await gitOk(tree.dir, ["rev-parse", `${batch.base}^{tree}`]);
  if (written === baseTree) return batch.base;
  return gitOk(tree.dir, ["commit-tree", written, "-p", batch.base, "-m", `bot-lobby: ${worker}'s change`], { env: IDENTITY });
}

/** Paths a commit changes against the batch's base, each as it stands in the tree. */
async function changedPaths(batch: TreeBatch, commit: string): Promise<string[]> {
  const listed = await gitOk(batch.top, ["diff", "--name-only", "-z", "--no-renames", batch.base, commit]);
  return listed.split("\0").filter(Boolean);
}

/** Nested repositories the commit records (mode 160000): their files are not in it, only a pointer. */
async function gitlinks(batch: TreeBatch, commit: string): Promise<string[]> {
  const raw = await gitOk(batch.top, ["diff", "--raw", "-z", "--no-renames", batch.base, commit]);
  const fields = raw.split("\0");
  const found: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [, , newMode] = /^:(\d+) (\d+)/.exec(fields[index] ?? "") ?? [];
    if (newMode === "160000") found.push(fields[index + 1]!);
  }
  return found;
}

type Saved = { path: string; kind: "file"; data: Buffer; mode: number } | { path: string; kind: "link"; target: string } | { path: string; kind: "other" } | { path: string; kind: "none"; madeDirs: string[] };

/** Folders that would be made to hold `path`, nearest last, so a rollback can take them away again. */
function missingParents(top: string, path: string): string[] {
  const missing: string[] = [];
  for (let dir = dirname(join(top, path)); dir.length > top.length && !existsSync(dir); dir = dirname(dir)) missing.unshift(dir);
  return missing;
}

/** The current contents of each path a patch is about to touch. */
function saveFiles(top: string, paths: readonly string[]): Saved[] {
  return paths.map((path): Saved => {
    const full = join(top, path);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      return { path, kind: "none", madeDirs: missingParents(top, path) };
    }
    if (stat.isSymbolicLink()) return { path, kind: "link", target: readlinkSync(full) };
    if (stat.isFile()) return { path, kind: "file", data: readFileSync(full), mode: stat.mode };
    return { path, kind: "other" };
  });
}

function sameAsSaved(top: string, saved: Saved): boolean {
  const full = join(top, saved.path);
  try {
    const stat = lstatSync(full);
    if (saved.kind === "none") return false;
    if (saved.kind === "link") return stat.isSymbolicLink() && readlinkSync(full) === saved.target;
    if (saved.kind === "file") return stat.isFile() && (stat.mode & 0o777) === (saved.mode & 0o777) && readFileSync(full).equals(saved.data);
    return true;
  } catch {
    return saved.kind === "none";
  }
}

/** Put each saved path back as it was; returns the paths that could not be. */
function restoreFiles(top: string, saved: readonly Saved[]): string[] {
  for (const entry of saved) {
    const full = join(top, entry.path);
    try {
      if (sameAsSaved(top, entry) || entry.kind === "other") continue;
      if (existsSync(full) || isLink(full)) rmSync(full, { force: true });
      if (entry.kind === "none") {
        for (const dir of [...entry.madeDirs].reverse()) {
          if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
        }
        continue;
      }
      mkdirSync(dirname(full), { recursive: true });
      if (entry.kind === "link") symlinkSync(entry.target, full);
      else {
        writeFileSync(full, entry.data);
        chmodSync(full, entry.mode & 0o7777);
      }
    } catch {
      // Reported below by the check.
    }
  }
  return saved.filter((entry) => !sameAsSaved(top, entry)).map((entry) => entry.path);
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export type MergeOutcome =
  | { worker: string; status: "applied" | "empty" }
  | {
      worker: string;
      /** `conflict`: none of it is in the tree; `partial`: applying failed and some files could not be put back. */
      status: "conflict" | "partial";
      /** The change as a patch file ("" when it could not be written). */
      patch: string;
      /** A git ref holding the change as a commit, or the worktree kept on disk when not even that could be made. */
      saved: string;
      reason: string;
      /** For `partial`: the files left changed. */
      leftChanged?: string[];
    };

function firstLines(text: string): string {
  return text.trim().split("\n").slice(0, 3).join(" ");
}

/**
 * Apply each worker's change back to the task's tree, in order. A change
 * that does not apply cleanly is saved (a patch under `patchDir` and a ref
 * under `refs/bot-lobby/`) and reported; when applying fails part way, the
 * files it touched are put back as they were. A worker whose change could not
 * even be read keeps its worktree, which `closeWorkerTrees` then leaves alone.
 */
export async function mergeWorkerTrees(batch: TreeBatch, order: readonly string[], patchDir: string): Promise<MergeOutcome[]> {
  const outcomes: MergeOutcome[] = [];
  const stamp = Date.now();
  for (const worker of order) {
    const tree = batch.trees.get(worker);
    let commit: string;
    try {
      commit = await workerCommit(batch, worker);
    } catch (error) {
      if (tree) tree.keep = true;
      outcomes.push({ worker, status: "conflict", patch: "", saved: tree?.dir ?? "", reason: `its change could not be read (${(error as Error).message}); its worktree is kept as it was` });
      continue;
    }
    if (commit === batch.base) {
      outcomes.push({ worker, status: "empty" });
      continue;
    }
    const ref = `refs/bot-lobby/${worker.replace(/[^A-Za-z0-9_-]/g, "-")}-${stamp}`;
    const keep = async (reason: string, status: "conflict" | "partial" = "conflict", leftChanged?: string[]): Promise<void> => {
      let saved = ref;
      if ((await git(batch.top, ["update-ref", ref, commit])).code !== 0 && tree) {
        tree.keep = true;
        saved = tree.dir;
      }
      let patch = "";
      try {
        mkdirSync(patchDir, { recursive: true });
        const file = join(patchDir, `${worker}-${stamp}.patch`);
        if ((await git(batch.top, ["diff", "--binary", "--no-renames", `--output=${file}`, batch.base, commit])).code === 0) patch = file;
      } catch {
        // The ref still holds it.
      }
      outcomes.push({ worker, status, patch, saved, reason, ...(leftChanged ? { leftChanged } : {}) });
    };
    try {
      const nested = await gitlinks(batch, commit);
      if (nested.length > 0) {
        if (tree) tree.keep = true;
        await keep(`it made a nested git repository (${nested.slice(0, 3).join(", ")}), whose files cannot be carried over as a change; its worktree is kept`);
        continue;
      }
      const paths = await changedPaths(batch, commit);
      const scratch = mkdtempSync(join(tmpdir(), "bl-patch-"));
      const file = join(scratch, "change.patch");
      try {
        await gitOk(batch.top, ["diff", "--binary", "--no-renames", `--output=${file}`, batch.base, commit]);
        const check = await git(batch.top, ["apply", "--check", "--binary", "--whitespace=nowarn", file]);
        if (check.code !== 0) {
          await keep(firstLines(check.stderr) || "it does not apply to the tree as the other workers left it");
          continue;
        }
        const before = saveFiles(batch.top, paths);
        const applied = await git(batch.top, ["apply", "--binary", "--whitespace=nowarn", file]);
        if (applied.code === 0) {
          outcomes.push({ worker, status: "applied" });
          continue;
        }
        const left = restoreFiles(batch.top, before);
        const reason = firstLines(applied.stderr) || "git could not apply it";
        if (left.length === 0) await keep(reason);
        else await keep(`${reason}; ${left.length} file(s) it touched could not be put back`, "partial", left);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    } catch (error) {
      await keep(`its change could not be applied (${(error as Error).message})`);
    }
  }
  return outcomes;
}

/** A path a worker edited inside its worktree, as the same path in the task's tree. */
export function mapToTop(batch: TreeBatch, worker: string, path: string): string {
  const tree = batch.trees.get(worker);
  if (!tree) return path;
  const rel = relative(tree.dir, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? join(batch.shownTop, rel) : path;
}

/** Remove every worktree of the batch and its folder, except one kept to save its change. Never throws. */
export async function closeWorkerTrees(batch: TreeBatch): Promise<void> {
  let kept = false;
  for (const tree of batch.trees.values()) {
    // Unlink the borrowed folders first, so removing the worktree can never reach into the main checkout's.
    for (const link of tree.links) {
      try {
        unlinkSync(join(tree.dir, link));
      } catch {
        // Already gone.
      }
    }
    if (tree.keep) kept = true;
    else await git(batch.top, ["worktree", "remove", "--force", tree.dir]);
  }
  if (!kept) rmSync(batch.home, { recursive: true, force: true });
  await git(batch.top, ["worktree", "prune"]);
}
