/**
 * Auto mode, per task: the oracle drives the task to completion without
 * asking the user anything. The flag lives in its own file beside the task,
 * not in state.json, so any session can switch it (from the lobby, for a task
 * another session drives) without racing the owner's saves of the task.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { taskDirFor } from "./persistence.ts";

interface AutoFile {
  on: boolean;
  at: string;
  /** The session that last switched it. */
  by?: string;
}

export function autoPath(root: string, configDir: string, taskId: string): string {
  return join(taskDirFor(root, configDir, taskId), "auto.json");
}

/** Whether auto mode is on for the task; off when the file is missing or unreadable. */
export function isAutoMode(root: string, configDir: string, taskId: string): boolean {
  const path = autoPath(root, configDir, taskId);
  if (!existsSync(path)) return false;
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as Partial<AutoFile>).on === true;
  } catch {
    return false;
  }
}

/** Switch auto mode for the task (through a temp file, so a reader never sees half a write). */
export function setAutoMode(root: string, configDir: string, taskId: string, on: boolean, by?: string, now = new Date()): void {
  const path = autoPath(root, configDir, taskId);
  mkdirSync(dirname(path), { recursive: true });
  const record: AutoFile = { on, at: now.toISOString(), ...(by ? { by } : {}) };
  writeFileSync(`${path}.tmp`, `${JSON.stringify(record)}\n`);
  renameSync(`${path}.tmp`, path);
}
