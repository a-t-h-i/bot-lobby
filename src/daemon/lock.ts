/**
 * One daemon per project folder: `<project>/.bot-lobby/daemon.lock` holds the
 * running one's pid and port. A lock whose pid is gone is stale and taken over.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "../host/api.ts";
import { dataRoot } from "../state/project.ts";

export interface LockInfo {
  pid: number;
  port: number;
}

function lockPath(root: string): string {
  return join(dataRoot(root, CONFIG_DIR_NAME), "daemon.lock");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function readLock(root: string): LockInfo | undefined {
  try {
    const info = JSON.parse(readFileSync(lockPath(root), "utf8")) as Partial<LockInfo>;
    return typeof info.pid === "number" && typeof info.port === "number" ? { pid: info.pid, port: info.port } : undefined;
  } catch {
    return undefined;
  }
}

/** Take the lock, or say who holds it. `write` records the port once the server listens. */
export function acquireLock(root: string): { running?: LockInfo; write(port: number): void } {
  const held = readLock(root);
  if (held && held.pid !== process.pid && alive(held.pid) && held.port > 0) return { running: held, write: () => {} };
  const write = (port: number) => {
    mkdirSync(dataRoot(root, CONFIG_DIR_NAME), { recursive: true });
    writeFileSync(lockPath(root), `${JSON.stringify({ pid: process.pid, port })}\n`, { mode: 0o600 });
  };
  write(0);
  return { write };
}

export function releaseLock(root: string): void {
  const held = readLock(root);
  if (held && held.pid !== process.pid) return;
  rmSync(lockPath(root), { force: true });
}
