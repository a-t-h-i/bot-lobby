import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import type { KnowledgeConfig } from "../schemas/configuration.ts";
import type { Domain, Role } from "../schemas/agent.ts";
import { MAX_ASSIGNMENTS, TERMINAL_STATES, isTaskState, type AssignmentGrant, type AssignmentRecord, type Task } from "../schemas/task.ts";
import { dataRoot, firstLegacyDataRoot, readDataRoots } from "./project.ts";
import {
  AGENT_DIR_NAMES,
  KNOWLEDGE_FILES,
  knowledgeDir,
  scratchpadPath,
  taskDir,
  tasksRoot,
  type KnowledgeAgent,
} from "../knowledge/paths.ts";
import { DEFAULT_KNOWLEDGE_CONTENT, ensureFile, readFileOr, writeFileEnsured } from "../knowledge/store.ts";
import { forgetCached, forgetCachedUnder, readJsonCached } from "./file-cache.ts";
import { taskName } from "../text.ts";
import { mergePhaseTiming, timingBaseline, type TimingBaseline } from "./timing-merge.ts";
import { captureCheckpoint } from "./checkpoint.ts";

const timingBaselines = new WeakMap<Task, TimingBaseline>();
type UserBaseline = Pick<Task, "plan" | "approvedPlan" | "amendments"> & { checkpoint?: string };
const userBaselines = new WeakMap<Task, UserBaseline>();
function rememberTiming(task: Task): Task {
  timingBaselines.set(task, timingBaseline(task));
  userBaselines.set(task, { plan: task.plan, approvedPlan: task.approvedPlan, amendments: [...(task.amendments ?? [])], checkpoint: JSON.stringify(task.checkpoint) });
  return task;
}

/** Idempotently create the full knowledge + tasks layout with seed files. */
export function ensureProjectStructure(root: string, configDir: string): void {
  const dr = dataRoot(root, configDir);
  const legacy = firstLegacyDataRoot(root, configDir);
  const agents = Object.keys(AGENT_DIR_NAMES) as KnowledgeAgent[];
  for (const agent of agents) {
    const dir = knowledgeDir(dr, agent);
    mkdirSync(dir, { recursive: true });
    for (const file of KNOWLEDGE_FILES[agent]) {
      // Seed from the newest existing pre-rename tree so legacy knowledge migrates instead of being shadowed by defaults.
      const migrated = legacy ? readFileOr(join(knowledgeDir(legacy, agent), file)) : "";
      ensureFile(join(dir, file), migrated || (DEFAULT_KNOWLEDGE_CONTENT[file] ?? `# ${file}\n`));
    }
  }
  mkdirSync(tasksRoot(dr), { recursive: true });
}

/** Create the temporary task dir with state.json, proposal/plan, scratchpads. */
export function createTaskDir(root: string, configDir: string, task: Task): void {
  const dir = taskDir(dataRoot(root, configDir), task.id);
  mkdirSync(dir, { recursive: true });
  forgetCached(join(dir, "state.json"));
  refreshCheckpoint(task, root);
  writeFileEnsured(join(dir, "state.json"), JSON.stringify(task, null, 2));
  rememberTiming(task);
  ensureFile(join(dir, "proposal.md"), "");
  ensureFile(join(dir, "plan.md"), "");
  for (const domain of ["designer", "backend", "qa"] as const) {
    ensureFile(scratchpadPath(dir, domain), `# ${domain} scratchpad\n`);
  }
}

export function taskDirFor(root: string, configDir: string, taskId: string): string {
  return taskDir(dataRoot(root, configDir), taskId);
}

/** Per-task dirs to read, newest first: bot-lobby, then the pre-rename trees. */
export function taskReadDirs(root: string, configDir: string, taskId: string): string[] {
  return readDataRoots(root, configDir).map((dr) => taskDir(dr, taskId));
}

function readIfExists(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Read the first existing per-task artifact; the new tree wins per file. */
export function readTaskArtifact(
  root: string,
  configDir: string,
  taskId: string,
  relative: string,
): string | undefined {
  for (const dir of taskReadDirs(root, configDir, taskId)) {
    const text = readIfExists(join(dir, relative));
    if (text !== undefined) return text;
  }
  return undefined;
}

export interface AssignmentIssue {
  ownerSessionId: string;
  runId: string;
  worktree: string;
  domain: Domain;
  role: Role;
  grants?: readonly AssignmentGrant[];
  parentAssignmentId?: string;
}

/** Issue one assignment identity; only the owning session of a live task may. */
export function issueAssignment(root: string, configDir: string, taskId: string, issue: AssignmentIssue): AssignmentRecord | undefined {
  const task = loadTask(root, configDir, taskId);
  if (!task || TERMINAL_STATES.includes(task.state) || !task.ownerSessionId || task.ownerSessionId !== issue.ownerSessionId) return undefined;
  const record: AssignmentRecord = {
    id: `A-${randomUUID()}`,
    ownerSessionId: issue.ownerSessionId,
    runId: issue.runId,
    worktree: issue.worktree,
    domain: issue.domain,
    role: issue.role,
    state: "active",
    grants: [...(issue.grants ?? ["artifact.read", "checkpoint.read"])],
    ...(issue.parentAssignmentId ? { parentAssignmentId: issue.parentAssignmentId } : {}),
    issuedAt: new Date().toISOString(),
  };
  task.assignments = [...(task.assignments ?? []), record];
  supersedeAssignments(task, record);
  saveTask(root, configDir, task);
  return record;
}

/** Transition one assignment to a terminal state; terminal records never reactivate. */
export function transitionAssignment(root: string, configDir: string, taskId: string, id: string, state: "cancelled" | "revoked"): AssignmentRecord | undefined {
  const task = loadTask(root, configDir, taskId);
  const record = task?.assignments?.find((entry) => entry.id === id);
  if (!task || !record) return undefined;
  if (record.state === "active") {
    record.state = state;
    record.endedAt = new Date().toISOString();
  }
  saveTask(root, configDir, task);
  return record;
}

/** The current registry entry for one assignment id, or none. */
export function assignmentRecord(root: string, configDir: string, taskId: string, id: string): AssignmentRecord | undefined {
  return loadTask(root, configDir, taskId)?.assignments?.find((entry) => entry.id === id);
}

const ARTIFACT_REF_PATTERN = /^O-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_ARTIFACT_REFS = 16;

/** Record one durable artifact reference on the task checkpoint so later runs can re-find it. */
export function recordArtifactRef(root: string, configDir: string, taskId: string, ref: string): boolean {
  const task = loadTask(root, configDir, taskId);
  if (!task || !ARTIFACT_REF_PATTERN.test(ref)) return false;
  const checkpoint = task.checkpoint ?? captureCheckpoint(task, task.git?.path ?? root);
  const items = checkpoint.artifacts.items;
  if (items.includes(ref)) return true;
  task.checkpoint = { ...checkpoint, artifacts: { items: [...items, ref].slice(-MAX_ARTIFACT_REFS), omitted: Math.max(checkpoint.artifacts.omitted, items.length + 1 - MAX_ARTIFACT_REFS) } };
  saveTask(root, configDir, task);
  return true;
}

/** A new run for one domain/role slot supersedes its active predecessors (run or worktree change). */
function supersedeAssignments(task: Task, issued: AssignmentRecord): void {
  const at = new Date().toISOString();
  for (const record of task.assignments ?? []) {
    const superseded = record.id !== issued.id && record.state === "active" && record.domain === issued.domain && record.role === issued.role && (record.runId !== issued.runId || record.worktree !== issued.worktree);
    if (superseded) {
      record.state = "cancelled";
      record.endedAt = at;
    }
  }
}

/** Terminal assignments are final: a stale in-flight save must not resurrect them. */
function preserveAssignments(task: Task, latest: Task): void {
  const next = new Map((task.assignments ?? []).map((record) => [record.id, record]));
  const merged = (latest.assignments ?? []).map((record) => {
    const mine = next.get(record.id);
    next.delete(record.id);
    return !mine || mine.state === "active" ? record : mine;
  });
  const records = trimAssignments([...merged, ...next.values()]);
  if (records.length > 0) task.assignments = records;
}

/** Oldest active records are dropped first; terminal records stay for audit. */
function trimAssignments(records: AssignmentRecord[]): AssignmentRecord[] {
  const kept = [...records];
  while (kept.length > MAX_ASSIGNMENTS) {
    const index = kept.findIndex((record) => record.state === "active");
    if (index < 0) break;
    kept.splice(index, 1);
  }
  return kept;
}

export function saveTask(root: string, configDir: string, task: Task): void {
  const latest = loadTask(root, configDir, task.id);
  // Abandonment is final: an in-flight action must not overwrite its audit or resurrect it.
  if (latest?.state === "abandoned") {
    Object.assign(task, latest);
    return;
  }
  if (latest) {
    preserveUserInterventions(task, latest);
    preserveUserConstraints(task, latest);
    mergePhaseTiming(task, timingBaselines.get(task), latest);
    preserveAssignments(task, latest);
  }
  refreshCheckpoint(task, root, latest?.checkpoint);
  const path = join(taskDir(dataRoot(root, configDir), task.id), "state.json");
  forgetCached(path);
  writeFileEnsured(path, JSON.stringify(task, null, 2));
  rememberTiming(task);
}

/** Preserve newer user constraints without mistaking an intentional local edit for a stale snapshot. */
function preserveUserConstraints(task: Task, latest: Task): void {
  const baseline = userBaselines.get(task);
  for (const field of ["plan", "approvedPlan"] as const) {
    if (!baseline || latest[field] !== baseline[field]) task[field] = latest[field];
  }
  const original = new Set(baseline?.amendments ?? latest.amendments);
  const additions = task.amendments.filter((entry) => !original.has(entry) && !latest.amendments.includes(entry));
  task.amendments = [...latest.amendments, ...additions];
}

/** Task-only capture: no source reads, bookmark opening, claim restoration or delivery advancement. */
function refreshCheckpoint(task: Task, root: string, latest?: Task["checkpoint"]): void {
  const unchanged = userBaselines.get(task)?.checkpoint === JSON.stringify(task.checkpoint);
  const previous = unchanged && latest ? latest : task.checkpoint;
  const checkpoint = captureCheckpoint(task, task.git?.path ?? root);
  if (previous) {
    checkpoint.bookmarks = previous.bookmarks;
    checkpoint.artifacts = previous.artifacts;
    checkpoint.ownership = previous.ownership;
    checkpoint.delivery = previous.delivery;
    checkpoint.verification.sources = previous.verification.sources;
  }
  task.checkpoint = checkpoint;
}

/** Explicit user waivers, skipped steps and resolved approvals must survive an in-flight worker's snapshot. */
function preserveUserInterventions(task: Task, latest: Task): void {
  const newlyWaived = !task.qaWaiver && latest.qaWaiver;
  task.qaWaiver ??= latest.qaWaiver;
  task.lintWaiver ??= latest.lintWaiver;
  if (newlyWaived && !TERMINAL_STATES.includes(task.state)) {
    task.blockers = [];
    if (["implementing", "blocked"].includes(task.state)) task.state = "reviewing";
  }
  for (const approval of task.approvals) {
    const resolved = latest.approvals.find((entry) => entry.id === approval.id && entry.status !== "pending");
    if (approval.status === "pending" && resolved) Object.assign(approval, resolved);
  }
  const skipped = new Set((task.skippedSteps ?? []).map((entry) => entry.text));
  const newSkips = (latest.skippedSteps ?? []).filter((entry) => !skipped.has(entry.text));
  if (newSkips.length > 0) task.skippedSteps = [...(task.skippedSteps ?? []), ...newSkips];
  const keys = new Set(task.decisions.map((entry) => JSON.stringify(entry)));
  task.decisions.push(...latest.decisions.filter((entry) => !keys.has(JSON.stringify(entry))));
}

/** Read a task state: the bot-lobby copy wins, else the newest pre-rename copy. */
export function loadTask(root: string, configDir: string, taskId: string): Task | undefined {
  for (const dr of readDataRoots(root, configDir)) {
    const path = join(taskDir(dr, taskId), "state.json");
    if (!existsSync(path)) continue;
    try {
      return rememberTiming(JSON.parse(readFileSync(path, "utf8")) as Task);
    } catch {
      // A bot-lobby state.json that exists but cannot be parsed is surfaced, not shadowed.
      return undefined;
    }
  }
  return undefined;
}

/** Enforce the scratchpad size cap (§20) before writing. */
export function capScratchpad(content: string, cfg: KnowledgeConfig): string {
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const limited = paragraphs.slice(0, cfg.scratchpadMaxParagraphs).join("\n\n");
  if (limited.length <= cfg.scratchpadMaxChars) return limited;
  return `${limited.slice(0, cfg.scratchpadMaxChars)}\n\n[truncated]`;
}

export function writeScratchpad(dir: string, domain: Domain, content: string, cfg: KnowledgeConfig): void {
  writeFileEnsured(scratchpadPath(dir, domain), capScratchpad(content, cfg));
}

/** Read one task dir's state.json; missing and unreadable both yield undefined. */
function readTaskAt(dir: string): Task | undefined {
  const path = join(dir, "state.json");
  if (!existsSync(path)) return undefined;
  try {
    return rememberTiming(JSON.parse(readFileSync(path, "utf8")) as Task);
  } catch {
    return undefined;
  }
}

/**
 * Task dirs across the merged read roots, bot-lobby first and winning per
 * entry, so a legacy task stays visible until its id exists in the new tree.
 */
function taskEntries(root: string, configDir: string): { entry: string; dir: string }[] {
  const entries: { entry: string; dir: string }[] = [];
  const seen = new Set<string>();
  for (const dr of readDataRoots(root, configDir)) {
    const dir = tasksRoot(dr);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      entries.push({ entry, dir: join(dir, entry) });
    }
  }
  return entries;
}

/** All tasks on disk, newest first. Unreadable task dirs are skipped. */
export function listTasks(root: string, configDir: string): Task[] {
  const tasks: Task[] = [];
  for (const { dir } of taskEntries(root, configDir)) {
    const task = readTaskAt(dir);
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Any parsed JSON object counts as a task, as `readTaskAt` has it. */
function isObject(value: unknown): value is Task {
  return typeof value === "object" && value !== null;
}

/**
 * All tasks on disk, newest first, like `listTasks`, but a file is read only
 * when it changed since the last look. The tasks are shared with every other
 * caller, so they are for reading (the owner's clock, the lobby): whatever
 * changes a task loads its own copy with `loadTask` and saves that.
 */
export function peekTasks(root: string, configDir: string): Task[] {
  const tasks: Task[] = [];
  const seen = new Set<string>();
  for (const { dir } of taskEntries(root, configDir)) {
    const path = join(dir, "state.json");
    seen.add(path);
    const task = readJsonCached(path, isObject);
    if (task) tasks.push(task);
  }
  // Forget tasks that left these folders (deleted or archived).
  for (const dr of readDataRoots(root, configDir)) forgetCachedUnder(`${tasksRoot(dr)}${sep}`, seen);
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The non-terminal task a session owns, from `peekTasks` (for reading only). */
export function peekOwnedTask(root: string, configDir: string, sessionId: string): Task | undefined {
  return peekTasks(root, configDir).find((task) => !TERMINAL_STATES.includes(task.state) && task.ownerSessionId === sessionId);
}

/** Tasks on disk plus the ids whose state.json could not be read (§59). */
export function taskHealth(root: string, configDir: string): { tasks: Task[]; corrupted: string[] } {
  const tasks: Task[] = [];
  const corrupted: string[] = [];
  for (const { entry, dir } of taskEntries(root, configDir)) {
    const task = readTaskAt(dir);
    if (!task || task.id !== entry || !isTaskState(task.state)) corrupted.push(entry);
    else tasks.push(task);
  }
  return { tasks: tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), corrupted };
}

/** The task the Master is currently driving, if any. */
export function activeTask(root: string, configDir: string, sessionId?: string): Task | undefined {
  if (sessionId !== undefined) return ownedTask(root, configDir, sessionId);
  return listTasks(root, configDir).find((task) => !TERMINAL_STATES.includes(task.state));
}

/** The non-terminal task a session owns, if any. */
export function ownedTask(root: string, configDir: string, sessionId: string): Task | undefined {
  return listTasks(root, configDir).find((task) => !TERMINAL_STATES.includes(task.state) && task.ownerSessionId === sessionId);
}

/** The newest non-terminal task with no owner, if any. */
export function ownerlessTask(root: string, configDir: string): Task | undefined {
  return listTasks(root, configDir).find((task) => !TERMINAL_STATES.includes(task.state) && !task.ownerSessionId);
}

/** A specific task, or the session's active one when no id is given. */
export function selectTask(root: string, configDir: string, taskId?: string, sessionId?: string): Task | undefined {
  return taskId ? loadTask(root, configDir, taskId) : activeTask(root, configDir, sessionId);
}

/** Reassign a task to a session; explicit takeover for orphaned tasks. */
export function claimTask(root: string, configDir: string, taskId: string, sessionId: string): Task | undefined {
  const task = loadTask(root, configDir, taskId);
  if (!task) return undefined;
  task.ownerSessionId = sessionId;
  task.updatedAt = new Date().toISOString();
  saveTask(root, configDir, task);
  return task;
}

/** Dash-slug of a request: lowercase, non-alphanumerics collapsed, capped at `max`. */
export function taskSlug(request: string, max = 40): string {
  return request
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/**
 * Task id from the request: its friendly name, `Task-<Words>-<DD-MM-YYYY>`
 * (`Task-Change-Table-Font-27-09-2026`); a request with no words is
 * `Task-Untitled-<date>`. Callers add a `-2`, `-3`… suffix when it is taken.
 */
export function nextTaskId(request: string, now = new Date()): string {
  return taskName(request, now);
}

/** Files that make up a task's temporary working state (§20). */
const TASK_ARTIFACTS = ["proposal.md", "plan.md", "designer.md", "backend.md", "qa.md"];

/**
 * §20: on completion the scratchpads are deleted while the distilled
 * knowledge, decisions, and the task's own state.json record are retained.
 */
export function removeTaskScratchpads(root: string, configDir: string, taskId: string): void {
  const dir = taskDir(dataRoot(root, configDir), taskId);
  if (!existsSync(dir)) return;
  for (const file of TASK_ARTIFACTS) rmSync(join(dir, file), { force: true });
  for (const file of readdirSync(dir)) {
    if (file.startsWith("scout-")) rmSync(join(dir, file), { force: true });
  }
}
