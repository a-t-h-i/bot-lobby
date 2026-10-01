/**
 * Who changed what: a project-wide ledger of the files each quick fix and each
 * task worker edited, read from their own `edit`/`write` tool calls (never
 * from their reports). The QA gate and the Master see every changed file of
 * the working tree against it, so a quick fix the user asked for, a planned
 * step, work that was there before the task and an edit no agent made each
 * read as what they are, instead of all looking like unplanned changes.
 * Append-only JSON lines beside the metrics; best-effort like them.
 */
import { appendFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Domain } from "../schemas/agent.ts";
import type { Task } from "../schemas/task.ts";
import { dataRoot } from "./project.ts";

export type ChangeSource = "quickfix" | "worker";

export interface ChangeRecord {
  source: ChangeSource;
  /** The quick fix (`QF-3`) or the worker run that made the edits. */
  id: string;
  /** The task a worker ran for. */
  taskId?: string;
  domain?: Domain;
  /** What it was asked to do, one line. */
  what: string;
  /** Absolute paths it edited with `edit`/`write`. */
  files: string[];
  startedAt: string;
  finishedAt: string;
  status: string;
}

/** Past this size the ledger keeps only its newer half; records older than any open task are not needed. */
export const MAX_LEDGER_BYTES = 512 * 1024;

const EDIT_TOOLS = new Set(["edit", "write"]);

export function ledgerPath(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "changes.jsonl");
}

/** The absolute path an `edit`/`write` call changes, or undefined for any other call. */
export function editedFile(toolName: string, args: unknown, cwd: string): string | undefined {
  if (!EDIT_TOOLS.has(toolName.trim().toLowerCase()) || !args || typeof args !== "object") return undefined;
  const fields = args as Record<string, unknown>;
  const raw = [fields.path, fields.file_path, fields.file].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!raw) return undefined;
  // pi's file tools accept `@path` as well as `path`.
  const path = raw.trim().replace(/^@/, "");
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

/** Collects the files one run edits, in the order it first touched them. */
export class EditLog {
  private readonly files = new Set<string>();
  private readonly cwd: string;

  constructor(cwd: string) {
    // git names the repository by its real path (macOS: /private/var, not /var), so edits are recorded against it too.
    let real = cwd;
    try {
      real = realpathSync(cwd);
    } catch {
      // A folder that cannot be resolved is recorded as given.
    }
    this.cwd = real;
  }

  /** Note a tool call; true when it edited a file not seen before. */
  note(toolName: string, args: unknown): boolean {
    const file = editedFile(toolName, args, this.cwd);
    if (!file || this.files.has(file)) return false;
    this.files.add(file);
    return true;
  }

  list(): string[] {
    return [...this.files];
  }

  /** The files as a person reads them: relative to the folder the run worked in, when they are inside it. */
  shown(): string[] {
    return this.list().map((file) => {
      const path = relative(this.cwd, file);
      return path && !path.startsWith("..") && !isAbsolute(path) ? path : file;
    });
  }
}

export function appendChange(root: string, configDir: string, record: ChangeRecord): void {
  if (record.files.length === 0) return;
  const path = ledgerPath(root, configDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
    if (statSync(path).size > MAX_LEDGER_BYTES) {
      const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim());
      writeFileSync(path, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`, "utf8");
    }
  } catch {
    // Provenance is best-effort; a read-only tree must never fail a run.
  }
}

function isRecord(value: unknown): value is ChangeRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ChangeRecord>;
  return (record.source === "quickfix" || record.source === "worker") && typeof record.id === "string" && Array.isArray(record.files) && typeof record.finishedAt === "string";
}

/** Every record in the ledger finished at or after `since` (ISO), oldest first. */
export function readChanges(root: string, configDir: string, since?: string): ChangeRecord[] {
  let text: string;
  try {
    text = readFileSync(ledgerPath(root, configDir), "utf8");
  } catch {
    return [];
  }
  const from = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  const records: ChangeRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record: unknown = JSON.parse(line);
      if (isRecord(record) && Date.parse(record.finishedAt) >= from) records.push(record);
    } catch {
      // A torn line (a crash mid-append) is skipped.
    }
  }
  return records;
}

export type Provenance = "planned" | "quickfix" | "other-task" | "pre-existing" | "unattributed";

export interface FileProvenance {
  /** Repository-relative, as git reports it. */
  path: string;
  /** Every source that explains the change; `unattributed` alone when none does. */
  kinds: Provenance[];
  /** One clause per source: `planned: DEV — Add the login endpoint`. */
  notes: string[];
  /** The quick fixes that edited it. */
  quickFixes: string[];
}

const DOMAIN_LABELS: Record<string, string> = { backend: "DEV", designer: "DESIGN", qa: "QA" };

function clip(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : ` at ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Explain each changed file of the working tree (`changed`, relative to the
 * repository at `top`) for `task`: edits by its own workers are planned; by a
 * quick fix, the user's direct request; by another task's workers, that
 * task's; changed before its agents started, pre-existing; anything else, no
 * agent recorded it. `records` should reach back to the task's start.
 */
export function explainChanges(task: Pick<Task, "id" | "baseline">, changed: readonly string[], top: string, records: readonly ChangeRecord[]): FileProvenance[] {
  const byFile = new Map<string, ChangeRecord[]>();
  for (const record of records) {
    for (const file of record.files) {
      // git names files with forward slashes on every platform.
      const key = relative(top, file).split("\\").join("/");
      if (key.startsWith("..") || isAbsolute(key)) continue;
      const list = byFile.get(key) ?? [];
      list.push(record);
      byFile.set(key, list);
    }
  }
  const before = new Set(task.baseline?.files ?? []);
  return changed.map((path) => {
    const kinds: Provenance[] = [];
    const notes: string[] = [];
    const quickFixes: string[] = [];
    const add = (kind: Provenance, note: string) => {
      if (!kinds.includes(kind)) kinds.push(kind);
      if (!notes.includes(note)) notes.push(note);
    };
    for (const record of byFile.get(path) ?? []) {
      if (record.source === "quickfix") {
        add("quickfix", `quick fix ${record.id}${clock(record.finishedAt)}, asked by the user: "${clip(record.what)}"`);
        if (!quickFixes.includes(record.id)) quickFixes.push(record.id);
      } else if (record.taskId === task.id) add("planned", `planned: ${DOMAIN_LABELS[record.domain ?? ""] ?? record.domain ?? "worker"} — ${clip(record.what)}`);
      else add("other-task", `another task's worker (${record.taskId ?? "unknown task"}): ${clip(record.what)}`);
    }
    if (before.has(path)) add("pre-existing", "pre-existing: it already had uncommitted changes before this task's agents started");
    if (kinds.length === 0) add("unattributed", "unattributed: no bot-lobby agent recorded editing it");
    return { path, kinds, notes, quickFixes };
  });
}

/** Most files the reviewer is told about one by one. */
export const MAX_PROVENANCE_LINES = 60;

/** The provenance as the reviewer reads it: one line per changed file, the unexplained ones first, the rest counted past `max`. */
export function provenanceLines(files: readonly FileProvenance[], max = MAX_PROVENANCE_LINES): string {
  const order = (file: FileProvenance) => (file.kinds.includes("unattributed") ? 0 : file.kinds.includes("quickfix") ? 1 : 2);
  const sorted = [...files].sort((a, b) => order(a) - order(b));
  const lines = sorted.slice(0, max).map((file) => `- ${file.path} — ${file.notes.join("; ")}`);
  const rest = sorted.slice(max);
  if (rest.length > 0) lines.push(`- …and ${rest.length} more: ${provenanceSummary(rest)}`);
  return lines.join("\n");
}

/** A one-line count for the Master: `4 planned · 1 quick fix (QF-2) · 1 unattributed (src/x.ts)`. */
export function provenanceSummary(files: readonly FileProvenance[]): string {
  const count = (kind: Provenance) => files.filter((file) => file.kinds.includes(kind));
  const parts: string[] = [];
  const planned = count("planned").length;
  if (planned > 0) parts.push(`${planned} planned`);
  const quick = count("quickfix");
  if (quick.length > 0) {
    const ids = [...new Set(quick.flatMap((file) => file.quickFixes))];
    parts.push(`${quick.length} by quick fix (${ids.join(", ")})`);
  }
  const other = count("other-task").length;
  if (other > 0) parts.push(`${other} by another task`);
  const before = count("pre-existing").length;
  if (before > 0) parts.push(`${before} pre-existing`);
  const unknown = count("unattributed");
  if (unknown.length > 0) parts.push(`${unknown.length} unattributed (${unknown.slice(0, 5).map((file) => file.path).join(", ")}${unknown.length > 5 ? ", …" : ""})`);
  return parts.join(" · ");
}
