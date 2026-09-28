/**
 * JSON files as last parsed, kept while each file's stat is unchanged. The
 * owner's clock and the lobby look at every task (and planned or archived
 * task) every few seconds in every session; a file is parsed again only when
 * it changed. A file written a moment ago is not kept (two writes that close
 * together can share a stat), and this process's own writes drop their entry
 * at once. What comes back is shared with every other caller: for reading
 * only.
 */
import { readFileSync, statSync } from "node:fs";

/** How long ago a file must have been written for its parse to be kept. */
export const SETTLE_MS = 1000;

/** Files kept at most; the least recently read are let go past this (archived tasks listed once, say). */
export const CACHE_LIMIT = 512;

const parsed = new Map<string, { stamp: string; value: unknown }>();

/** The file at `path` parsed as JSON and accepted by `valid`; undefined when missing, unreadable or rejected. */
export function readJsonCached<T>(path: string, valid: (value: unknown) => value is T): T | undefined {
  let stamp: string;
  let settled: boolean;
  try {
    const stat = statSync(path, { bigint: true });
    stamp = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    settled = Date.now() - Number(stat.mtimeMs) >= SETTLE_MS;
  } catch {
    parsed.delete(path);
    return undefined;
  }
  const hit = parsed.get(path);
  if (hit?.stamp === stamp) {
    // Most recently read last, so the one let go is the longest unread.
    parsed.delete(path);
    parsed.set(path, hit);
    return valid(hit.value) ? hit.value : undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    parsed.delete(path);
    return undefined;
  }
  parsed.delete(path);
  if (settled) {
    parsed.set(path, { stamp, value });
    if (parsed.size > CACHE_LIMIT) parsed.delete(parsed.keys().next().value!);
  }
  return valid(value) ? value : undefined;
}

/** Drop a file's entry (this process is about to write it). */
export function forgetCached(path: string): void {
  parsed.delete(path);
}

/** Drop the entries under `dir` other than `keep` (files that left the folder). */
export function forgetCachedUnder(dir: string, keep: ReadonlySet<string>): void {
  for (const path of parsed.keys()) if (path.startsWith(dir) && !keep.has(path)) parsed.delete(path);
}
