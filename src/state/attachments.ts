/**
 * Files attached in the lobby's composer live in a temp folder outside the
 * repository. Each one sent while a task was in play is remembered against
 * that task, and removed when the task completes, is abandoned, archived or
 * deleted. Files never sent, or sent with no task, go after a few days.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { previewRoot } from "./previews.ts";
import { join } from "node:path";

/** The folder the page's preview route serves attachments from. */
export function attachmentDir(root?: string): string {
  return join(previewRoot(root), "attachments");
}

function indexPath(root?: string): string {
  return join(previewRoot(root), "attachments.json");
}

function readIndex(root?: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(root), "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function writeIndex(index: Record<string, string>, root?: string): void {
  try {
    mkdirSync(previewRoot(root), { recursive: true, mode: 0o700 });
    writeFileSync(indexPath(root), JSON.stringify(index), { mode: 0o600 });
  } catch {
    // The files then fall to the age sweep.
  }
}

/** Remember that `ids` belong to `taskId`. */
export function claimAttachments(ids: readonly string[], taskId: string, root?: string): void {
  if (ids.length === 0) return;
  const index = readIndex(root);
  for (const id of ids) index[id] = taskId;
  writeIndex(index, root);
}

/** Delete every file that was sent while `taskId` was in play. */
export function releaseAttachments(taskId: string, root?: string): number {
  const index = readIndex(root);
  let removed = 0;
  for (const [id, owner] of Object.entries(index)) {
    if (owner !== taskId) continue;
    try {
      rmSync(join(attachmentDir(root), id), { force: true });
      removed += 1;
    } catch {
      // A file already gone is the goal.
    }
    delete index[id];
  }
  if (removed > 0 || Object.keys(index).length !== Object.keys(readIndex(root)).length) writeIndex(index, root);
  return removed;
}

/** Delete files older than `maxAgeMs` that no task claimed. */
export function sweepAttachments(maxAgeMs: number, now = Date.now(), root?: string): number {
  const dir = attachmentDir(root);
  if (!existsSync(dir)) return 0;
  const claimed = new Set(Object.keys(readIndex(root)));
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (claimed.has(name)) continue;
    try {
      if (now - statSync(join(dir, name)).mtimeMs > maxAgeMs) {
        rmSync(join(dir, name), { force: true });
        removed += 1;
      }
    } catch {
      // Skip what cannot be read.
    }
  }
  return removed;
}
