import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { contentHash, currentNotes, fileNoteHints, recordFileNotes, treePath } from "../src/knowledge/file-notes.ts";
import { EvidenceFreshness, verifyEvidenceHint, type EvidenceHint, type FreshnessInvalidation } from "../src/master/evidence-freshness.ts";

const hint: EvidenceHint = { id: "source", scope: "file", source: "src/a.ts", fingerprint: "hash" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("file notes survive unrelated edits but never validate broader findings", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-notes-"));
  try {
    const data = join(root, "data");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/a.ts"), "export const a = 1;");
    await recordFileNotes(data, root, "backend", [{ path: "src/a.ts", reason: "Defines a", lines: "1" }]);
    await writeFile(join(root, "unrelated.ts"), "changed");
    const hints = fileNoteHints(data, ["src/a.ts", "src/a.ts", "absent.ts"]);
    assert.equal(hints.length, 1);
    assert.equal(hints[0]?.status, "unverified hints");
    assert.equal(hints[0]?.usage, "navigation-only");
    assert.equal(hints[0]?.note.provenance?.scope, "file");
    assert.equal(await verifyEvidenceHint(root, hints[0]!, async () => "changed tree"), true);
    assert.equal((await currentNotes(data, root, ["src/a.ts"])).size, 1);
    assert.equal(await verifyEvidenceHint(root, { ...hint, scope: "repository", fingerprint: "old tree" }, async () => "changed tree"), false);
    await writeFile(join(root, "src/a.ts"), "export const a = 2;");
    assert.equal(await verifyEvidenceHint(root, hints[0]!, async () => "tree"), false);
    assert.equal((await currentNotes(data, root, ["src/a.ts"])).size, 0);
    assert.equal(treePath(root, "src/../../outside"), undefined);
    assert.equal(await contentHash(root, "src/../../outside"), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("background checks deduplicate and invalidate only dependent work, including completed work", async () => {
  const pending = deferred<boolean>();
  const events: FreshnessInvalidation[] = [];
  let checks = 0;
  const freshness = new EvidenceFreshness(async () => { checks += 1; return pending.promise; }, (event) => { events.push(event); });
  const a = freshness.start({ assignmentId: "a", revision: 1, hints: [hint] });
  const b = freshness.start({ assignmentId: "b", revision: 1, hints: [hint] });
  await freshness.start({ assignmentId: "unaffected", revision: 1, hints: [] });
  assert.equal(freshness.status("a", 1), "unverified hints");
  assert.equal(freshness.canAccept("a", 1), false);
  freshness.completed("a", 1);
  pending.resolve(false);
  await Promise.all([a, b]);
  assert.equal(checks, 1);
  assert.equal(freshness.status("a", 1), "invalidated");
  assert.equal(freshness.canAccept("unaffected", 1), true);
  assert.deepEqual(events.map((event) => [event.assignmentId, event.pause, event.recheckCompletedWork]), [["a", true, true], ["b", true, false]]);
});

test("superseded revision results cannot invalidate replacement work", async () => {
  const old = deferred<boolean>();
  const events: FreshnessInvalidation[] = [];
  const freshness = new EvidenceFreshness(async (item) => item.fingerprint === "hash" ? old.promise : true, (event) => { events.push(event); });
  const previous = freshness.start({ assignmentId: "a", revision: 1, hints: [hint] });
  await freshness.start({ assignmentId: "a", revision: 2, hints: [{ ...hint, fingerprint: "new" }] });
  old.resolve(false);
  await previous;
  assert.equal(freshness.status("a", 1), "superseded");
  assert.equal(freshness.canAccept("a", 2), true);
  assert.deepEqual(events, []);
  assert.throws(() => freshness.start({ assignmentId: "a", revision: 2, hints: [] }), /increasing/);
});

test("completed dispatch retries recheck the same revision without resetting other workers", async () => {
  let checks = 0;
  const freshness = new EvidenceFreshness(async () => { checks++; return true; }, () => {});
  await freshness.start({ assignmentId: "other", revision: 1, hints: [] });
  await freshness.start({ assignmentId: "a", revision: 1, hints: [hint] });
  freshness.completed("a", 1);
  await freshness.start({ assignmentId: "a", revision: 1, hints: [hint] });
  assert.equal(checks, 2);
  assert.equal(freshness.canAccept("other", 1), true);
  await freshness.start({ assignmentId: "a", revision: 2, hints: [] });
  assert.throws(() => freshness.start({ assignmentId: "a", revision: 1, hints: [] }), /increasing/);
});

test("dispatch can begin on current assigned files while checks remain unverified", async () => {
  const pending = deferred<boolean>();
  const freshness = new EvidenceFreshness(async () => pending.promise, () => {});
  const checking = freshness.start({ assignmentId: "a", revision: 1, hints: [hint, hint] });
  // This is the dispatch ordering used by runWorker: no await before current-file work.
  const dispatched = Promise.resolve("current assigned-file work");
  assert.equal(await dispatched, "current assigned-file work");
  assert.equal(freshness.status("a", 1), "unverified hints");
  assert.equal(freshness.canAccept("a", 1), false);
  freshness.completed("a", 1);
  pending.resolve(true);
  await checking;
  assert.equal(freshness.canAccept("a", 1), true);
});

test("notification failure does not release the acceptance barrier before other checks finish", async () => {
  const pending = deferred<boolean>();
  const failedNotice = deferred<void>();
  const freshness = new EvidenceFreshness(async (item) => item.id === hint.id ? false : pending.promise, () => {
    failedNotice.resolve();
    throw new Error("board delivery failed");
  });
  let settled = false;
  const checking = freshness.start({ assignmentId: "a", revision: 1, hints: [hint, { ...hint, id: "other", source: "other.ts" }] });
  const rejected = assert.rejects(checking, /board delivery failed/).then(() => { settled = true; });
  await failedNotice.promise;
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(freshness.canAccept("a", 1), false);
  pending.resolve(true);
  await rejected;
});

test("failed checks invalidate hints and subsequent revisions recheck rather than reuse a verdict", async () => {
  let checks = 0;
  const freshness = new EvidenceFreshness(async () => { checks += 1; if (checks === 1) throw new Error("unreadable"); return true; }, () => {});
  await freshness.start({ assignmentId: "a", revision: 1, hints: [hint] });
  assert.equal(freshness.status("a", 1), "invalidated");
  await freshness.start({ assignmentId: "a", revision: 2, hints: [hint] });
  assert.equal(freshness.canAccept("a", 2), true);
  assert.equal(checks, 2);
});
