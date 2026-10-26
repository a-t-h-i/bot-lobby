import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface AssignmentFile {
  path: string;
  access: "reference" | "edit" | "create";
  purpose: string;
}

export interface AssignmentExpansionRequest {
  kind: "files" | "tools" | "discovery" | "decision";
  reason: string;
  requested: string[];
}

export interface WorkerAssignment {
  id: string;
  revision: number;
  objective: string;
  actions: { step: number; instruction: string }[];
  files: AssignmentFile[];
  contracts: string[];
  constraints: string[];
  exclusions: string[];
  tools: { name: string; purpose: string }[];
  verification: string[];
  evidence: string[];
  completedWork: string[];
  needs: AssignmentExpansionRequest[];
  /** Total allowance, not a fresh allowance on retry or revision. */
  discoveryLimit?: number;
}

export class AssignmentValidationError extends Error {
  constructor(message: string) {
    super(`Invalid worker assignment: ${message}`);
    this.name = "AssignmentValidationError";
  }
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssignmentValidationError(message);
}

function object(value: unknown, fields: string[], label: string): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) requireValue(fields.includes(key), `${label}.${key} is unknown; remove it`);
  return record;
}

function text(value: unknown, label: string): asserts value is string {
  requireValue(typeof value === "string" && value.trim().length > 0, `${label} must be non-empty text`);
}

function list(value: unknown, label: string, required = false): unknown[] {
  requireValue(Array.isArray(value), `${label} must be an array`);
  requireValue(!required || value.length > 0, `${label} must contain at least one entry`);
  return value;
}

function texts(value: unknown, label: string, required = false): void {
  list(value, label, required).forEach((entry, i) => text(entry, `${label}[${i}]`));
}

function validateShape(input: unknown): WorkerAssignment {
  const a = object(input, ["id", "revision", "objective", "actions", "files", "contracts", "constraints", "exclusions", "tools", "verification", "evidence", "completedWork", "needs", "discoveryLimit"], "assignment");
  text(a.id, "id");
  text(a.objective, "objective");
  requireValue(Number.isSafeInteger(a.revision) && Number(a.revision) > 0, "revision must be a positive integer");
  requireValue(a.discoveryLimit === undefined || (Number.isSafeInteger(a.discoveryLimit) && Number(a.discoveryLimit) >= 0), "discoveryLimit must be a non-negative integer");
  validateActions(a.actions);
  validateFiles(a.files);
  validateTools(a.tools);
  for (const key of ["contracts", "constraints", "exclusions", "verification", "evidence", "completedWork"]) texts(a[key], key, key === "verification");
  validateNeeds(a.needs);
  return structuredClone(input) as WorkerAssignment;
}

function validateActions(value: unknown): void {
  list(value, "actions", true).forEach((value, i) => {
    const action = object(value, ["step", "instruction"], `actions[${i}]`);
    requireValue(action.step === i + 1, `actions[${i}].step must be ${i + 1}`);
    text(action.instruction, `actions[${i}].instruction`);
  });
}

function validateFiles(value: unknown): void {
  list(value, "files", true).forEach((entry, i) => {
    const file = object(entry, ["path", "access", "purpose"], `files[${i}]`);
    text(file.path, `files[${i}].path`);
    text(file.purpose, `files[${i}].purpose`);
    requireValue(["reference", "edit", "create"].includes(String(file.access)), `files[${i}].access must be reference, edit or create`);
    requireValue(!/[\0*?\[\]{}]/.test(file.path), `files[${i}].path must be an exact path, not a pattern`);
  });
}

function validateTools(value: unknown): void {
  list(value, "tools").forEach((entry, i) => {
    const tool = object(entry, ["name", "purpose"], `tools[${i}]`);
    text(tool.name, `tools[${i}].name`);
    text(tool.purpose, `tools[${i}].purpose`);
  });
}

function validateNeeds(value: unknown): void {
  list(value, "needs").forEach((entry, i) => {
    const need = object(entry, ["kind", "reason", "requested"], `needs[${i}]`);
    requireValue(["files", "tools", "discovery", "decision"].includes(String(need.kind)), `needs[${i}].kind must be files, tools, discovery or decision`);
    text(need.reason, `needs[${i}].reason`);
    texts(need.requested, `needs[${i}].requested`, true);
  });
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Resolve absent create paths through their nearest existing ancestor, including symlinks. */
async function resolvedPath(path: string, mayCreate: boolean): Promise<string> {
  try {
    await lstat(path);
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !mayCreate) throw error;
    return resolveCreatePath(path);
  }
}

async function resolveCreatePath(path: string): Promise<string> {
  // A dangling symlink must not be mistaken for an absent create target.
  const entry = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
    return undefined;
  });
  if (entry) throw new Error("dangling symlink cannot be resolved");
  const parent = dirname(path);
  if (parent === path) throw new Error("create target has no existing ancestor");
  const resolved = await resolvedPath(parent, true);
  const parentEntry = await stat(resolved).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
    return undefined;
  });
  requireValue(!parentEntry || parentEntry.isDirectory(), `create parent ${parent} must be a directory`);
  return resolve(resolved, relative(parent, path));
}

async function validateFile(file: AssignmentFile, root: string, seen: Set<string>): Promise<void> {
  const path = resolve(root, file.path);
  requireValue(inside(root, path), `${file.path} is outside project scope ${root}`);
  try {
    const target = await resolvedPath(path, file.access === "create");
    requireValue(inside(root, target), `${file.path} resolves outside project scope ${root}`);
    const entry = await stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" || file.access !== "create") throw error;
      return undefined;
    });
    requireValue(!entry || entry.isFile(), `${file.path} must identify a file, not a directory`);
    requireValue(!seen.has(target), `${file.path} duplicates another assigned path`);
    seen.add(target);
  } catch (error) {
    if (error instanceof AssignmentValidationError) throw error;
    throw new AssignmentValidationError(`${file.access} path ${file.path}: ${error instanceof Error ? error.message : String(error)}; correct the path or request expansion`);
  }
}

/** Validate before dispatch; failure must never fall back to an unrestricted run. */
export async function validateAssignment(input: unknown, projectRoot: string): Promise<WorkerAssignment> {
  const assignment = validateShape(input);
  const root = await realpath(projectRoot);
  const seen = new Set<string>();
  for (const file of assignment.files) await validateFile(file, root, seen);
  return { ...assignment, discoveryLimit: assignment.discoveryLimit ?? 2 };
}
