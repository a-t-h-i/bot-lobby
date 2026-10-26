import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

/** True only when the lock's owner is shown to be gone: same host, and its process no longer exists. */
function ownerGone(path: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown; host?: unknown };
    if (typeof owner.pid !== "number" || (owner.host !== undefined && owner.host !== hostname())) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  } catch { return false; }
}

function create(path: string, token: string): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify({ token, pid: process.pid, host: hostname() })); }
  finally { closeSync(fd); }
}

/**
 * Initial reconnaissance and targeted followups share the same task-local lock.
 * A lock left by a process that died (a crash, a killed window) is taken over;
 * one held by a live or unknown owner refuses the second scout.
 */
export function acquireScoutLock(taskDir: string): () => void {
  mkdirSync(taskDir, { recursive: true });
  const path = join(taskDir, "scout.lock");
  const token = randomUUID();
  try {
    create(path, token);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!ownerGone(path)) throw new Error(`A scout is already running for this task (${path}). Wait for its findings instead of starting another.`);
    unlinkSync(path);
    create(path, token);
  }
  return () => {
    const owner = JSON.parse(readFileSync(path, "utf8")) as { token?: string };
    if (owner.token !== token) throw new Error(`Scout lock ownership changed: ${path}`);
    unlinkSync(path);
  };
}
