import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TMPDIR = mkdtempSync(join(tmpdir(), "bl-att-"));
const { attachmentDir, releaseAttachments, sweepAttachments } = await import("../src/state/attachments.ts");
const { saveUpload, withAttachments } = await import("../src/webui/uploads.ts");

const file = (id: string) => existsSync(join(attachmentDir(), id));

test("files sent during a task go when that task finishes, and only that task's", () => {
  const mine = saveUpload("a.png", "image/png", Buffer.from("a"));
  const other = saveUpload("b.pdf", "", Buffer.from("b"));
  withAttachments("hi", [mine.id], "T-1");
  withAttachments("hi", [other.id], "T-2");
  assert.equal(releaseAttachments("T-1"), 1);
  assert.equal(file(mine.id), false);
  assert.equal(file(other.id), true);
  assert.equal(releaseAttachments("T-1"), 0, "nothing left to remove");
});

test("files nobody claimed are swept once they are old; claimed and fresh ones stay", () => {
  const stale = saveUpload("old.txt", "", Buffer.from("o"));
  const fresh = saveUpload("new.txt", "", Buffer.from("n"));
  const kept = saveUpload("kept.txt", "", Buffer.from("k"));
  withAttachments("x", [kept.id], "T-9");
  const long = new Date(Date.now() - 10 * 24 * 3600 * 1000);
  for (const upload of [stale, kept]) utimesSync(join(attachmentDir(), upload.id), long, long);
  assert.equal(sweepAttachments(24 * 3600 * 1000), 1);
  assert.deepEqual([file(stale.id), file(fresh.id), file(kept.id)], [false, true, true]);
});
