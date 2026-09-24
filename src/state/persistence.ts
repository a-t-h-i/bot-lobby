import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeConfig } from "../schemas/configuration.ts";
import type { Domain } from "../schemas/agent.ts";
import { TERMINAL_STATES, isTaskState, type Task } from "../schemas/task.ts";
import { dataRoot } from "./project.ts";
import {
  AGENT_DIR_NAMES,
  KNOWLEDGE_FILES,
  knowledgeDir,
  scratchpadPath,
  taskDir,
  tasksRoot,
  type KnowledgeAgent,
} from "../knowledge/paths.ts";
import { DEFAULT_KNOWLEDGE_CONTENT, ensureFile, writeFileEnsured } from "../knowledge/store.ts";

/** Idempotently create the full knowledge + tasks layout with seed files. */
export function ensureProjectStructure(root: string, configDir: string): void {
  const dr = dataRoot(root, configDir);
  const agents = Object.keys(AGENT_DIR_NAMES) as KnowledgeAgent[];
  for (const agent of agents) {
    const dir = knowledgeDir(dr, agent);
    mkdirSync(dir, { recursive: true });
    for (const file of KNOWLEDGE_FILES[agent]) {
      ensureFile(join(dir, file), DEFAULT_KNOWLEDGE_CONTENT[file] ?? `# ${file}\n`);
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

export function saveTask(root: string, configDir: string, task: Task): void {
  writeFileEnsured(join(taskDir(dataRoot(root, configDir), task.id), "state.json"), JSON.stringify(task, null, 2));
}

export function loadTask(root: string, configDir: string, taskId: string): Task | undefined {
  try {
    return JSON.parse(readFileSync(join(taskDir(dataRoot(root, configDir), taskId), "state.json"), "utf8")) as Task;
  } catch {
    return undefined;
  }
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

/** All tasks on disk, newest first. Unreadable task dirs are skipped. */
export function listTasks(root: string, configDir: string): Task[] {
  const dir = tasksRoot(dataRoot(root, configDir));
  if (!existsSync(dir)) return [];
  const tasks: Task[] = [];
  for (const entry of readdirSync(dir)) {
    const task = loadTask(root, configDir, entry);
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Tasks on disk plus the ids whose state.json could not be read (§59). */
export function taskHealth(root: string, configDir: string): { tasks: Task[]; corrupted: string[] } {
  const dir = tasksRoot(dataRoot(root, configDir));
  if (!existsSync(dir)) return { tasks: [], corrupted: [] };
  const tasks: Task[] = [];
  const corrupted: string[] = [];
  for (const entry of readdirSync(dir)) {
    const task = loadTask(root, configDir, entry);
    if (!task) corrupted.push(entry);
    else if (task.id !== entry || !isTaskState(task.state)) corrupted.push(entry);
    else tasks.push(task);
  }
  return { tasks: tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), corrupted };
}

/** The task the Master is currently driving, if any. */
export function activeTask(root: string, configDir: string): Task | undefined {
  return listTasks(root, configDir).find((task) => !TERMINAL_STATES.includes(task.state));
}

/** A specific task, or the active one when no id is given. */
export function selectTask(root: string, configDir: string, taskId?: string): Task | undefined {
  return taskId ? loadTask(root, configDir, taskId) : activeTask(root, configDir);
}

/** Timestamped id; callers suffix it when a task already exists this second. */
export function nextTaskId(now = new Date()): string {
  return `TASK-${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
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
