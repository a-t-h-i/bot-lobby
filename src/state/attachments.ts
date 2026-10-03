/**
 * Files attached in the lobby's composer live in a temp folder outside the
 * repository. Each one sent while a task was in play is remembered against
 * that task, and removed when the task completes, is abandoned, archived or
 * deleted. Files never sent, or sent with no task, go after a few days.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The folder the page's preview route serves attachments from. */
export function attachmentDir(): string {
  return join(tmpdir(), "bot-lobby-previews", "attachments");
}

function indexPath(): string {
  return join(tmpdir(), "bot-lobby-previews", "attachments.json");
}

function readIndex(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(), "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function writeIndex(index: Record<string, string>): void {
  try {
    mkdirSync(join(tmpdir(), "bot-lobby-previews"), { recursive: true });
    writeFileSync(indexPath(), JSON.stringify(index), { mode: 0o600 });
  } catch {
    // The files then fall to the age sweep.
  }
}

/** Remember that `ids` belong to `taskId`. */
export function claimAttachments(ids: readonly string[], taskId: string): void {
  if (ids.length === 0) return;
  const index = readIndex();
  for (const id of ids) index[id] = taskId;
  writeIndex(index);
}

/** Delete every file that was sent while `taskId` was in play. */
export function releaseAttachments(taskId: string): number {
  const index = readIndex();
  let removed = 0;
  for (const [id, owner] of Object.entries(index)) {
    if (owner !== taskId) continue;
    try {
      rmSync(join(attachmentDir(), id), { force: true });
      removed += 1;
    } catch {
      // A file already gone is the goal.
    }
    delete index[id];
  }
  if (removed > 0 || Object.keys(index).length !== Object.keys(readIndex()).length) writeIndex(index);
  return removed;
}

/** Delete files older than `maxAgeMs` that no task claimed. */
export function sweepAttachments(maxAgeMs: number, now = Date.now()): number {
  const dir = attachmentDir();
  if (!existsSync(dir)) return 0;
  const claimed = new Set(Object.keys(readIndex()));
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
