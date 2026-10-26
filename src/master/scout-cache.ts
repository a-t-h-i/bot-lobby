/**
 * Scout findings kept for reuse. A scout asked the same thing (same domain,
 * same instruction, same task) on a work tree that has not changed since it
 * last answered gives the same answer, so the engine hands the oracle the
 * earlier findings instead of running it again: after a crash and resume, or
 * when the oracle repeats a question. Any change to the tree (a commit, an
 * edit, a new file) makes every cached answer stale.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Domain } from "../schemas/agent.ts";
import type { ScoutOutcome } from "./master.ts";

interface CachedScout {
  version: 1;
  tree: string;
  at: string;
  outcome: ScoutOutcome;
}

/** Cached answers older than this are dropped when the next one is written. */
export const SCOUT_CACHE_DAYS = 7;

export function scoutCacheDir(dataDir: string): string {
  return join(dataDir, "cache", "scouts");
}

/** The question a scout is asked, as a file name. */
export function scoutKey(domain: Domain, instruction: string, taskText: string): string {
  return createHash("sha256").update(JSON.stringify([domain, instruction.trim(), taskText.trim()])).digest("hex").slice(0, 32);
}

/** The earlier answer to this question on this tree, marked with when it was taken; undefined when there is none or the tree changed. */
export function readCachedScout(dataDir: string, key: string, tree: string): ScoutOutcome | undefined {
  try {
    const cached = JSON.parse(readFileSync(join(scoutCacheDir(dataDir), `${key}.json`), "utf8")) as Partial<CachedScout>;
    if (cached.version !== 1 || cached.tree !== tree || !cached.outcome?.usable || !cached.outcome.run?.runId || !cached.at) return undefined;
    return { ...cached.outcome, reused: cached.at };
  } catch {
    return undefined;
  }
}

function pruneScoutCache(dir: string, now: number): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      if (now - statSync(path).mtimeMs > SCOUT_CACHE_DAYS * 86_400_000) rmSync(path, { force: true });
    } catch {
      // Gone already.
    }
  }
}

/** Keep a usable answer for this question on this tree; failures are ignored (the cache only saves time). */
export function writeCachedScout(dataDir: string, key: string, tree: string, outcome: ScoutOutcome, now = new Date()): void {
  if (!outcome.usable) return;
  const dir = scoutCacheDir(dataDir);
  try {
    mkdirSync(dir, { recursive: true });
    pruneScoutCache(dir, now.getTime());
    const path = join(dir, `${key}.json`);
    const { reused: _reused, ...fresh } = outcome;
    writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, tree, at: now.toISOString(), outcome: fresh } satisfies CachedScout));
    renameSync(`${path}.tmp`, path);
  } catch {
    // Without the cache the scout just runs next time.
  }
}
