import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeConfig } from "../schemas/configuration.ts";
import type { Domain } from "../schemas/agent.ts";
import { TERMINAL_STATES, isTaskState, type Task } from "../schemas/task.ts";
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
  writeFileEnsured(join(dir, "state.json"), JSON.stringify(task, null, 2));
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

export function saveTask(root: string, configDir: string, task: Task): void {
  writeFileEnsured(join(taskDir(dataRoot(root, configDir), task.id), "state.json"), JSON.stringify(task, null, 2));
}

/** Read a task state: the bot-lobby copy wins, else the newest pre-rename copy. */
export function loadTask(root: string, configDir: string, taskId: string): Task | undefined {
  for (const dr of readDataRoots(root, configDir)) {
    const path = join(taskDir(dr, taskId), "state.json");
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Task;
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
    return JSON.parse(readFileSync(path, "utf8")) as Task;
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
  for (const { entry, dir } of taskEntries(root, configDir)) {
    const task = readTaskAt(dir);
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
 * Task id from the request (`TASK-<slug>`); requests with no usable slug fall
 * back to the timestamped `TASK-task-<timestamp>` form callers already suffix.
 */
export function nextTaskId(request: string, now = new Date()): string {
  const slug = taskSlug(request);
  if (slug.length > 0) return `TASK-${slug}`;
  return `TASK-task-${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
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

/** Delete the temporary task dir after knowledge has been distilled. */
export function cleanupTaskDir(root: string, configDir: string, taskId: string): void {
  rmSync(taskDir(dataRoot(root, configDir), taskId), { recursive: true, force: true });
}
