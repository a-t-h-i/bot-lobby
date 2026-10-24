import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const OUTPUT_PREVIEW_CHARS = 4000;
export const OUTPUT_PAGE_BYTES = 4000;

/** Trusted harness context, never agent-supplied paths or an authorization snapshot. */
export interface OutputArtifactAccess {
  repository: string;
  worktree: string;
  taskDir: string;
  taskId: string;
  callerKey: string;
  /** Additional callers whose artifacts this access may open (the assignment's issued children). */
  allowedCallerKeys?: readonly string[];
  /** Records a reference once a page is opened from it, so reads stay attributable. */
  onRead?: (ref: string) => void;
  /** Must consult current task assignment and permissions, including on continuation. */
  authorize: () => boolean;
}

export interface OutputReport {
  output: string;
  status: string;
  error?: string;
  exitCode?: number;
}

interface Scope {
  repository: string;
  worktree: string;
  taskDir: string;
  taskId: string;
  callerKey: string;
}

interface Manifest extends Omit<OutputReport, "output"> {
  scope: Scope;
  bytes: number;
  modified: number;
}

export interface OutputArtifactPage extends Omit<OutputReport, "output"> {
  text: string;
  nextOffset?: number;
  bytes: number;
}

function denied(): never {
  throw new Error("Output artifact unavailable or unauthorized");
}

/** Reject symlinks at every component below the canonical repository root. */
function checkedDirectory(root: string, path: string): string {
  const rel = relative(root, resolve(path));
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) denied();
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) denied();
  }
  return current;
}

function scopeFor(access: OutputArtifactAccess): Scope {
  if (!access.authorize() || !access.taskId || !access.callerKey) denied();
  const repository = realpathSync(access.repository);
  const worktree = realpathSync(access.worktree);
  const taskDir = checkedDirectory(repository, access.taskDir);
  return { repository, worktree, taskDir, taskId: access.taskId, callerKey: access.callerKey };
}

function artifactDirectory(scope: Scope, create = false): string {
  const path = join(scope.taskDir, "outputs");
  if (create) mkdirSync(path, { mode: 0o700 });
  return checkedDirectory(scope.repository, path);
}

function openRegular(path: string): number {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const stat = fstatSync(fd);
  if (stat.isFile() && stat.nlink === 1) return fd;
  closeSync(fd);
  return denied();
}

function readManifest(path: string): Manifest {
  const fd = openRegular(path);
  try {
    return JSON.parse(readFileSync(fd, "utf8")) as Manifest;
  } finally {
    closeSync(fd);
  }
}

function ensureArtifacts(scope: Scope): string {
  try {
    return artifactDirectory(scope, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return artifactDirectory(scope);
  }
}

function saveReport(dir: string, ref: string, scope: Scope, report: OutputReport): void {
  const text = join(dir, `${ref}.txt`);
  writeFileSync(text, report.output, { flag: "wx", mode: 0o600, flush: true });
  try {
    const stat = lstatSync(text);
    const manifest: Manifest = { scope, status: report.status, error: report.error, exitCode: report.exitCode, bytes: stat.size, modified: stat.mtimeMs };
    writeFileSync(join(dir, `${ref}.json`), JSON.stringify(manifest), { flag: "wx", mode: 0o600, flush: true });
  } catch (error) {
    unlinkSync(text);
    throw error;
  }
}

/** Pass only harness-owned report text, never a raw stream, tool transcript or thinking. Parse contracts before previewing. */
export function preserveOutputArtifact<T extends OutputReport>(access: OutputArtifactAccess, report: T): T & { artifact?: string } {
  const scope = scopeFor(access);
  if (report.output.length <= OUTPUT_PREVIEW_CHARS) return report;
  const ref = `O-${randomUUID()}`;
  saveReport(ensureArtifacts(scope), ref, scope, report);
  const preview = `${report.output.slice(0, OUTPUT_PREVIEW_CHARS)}\n[Output preview; full report: ${ref}]`;
  return { ...report, output: preview, artifact: ref };
}

function readPage(fd: number, offset: number, size: number): { text: string; nextOffset?: number } {
  const buffer = Buffer.alloc(OUTPUT_PAGE_BYTES + 1);
  const count = readSync(fd, buffer, 0, buffer.length, offset);
  if (count && offset && (buffer[0]! & 0xc0) === 0x80) denied();
  let end = Math.min(count, OUTPUT_PAGE_BYTES);
  while (end < count && (buffer[end]! & 0xc0) === 0x80) end -= 1;
  const next = offset + end;
  return { text: buffer.subarray(0, end).toString("utf8"), ...(next < size ? { nextOffset: next } : {}) };
}

function scopedManifest(dir: string, ref: string, scope: Scope, callerKeys: readonly string[] = [scope.callerKey]): Manifest {
  const manifest = readManifest(join(dir, `${ref}.json`));
  const recorded = manifest.scope;
  const sameScope = recorded.repository === scope.repository && recorded.worktree === scope.worktree && recorded.taskDir === scope.taskDir && recorded.taskId === scope.taskId;
  if (!sameScope || !callerKeys.includes(recorded.callerKey)) denied();
  if (typeof manifest.status !== "string" || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 0) denied();
  if (manifest.error !== undefined && typeof manifest.error !== "string") denied();
  if (manifest.exitCode !== undefined && !Number.isSafeInteger(manifest.exitCode)) denied();
  return manifest;
}

/** Byte offsets are navigation only, not authorization. Each page rechecks current access and canonical paths. */
export function openOutputArtifact(access: OutputArtifactAccess, ref: string, offset = 0): OutputArtifactPage {
  const scope = scopeFor(access);
  if (!/^O-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(ref) || !Number.isSafeInteger(offset) || offset < 0) denied();
  const dir = artifactDirectory(scope);
  const manifest = scopedManifest(dir, ref, scope, [scope.callerKey, ...(access.allowedCallerKeys ?? [])]);
  const fd = openRegular(join(dir, `${ref}.txt`));
  try {
    const stat = fstatSync(fd);
    if (stat.size !== manifest.bytes || stat.mtimeMs !== manifest.modified || offset > stat.size) denied();
    const page = { ...readPage(fd, offset, stat.size), status: manifest.status, error: manifest.error, exitCode: manifest.exitCode, bytes: stat.size };
    recordRead(access, ref);
    return page;
  } finally {
    closeSync(fd);
  }
}

/** A failed bookkeeping note never fails a permitted read. */
function recordRead(access: OutputArtifactAccess, ref: string): void {
  try {
    access.onRead?.(ref);
  } catch {
    return;
  }
}
