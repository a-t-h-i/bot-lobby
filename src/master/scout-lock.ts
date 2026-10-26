import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Initial reconnaissance and targeted followups share the same task-local lock. */
export function acquireScoutLock(taskDir: string): () => void {
  mkdirSync(taskDir, { recursive: true });
  const path = join(taskDir, "scout.lock");
  const token = randomUUID();
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(`Scout preparation is locked for this task (${path}). Wait for the active scout; after an interrupted run, confirm its process has stopped before removing this lock and retrying.`);
  }
  try { writeFileSync(fd, JSON.stringify({ token, pid: process.pid })); }
  finally { closeSync(fd); }
  return () => {
    const owner = JSON.parse(readFileSync(path, "utf8")) as { token?: string };
    if (owner.token !== token) throw new Error(`Scout lock ownership changed: ${path}`);
    unlinkSync(path);
  };
}
