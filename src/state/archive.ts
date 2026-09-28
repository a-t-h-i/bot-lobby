/**
 * Archiving and deleting tasks from the lobby. An archived task moves, whole,
 * out of the task tree to `archive/tasks/<id>` beside the knowledge archive:
 * no list, widget or session sees it any more, and it can be restored as it
 * was. Deleting removes a task's folder for good. A task still under way is
 * abandoned before it is archived, so it never comes back half-driven.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { taskDir, tasksRoot } from "../knowledge/paths.ts";
import { transition } from "./task-state.ts";
import { dataRoot, readDataRoots } from "./project.ts";
import { forgetCachedUnder, readJsonCached } from "./file-cache.ts";

export function archiveRoot(root: string, configDir: string): string {
  return join(dataRoot(root, configDir), "archive", "tasks");
}

/** Task ids become folder names: only ever one plain path segment. */
function checkId(taskId: string): string {
  if (!/^[\w.-]+$/.test(taskId) || taskId === "." || taskId === "..") throw new Error(`not a task id: ${taskId}`);
  return taskId;
}

function readAt(dir: string): Task | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as Task;
  } catch {
    return undefined;
  }
}

function writeAt(dir: string, task: Task): void {
  writeFileSync(join(dir, "state.json"), JSON.stringify(task, null, 2), "utf8");
}

/** Where a task on the list lives: the newest tree that has it (bot-lobby, then the pre-rename ones). */
function liveDir(root: string, configDir: string, taskId: string): string | undefined {
  return readDataRoots(root, configDir).map((dr) => taskDir(dr, taskId)).find((dir) => existsSync(join(dir, "state.json")));
}

function archivedDir(root: string, configDir: string, taskId: string): string {
  return join(archiveRoot(root, configDir), checkId(taskId));
}

function isObject(value: unknown): value is Task {
  return typeof value === "object" && value !== null;
}

/** Archived tasks, most recently archived first (parsed again only when a file changes; shared, for reading). */
export function listArchivedTasks(root: string, configDir: string): Task[] {
  const dir = archiveRoot(root, configDir);
  if (!existsSync(dir)) return [];
  const tasks: Task[] = [];
  const seen = new Set<string>();
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry, "state.json");
    seen.add(path);
    const task = readJsonCached(path, isObject);
    if (task) tasks.push(task);
  }
  forgetCachedUnder(`${dir}${sep}`, seen);
  return tasks.sort((a, b) => (b.archivedAt ?? b.updatedAt).localeCompare(a.archivedAt ?? a.updatedAt));
}

/**
 * Move a task out of every list into the archive; one still under way is
 * abandoned first (and says so in its decisions). Returns the archived task.
 */
export function archiveTask(root: string, configDir: string, taskId: string, now = new Date()): Task {
  const from = liveDir(root, configDir, checkId(taskId));
  const task = from ? readAt(from) : undefined;
  if (!from || !task) throw new Error(`no task ${taskId}`);
  const to = archivedDir(root, configDir, taskId);
  if (existsSync(to)) throw new Error(`${taskId} is already in the archive`);
  const stamp = now.toISOString();
  if (!TERMINAL_STATES.includes(task.state)) {
    transition(task, "abandoned", stamp);
    task.decisions.push({ domain: "master", text: "Abandoned when it was archived from the lobby.", createdAt: stamp });
  }
  task.archivedAt = stamp;
  writeAt(from, task);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return task;
}

/** Bring an archived task back to the lists, as it was when archived. */
export function restoreTask(root: string, configDir: string, taskId: string): Task {
  const from = archivedDir(root, configDir, taskId);
  const task = readAt(from);
  if (!task) throw new Error(`${taskId} is not in the archive`);
  const to = taskDir(dataRoot(root, configDir), taskId);
  if (existsSync(to)) throw new Error(`a task ${taskId} is already on the list`);
  delete task.archivedAt;
  writeAt(from, task);
  mkdirSync(tasksRoot(dataRoot(root, configDir)), { recursive: true });
  renameSync(from, to);
  return task;
}

/** Remove a task for good: its folder, from the list or from the archive. */
export function deleteTask(root: string, configDir: string, taskId: string, where: "list" | "archive" = "list"): void {
  const dir = where === "archive" ? archivedDir(root, configDir, taskId) : liveDir(root, configDir, checkId(taskId));
  if (!dir || !existsSync(dir)) throw new Error(where === "archive" ? `${taskId} is not in the archive` : `no task ${taskId}`);
  rmSync(dir, { recursive: true, force: true });
}
