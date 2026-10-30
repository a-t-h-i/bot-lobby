/**
 * A cooperative file lock shared by the board, its delivery state and the
 * scout-note and file caches: a directory made atomically beside the target
 * file, so several processes take turns over one read-modify-write. A lock
 * left behind by a crashed process is broken once stale; a caller that
 * cannot get the lock in time fails closed rather than writing beside the
 * holder and losing changes. Temp names carry the pid and a random suffix,
 * so concurrent writers never collide.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** How long a writer waits for another process's write, and when a lock is taken to be left behind. */
export const LOCK_WAIT_MS = 2000;
export const STALE_LOCK_MS = 10_000;

export const LOCK_BUSY = "the board is busy; try again";

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A lock's identity: the token its taker wrote inside it (an inode can be reused at once by a breaker's new lock). */
function lockIdentity(lock: string): string | undefined {
  try {
    return readFileSync(join(lock, "owner"), "utf8");
  } catch {
    return undefined;
  }
}

/** Mark a just-made lock as ours; undefined when it was broken before the mark landed. */
function claim(lock: string): string | undefined {
  const token = `${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(join(lock, "owner"), token, { flag: "wx" });
    return token;
  } catch {
    return undefined;
  }
}

/** False once the lock directory was broken and replaced: another writer may hold it. */
function stillOurs(lock: string, identity: string | undefined): boolean {
  return identity !== undefined && lockIdentity(lock) === identity;
}

/**
 * Run `write` holding the lock for `path` (a directory beside it, made
 * atomically). Throws `LOCK_BUSY` when another live writer holds it past the
 * wait, so no write ever happens beside the holder's. A lock broken as stale
 * while its (slow, not dead) holder kept running is detected before the
 * write: the holder retries from acquisition instead of writing beside the
 * writer that broke it, and never removes a successor's lock on release.
 */
export function withFileLock<T>(path: string, write: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const until = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      mkdirSync(lock);
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) rmSync(lock, { recursive: true, force: true });
      } catch {
        // Released meanwhile; the next attempt takes it.
      }
      if (Date.now() > until) throw new Error(LOCK_BUSY);
      sleep(5);
      continue;
    }
    const identity = claim(lock);
    if (!stillOurs(lock, identity)) {
      // Broken from under us before the write: take it again rather than write beside the breaker.
      if (Date.now() > until) throw new Error(LOCK_BUSY);
      sleep(5);
      continue;
    }
    try {
      return write();
    } finally {
      if (stillOurs(lock, identity)) rmSync(lock, { recursive: true, force: true });
    }
  }
}

/** A temp file name for `path` that no concurrent writer can also pick. */
export function tempName(path: string): string {
  return `${path}.${process.pid}.${randomUUID()}.tmp`;
}
