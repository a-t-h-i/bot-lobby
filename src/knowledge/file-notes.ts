/**
 * What scouts learned about files, kept across tasks. Each scout's Relevant
 * Files (`path:lines — why it matters`) are recorded with a hash of the
 * file's content, and the repository map shows a note again only while the
 * file is unchanged, so a later agent starts from what an earlier one found
 * instead of searching for it again. A changed file's note is never shown:
 * it may no longer be true.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Domain } from "../schemas/agent.ts";
import type { RelevantFile } from "../schemas/findings.ts";
import { tempName, withFileLock } from "../desk/lock.ts";

export interface FileNote {
  note: string;
  /** The lines it is about (`12-40`), when the scout gave them. */
  lines?: string;
  /** sha1 of the file's content when the note was taken. */
  hash: string;
  domain: Domain;
  at: string;
  /** File-local provenance, never evidence of callers or repository-wide behavior. */
  provenance?: { kind: "scout"; scope: "file"; usage: "navigation-only" };
}

interface NotesFile {
  version: 1;
  files: Record<string, FileNote>;
}

/** Most notes kept; the oldest go first. */
export const MAX_NOTES = 2000;
const MAX_NOTE_CHARS = 240;
/** Files larger than this are not hashed (the index skips them too). */
const MAX_HASHED_BYTES = 256 * 1024;

export function fileNotesPath(dataDir: string): string {
  return join(dataDir, "cache", "file-notes.json");
}

export function readFileNotes(dataDir: string): Record<string, FileNote> {
  try {
    const parsed = JSON.parse(readFileSync(fileNotesPath(dataDir), "utf8")) as Partial<NotesFile>;
    if (parsed.version !== 1 || !parsed.files || typeof parsed.files !== "object") return {};
    return Object.fromEntries(Object.entries(parsed.files).filter(([, note]) =>
      note && typeof note.note === "string" && typeof note.hash === "string" && typeof note.at === "string",
    ));
  } catch {
    return {};
  }
}

function writeFileNotes(dataDir: string, files: Record<string, FileNote>): void {
  const path = fileNotesPath(dataDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temp = tempName(path);
    writeFileSync(temp, JSON.stringify({ version: 1, files } satisfies NotesFile));
    renameSync(temp, path);
  } catch {
    // Notes are an optimisation; without them agents search as before.
  }
}

/** A file's content hash, or undefined when it is missing, not a file or too large. */
export async function contentHash(cwd: string, path: string): Promise<string | undefined> {
  try {
    const local = treePath(cwd, path);
    if (!local) return undefined;
    const root = await realpath(cwd);
    const full = await realpath(join(root, local));
    if (!treePath(root, full)) return undefined;
    const info = await stat(full);
    if (!info.isFile() || info.size > MAX_HASHED_BYTES) return undefined;
    return createHash("sha1").update(await readFile(full)).digest("hex");
  } catch {
    return undefined;
  }
}

/** A reported path relative to the tree (`./a.ts`, `/abs/tree/a.ts` → `a.ts`); undefined outside it. */
export function treePath(cwd: string, path: string): string | undefined {
  const plain = path.trim().replace(/^\.\//, "");
  if (!plain) return undefined;
  const rel = relative(resolve(cwd), resolve(cwd, plain));
  return !rel || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel) ? undefined : rel.split("\\").join("/");
}

/** Record a scout's Relevant Files as notes, each with its file's current hash; files that are not there are skipped. */
export async function recordFileNotes(dataDir: string, cwd: string, domain: Domain, files: readonly RelevantFile[], now = new Date()): Promise<number> {
  const entries = await Promise.all(files.filter((file) => file.reason.trim()).map(async (file): Promise<[string, FileNote] | undefined> => {
    const path = treePath(cwd, file.path);
    const hash = path ? await contentHash(cwd, path) : undefined;
    if (!path || !hash) return undefined;
    const note = file.reason.trim().replace(/\s+/g, " ").slice(0, MAX_NOTE_CHARS);
    return [path, { note, ...(file.lines ? { lines: file.lines } : {}), hash, domain, at: now.toISOString(), provenance: { kind: "scout", scope: "file", usage: "navigation-only" } }];
  }));
  const fresh = entries.filter((entry): entry is [string, FileNote] => entry !== undefined);
  if (fresh.length === 0) return 0;
  try {
    // Scouts run in parallel: hold the notes' lock across the read-merge-write so one writer's notes cannot overwrite another's.
    return withFileLock(fileNotesPath(dataDir), () => {
      const notes = { ...readFileNotes(dataDir), ...Object.fromEntries(fresh) };
      const kept = Object.entries(notes).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_NOTES);
      writeFileNotes(dataDir, Object.fromEntries(kept));
      return fresh.length;
    });
  } catch {
    // A busy notes file is an optimisation lost for this scout, not a failure of its task.
    return 0;
  }
}

export interface FileNoteHint {
  id: string;
  scope: "file";
  source: string;
  fingerprint: string;
  usage: "navigation-only";
  status: "unverified hints";
  note: FileNote;
}

/** Relevant notes only; callers must validate their source before relying on them. */
export function fileNoteHints(dataDir: string, paths: readonly string[]): FileNoteHint[] {
  const notes = readFileNotes(dataDir);
  return [...new Set(paths)].flatMap((path) => notes[path] ? [{
    id: `file-note:${path}`, scope: "file" as const, source: path, fingerprint: notes[path]!.hash,
    usage: "navigation-only" as const, status: "unverified hints" as const, note: notes[path]!,
  }] : []);
}

/** The notes for `paths` whose source is unchanged; navigation only, not broad claims. */
export async function currentNotes(dataDir: string, cwd: string, paths: readonly string[]): Promise<Map<string, FileNote>> {
  const notes = readFileNotes(dataDir);
  const wanted = paths.filter((path) => notes[path]);
  const hashes = await Promise.all(wanted.map((path) => contentHash(cwd, path)));
  return new Map(wanted.filter((path, index) => hashes[index] === notes[path]!.hash).map((path) => [path, notes[path]!]));
}
