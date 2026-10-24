// Focused tests for the shared knowledge glossary (plan §3, §4, §6): search
// and open over the derived catalogue, reference identity through edits,
// deletions, duplicates and corrupt rebuilds, scope and symlink denial, and
// the response budgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cataloguePath, loadCatalogue, refreshCatalogue, type Catalogue } from "../src/knowledge/catalogue.ts";
import { addNote } from "../src/knowledge/notes.ts";
import { authorizedSources, notesFor, openReference, searchCatalogue, type Access, type OpenOutcome } from "../src/knowledge/retrieval.ts";

const KNOWLEDGE = [
  "# Knowledge",
  "",
  "## Board delivery",
  "- Post board updates through the typed board; the lock contract is recorded in decisions.",
  "- Contention on the board is resolved by the retry policy, never by dropping a post.",
  "",
  "## Sampling",
  "- The sampler keeps its own buffer; do not share it with the board code.",
].join("\n");

const DECISIONS = [
  "# Decisions",
  "",
  "## Delivery guarantees",
  "- Board writes take a lock and never reuse sequence numbers.",
].join("\n");

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kc-"));
  mkdirSync(join(root, "Master", "knowledge"), { recursive: true });
  mkdirSync(join(root, "cache"), { recursive: true });
  return root;
}

function write(root: string, file: string, content: string): void {
  writeFileSync(join(root, file), content);
}

function seeded(): { root: string; catalogue: Catalogue } {
  const root = makeRoot();
  write(root, "Master/knowledge/knowledge.md", KNOWLEDGE);
  write(root, "Master/knowledge/decisions.md", DECISIONS);
  return { root, catalogue: refreshCatalogue([root]).catalogue };
}

function access(root: string, cwd = root): Access {
  return { dataRoots: [root], cwd };
}

const NO_NOTES = [] as const;

function open(root: string, catalogue: Catalogue, ref: string, extra: Partial<Parameters<typeof openReference>[0]> = {}): Promise<OpenOutcome> {
  return openReference({ catalogue, access: access(root), notes: NO_NOTES, ref, callerKey: "test-caller", ...extra });
}

function idsOf(catalogue: Catalogue): string[] {
  return catalogue.entries.filter((entry) => entry.freshness !== "stale").map((entry) => entry.id);
}

test("refresh indexes knowledge files; search finds terms, ids, headings and paths", () => {
  const { root, catalogue } = seeded();
  const result = refreshCatalogue([root]);
  assert.equal(result.coverage, "complete");
  const search = searchCatalogue({ catalogue: result.catalogue, access: access(root), notes: NO_NOTES, query: "board" });
  assert.ok(search.matched >= 3, `expected board matches, got: ${search.text}`);
  assert.ok(/K-\S+ · Post board updates/.test(search.text), search.text);
  for (const id of idsOf(result.catalogue)) assert.match(id, /^K-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+$/, `id ${id} must carry its generation`);
  const byId = searchCatalogue({ catalogue: result.catalogue, access: access(root), notes: NO_NOTES, query: idsOf(result.catalogue)[0]! });
  assert.equal(byId.matched, 1);
  const byHeading = searchCatalogue({ catalogue: result.catalogue, access: access(root), notes: NO_NOTES, query: "Delivery guarantees" });
  assert.ok(byHeading.matched >= 1, byHeading.text);
  const empty = searchCatalogue({ catalogue: result.catalogue, access: access(root), notes: NO_NOTES, query: "zzz-nothing", coverage: "complete" });
  assert.equal(empty.matched, 0);
  assert.match(empty.text, /coverage: complete/);
});

test("search pages at 20 references within the 4000-char budget", () => {
  const root = makeRoot();
  const bullets = Array.from({ length: 25 }, (_, i) => `- pagination item ${i} shares the token flibble for ranking.`).join("\n");
  write(root, "Master/knowledge/knowledge.md", `# Knowledge\n\n${bullets}\n`);
  const catalogue = refreshCatalogue([root]).catalogue;
  const first = searchCatalogue({ catalogue, access: access(root), notes: NO_NOTES, query: "flibble" });
  assert.equal(first.matched, 25);
  assert.ok(first.text.length <= 4000, `page was ${first.text.length} chars`);
  assert.ok(first.nextAfter !== undefined, "expected a next page pointer");
  assert.equal(first.text.split("\n").filter((line) => /^K-\S+ ·/.test(line)).length, 20);
  const second = searchCatalogue({ catalogue, access: access(root), notes: NO_NOTES, query: "flibble", after: first.nextAfter });
  assert.equal(second.matched, 25);
  assert.equal(second.text.split("\n").filter((line) => /^K-\S+ ·/.test(line)).length, 5);
  assert.equal(second.nextAfter, undefined);
});

test("empty query asks for a query instead of matching everything", () => {
  const { root, catalogue } = seeded();
  const outcome = searchCatalogue({ catalogue, access: access(root), notes: NO_NOTES, query: "   " });
  assert.equal(outcome.matched, 0);
  assert.match(outcome.text, /Name a reference/);
});

test("open returns the passage with provenance and never exceeds the budget", async () => {
  const { root, catalogue } = seeded();
  const id = idsOf(catalogue).find((id) => catalogue.entries.some((entry) => entry.id === id && entry.locator.heading?.includes("Delivery guarantees")));
  const outcome = await open(root, catalogue, id!);
  assert.equal(outcome.status, "ok");
  assert.ok(outcome.text.includes(id!), outcome.text);
  assert.ok(outcome.text.includes("decisions.md"), outcome.text);
  assert.ok(outcome.text.includes("never reuse sequence numbers"), outcome.text);
  assert.ok(outcome.text.length <= 4000);
});

test("long passages clip with a continuation that resumes and is caller-bound", async () => {
  const root = makeRoot();
  const long = `- long passage ${"x".repeat(6000)} end of passage.`;
  write(root, "Master/knowledge/knowledge.md", `# Knowledge\n\n${long}\n`);
  const catalogue = refreshCatalogue([root]).catalogue;
  const [id] = idsOf(catalogue);
  const first = await open(root, catalogue, id!);
  assert.equal(first.status, "ok");
  assert.ok(first.text.length <= 4000, `open was ${first.text.length} chars`);
  assert.ok(first.continuation, "expected a continuation token");
  assert.ok(first.text.includes("[truncated"), first.text);
  const second = await open(root, catalogue, id!, { continuation: first.continuation });
  assert.equal(second.status, "ok");
  assert.ok(second.text.includes("end of passage."), second.text);
  assert.equal(second.continuation, undefined);
  const wrongCaller = await open(root, catalogue, id!, { continuation: first.continuation, callerKey: "someone-else" });
  assert.equal(wrongCaller.status, "stale");
  const tampered = await open(root, catalogue, id!, { continuation: `${first.continuation}x` });
  assert.equal(tampered.status, "stale");
});

test("identity survives unrelated insertions and moves", async () => {
  const { root, catalogue } = seeded();
  const before = catalogue.entries.find((entry) => entry.locator.text.includes("retry policy"))!;
  write(root, "Master/knowledge/knowledge.md", KNOWLEDGE.replace("## Board delivery", "## Board delivery\n\n- A brand new unrelated bullet about caching.").replace("## Sampling", "Renamed heading\n\n## Sampling"));
  const refreshed = refreshCatalogue([root]).catalogue;
  const after = refreshed.entries.find((entry) => entry.id === before.id)!;
  assert.ok(after, "the id should survive an unrelated insertion");
  assert.equal(after.freshness, "current");
  const opened = await open(root, refreshed, before.id);
  assert.equal(opened.status, "ok");
});

test("an edited passage keeps its id only when uniquely matched, marked changed", async () => {
  const root = makeRoot();
  const original = "- Contention on the board is resolved by the retry policy.\n  Dropping a post is never acceptable under the retry policy.";
  write(root, "Master/knowledge/knowledge.md", `# Knowledge\n\n${original}\n`);
  const catalogue = refreshCatalogue([root]).catalogue;
  const before = catalogue.entries.find((entry) => entry.locator.text.includes("retry policy"))!;
  write(root, "Master/knowledge/knowledge.md", `# Knowledge\n\n- Contention on the board is resolved by the retry policy.\n  Dropping a post is never acceptable; backoff with jitter now guards the board.\n`);
  const refreshed = refreshCatalogue([root]).catalogue;
  const after = refreshed.entries.find((entry) => entry.id === before.id)!;
  assert.ok(after, "unique edited match keeps the id");
  assert.equal(after.freshness, "changed");
  assert.equal(after.revision, 2);
  const opened = await open(root, refreshed, before.id);
  assert.ok(opened.text.includes("verify before relying"), opened.text);
});

test("a deleted passage goes stale; open offers no replacement", async () => {
  const { root, catalogue } = seeded();
  const victim = catalogue.entries.find((entry) => entry.locator.text.includes("retry policy"))!;
  write(root, "Master/knowledge/knowledge.md", KNOWLEDGE.replace("- Contention on the board is resolved by the retry policy, never by dropping a post.\n", ""));
  const refreshed = refreshCatalogue([root]).catalogue;
  const after = refreshed.entries.find((entry) => entry.id === victim.id)!;
  assert.equal(after.freshness, "stale");
  const opened = await open(root, refreshed, victim.id);
  assert.equal(opened.status, "stale");
  assert.match(opened.text, /No replacement is offered/);
  const exact = searchCatalogue({ catalogue: refreshed, access: access(root), notes: NO_NOTES, query: victim.id });
  assert.match(exact.text, /stale/);
  assert.equal(exact.matched, 0);
});

test("duplicate identical passages get distinct ids and never cross-link", async () => {
  const root = makeRoot();
  const twin = "- twin bullet with identical text everywhere it appears.";
  write(root, "Master/knowledge/knowledge.md", `# Knowledge\n\n${twin}\n\n${twin}\n`);
  const catalogue = refreshCatalogue([root]).catalogue;
  const twins = catalogue.entries.filter((entry) => entry.locator.text === twin);
  assert.equal(twins.length, 2);
  assert.notEqual(twins[0]!.id, twins[1]!.id);
  write(root, "Master/knowledge/knowledge.md", `# Knowledge\n\n${twin}\n\n- twin bullet with edited text now instead.\n`);
  const refreshed = refreshCatalogue([root]).catalogue;
  const kept = refreshed.entries.find((entry) => entry.id === twins[0]!.id)!;
  assert.equal(kept.freshness, "current", "the untouched twin keeps its id");
  const editedOld = refreshed.entries.find((entry) => entry.id === twins[1]!.id)!;
  assert.equal(editedOld.freshness, "stale", "the ambiguous twin is never silently reused");
  assert.ok(refreshed.entries.some((entry) => entry.freshness === "current" && entry.locator.text.includes("edited text now")), "the edit gets a fresh id");
});

test("a corrupt catalogue is rebuilt under a new generation; old ids go stale, never redirect", async () => {
  const { root, catalogue } = seeded();
  const oldIds = idsOf(catalogue);
  const oldGeneration = catalogue.generation;
  writeFileSync(cataloguePath(root), "{corrupt json");
  const rebuilt = refreshCatalogue([root]).catalogue;
  assert.notEqual(rebuilt.generation, oldGeneration);
  for (const id of idsOf(rebuilt)) assert.match(id, new RegExp(`^K-${rebuilt.generation}-\\d+$`), `rebuilt id ${id} must carry the new generation`);
  assert.ok(loadCatalogue(root), "the rebuilt catalogue persists");
  for (const oldId of oldIds) {
    const exact = searchCatalogue({ catalogue: rebuilt, access: access(root), notes: NO_NOTES, query: oldId });
    assert.equal(exact.matched, 0, oldId);
    assert.match(exact.text, /earlier catalogue generation/);
    const opened = await open(root, rebuilt, oldId);
    assert.equal(opened.status, "stale", oldId);
    assert.match(opened.text, /earlier catalogue generation/);
    assert.ok(!opened.text.includes("retry policy") && !opened.text.includes("sequence numbers"), opened.text);
  }
});

test("repeated corruption and rebuilds with identical counters never reuse a persisted reference", async () => {
  const { root, catalogue } = seeded();
  const originalRandom = Math.random;
  Math.random = () => 0.42; // forced identical draws: identity must not depend on randomness
  const generations: string[] = [catalogue.generation];
  const idRounds: string[][] = [idsOf(catalogue)];
  try {
    for (let round = 0; round < 2; round += 1) {
      writeFileSync(cataloguePath(root), "{corrupt json");
      const rebuilt = refreshCatalogue([root]).catalogue;
      generations.push(rebuilt.generation);
      idRounds.push(idsOf(rebuilt));
    }
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(new Set(generations).size, generations.length, "each rebuild mints a new generation");
  const newest = idRounds[idRounds.length - 1]!;
  const newestCatalogue = loadCatalogue(root)!;
  for (let round = 0; round < idRounds.length - 1; round += 1) {
    for (const oldId of idRounds[round]!) {
      assert.ok(!newest.includes(oldId), `${oldId} must not be minted again`);
      const opened = await open(root, newestCatalogue, oldId);
      assert.equal(opened.status, "stale", oldId);
      assert.match(opened.text, /earlier catalogue generation/);
      assert.ok(!opened.text.includes("retry policy") && !opened.text.includes("sequence numbers"), opened.text);
      const exact = searchCatalogue({ catalogue: newestCatalogue, access: access(root), notes: NO_NOTES, query: oldId });
      assert.equal(exact.matched, 0, oldId);
      assert.match(exact.text, /earlier catalogue generation/);
    }
  }
  const sameCounter = idRounds[0]![0]!.replace(/^K-[0-9a-f-]+-/, "");
  assert.ok(newest.some((id) => id.endsWith(`-${sameCounter}`)), "counters repeat across rebuilds; only the generation namespace differs");
  assert.notEqual(idRounds[0]![0], newest.find((id) => id.endsWith(`-${sameCounter}`)));
});

test("exact search and continuation work with generation-tagged ids", async () => {
  const root = makeRoot();
  const long = `- a long generation-id passage ${"y".repeat(6000)} tail of the passage.`;
  write(root, "Master/knowledge/knowledge.md", `# Knowledge\n\n${long}\n`);
  const catalogue = refreshCatalogue([root]).catalogue;
  const [id] = idsOf(catalogue);
  assert.match(id!, /^K-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+$/);
  const exact = searchCatalogue({ catalogue, access: access(root), notes: NO_NOTES, query: id! });
  assert.equal(exact.matched, 1);
  assert.ok(exact.text.startsWith(id!), exact.text);
  const first = await open(root, catalogue, id!);
  assert.equal(first.status, "ok");
  assert.ok(first.continuation, "expected a continuation token");
  const second = await open(root, catalogue, id!, { continuation: first.continuation });
  assert.equal(second.status, "ok");
  assert.ok(second.text.includes("tail of the passage."), second.text);
});

test("a counter alone never resolves to another generation's entry", async () => {
  const { root, catalogue } = seeded();
  const oldId = idsOf(catalogue)[0]!;
  writeFileSync(cataloguePath(root), "{corrupt json");
  const rebuilt = refreshCatalogue([root]).catalogue;
  const counter = oldId.replace(/^K-[0-9a-f-]+-/, "");
  const counterpart = rebuilt.entries.find((entry) => entry.id.endsWith(`-${counter}`));
  assert.ok(counterpart, "the same counter exists in the new generation");
  assert.notEqual(counterpart!.id, oldId);
  const opened = await open(root, rebuilt, oldId);
  assert.equal(opened.status, "stale");
  assert.ok(!opened.text.includes(counterpart!.locator.text.slice(0, 30)), opened.text);
  const bare = await open(root, rebuilt, counter);
  assert.equal(bare.status, "not-found", "a bare counter is not a reference");
});

test("entries outside the caller's data roots are denied without being named", async () => {
  const rootA = makeRoot();
  const rootB = makeRoot();
  write(rootA, "Master/knowledge/knowledge.md", KNOWLEDGE);
  write(rootB, "Master/knowledge/decisions.md", DECISIONS);
  const catalogue = refreshCatalogue([rootA, rootB]).catalogue;
  const restricted = access(rootA);
  const full = access(rootA) && { dataRoots: [rootA, rootB], cwd: rootA } as Access;
  const bEntry = catalogue.entries.find((entry) => entry.sourceKey.includes(rootB))!;
  assert.ok(bEntry, "the other root was indexed");
  const search = searchCatalogue({ catalogue, access: restricted, notes: NO_NOTES, query: "sequence numbers" });
  assert.equal(search.matched, 0);
  assert.ok(!search.text.includes(rootB), "the unauthorized path is never named");
  assert.match(search.text, /not available to you/);
  const opened = await openReference({ catalogue, access: restricted, notes: NO_NOTES, ref: bEntry.id, callerKey: "test-caller" });
  assert.equal(opened.status, "unauthorized");
  assert.ok(!opened.text.includes(rootB), opened.text);
  const entitled = await openReference({ catalogue, access: full, notes: NO_NOTES, ref: bEntry.id, callerKey: "test-caller" });
  assert.equal(entitled.status, "ok");
});

test("a source that becomes a symlink out of the data tree is never followed or named", async () => {
  const root = makeRoot();
  const outside = mkdtempSync(join(tmpdir(), "kc-out-"));
  const secret = join(outside, "secret.md");
  writeFileSync(secret, "- the board lock is stored in /etc/shadow for testing.\n");
  const source = join(root, "Master/knowledge/knowledge.md");
  write(root, "Master/knowledge/knowledge.md", KNOWLEDGE);
  const catalogue = refreshCatalogue([root]).catalogue;
  assert.ok(catalogue.entries.some((entry) => entry.freshness !== "stale"));
  rmSync(source);
  symlinkSync(secret, source);
  assert.equal(authorizedSources(access(root)).size, 0, "the escaping symlink is not authorized");
  const refreshed = refreshCatalogue([root]).catalogue;
  for (const entry of refreshed.entries) assert.equal(entry.freshness, "stale");
  const victim = catalogue.entries[0]!;
  const opened = await open(root, refreshed, victim.id);
  assert.equal(opened.status, "stale");
  assert.ok(!opened.text.includes("/etc/shadow"), opened.text);
  rmSync(outside, { recursive: true, force: true });
});

test("passages that look like they carry secrets are never indexed", () => {
  const root = makeRoot();
  write(root, "Master/knowledge/knowledge.md", "# Knowledge\n\n- the deployment uses apiKey: hunter2 for the release job.\n- a clean bullet about retries.\n");
  const result = refreshCatalogue([root]);
  assert.equal(result.skippedSecrets, 1);
  assert.ok(!JSON.stringify(result.catalogue.entries).includes("hunter2"));
  const search = searchCatalogue({ catalogue: result.catalogue, access: access(root), notes: NO_NOTES, query: "hunter2" });
  assert.equal(search.matched, 0);
});

test("user notes ride with their passage; unmatched ones show as detached", async () => {
  const { root, catalogue } = seeded();
  const bullet = catalogue.entries.find((entry) => entry.locator.text.includes("retry policy"))!;
  addNote(root, { agent: "master", file: "knowledge.md", entry: bullet.locator.text, text: "user correction: the retry policy is being replaced next sprint." });
  const notes = notesFor(root);
  const opened = await openReference({ catalogue, access: access(root), notes, ref: bullet.id, callerKey: "test-caller" });
  assert.ok(opened.text.includes("user correction"), opened.text);
  write(root, "Master/knowledge/knowledge.md", KNOWLEDGE.replace("## Board delivery", "## Board delivery (revised)"));
  const refreshed = refreshCatalogue([root]).catalogue;
  const moved = refreshed.entries.find((entry) => entry.locator.text.includes("retry policy"))!;
  assert.ok(moved, "the bullet itself is unchanged so the id survives");
  assert.equal(moved.freshness, "current");
  assert.ok(refreshed.entries.some((entry) => entry.freshness !== "stale" && entry.revision >= 1), "heading change re-indexes the file");
});

test("file-note findings open by their code dependency and flag changed code", async () => {
  const root = makeRoot();
  mkdirSync(join(root, "repo"), { recursive: true });
  const repoFile = join(root, "repo", "board.ts");
  writeFileSync(repoFile, "export const LOCK_WAIT_MS = 2000;\n");
  const hash = createHash("sha1").update(readFileSync(repoFile)).digest("hex");
  write(root, "cache/file-notes.json", JSON.stringify({ version: 1, files: { "board.ts": { note: "the board lock lives here and guards sequence numbers", hash, domain: "backend", at: new Date().toISOString() } } }));
  const catalogue = refreshCatalogue([root]).catalogue;
  const finding = catalogue.entries.find((entry) => entry.origin === "file-note");
  assert.ok(finding, "the file note was indexed");
  const search = searchCatalogue({ catalogue, access: access(root, join(root, "repo")), notes: NO_NOTES, query: "board.ts" });
  assert.ok(search.matched >= 1, search.text);
  const opened = await openReference({ catalogue, access: access(root, join(root, "repo")), notes: NO_NOTES, ref: finding!.id, callerKey: "test-caller" });
  assert.equal(opened.status, "ok");
  assert.ok(opened.text.includes("board lock lives here"), opened.text);
  assert.ok(opened.text.includes("unchanged since the note"), opened.text);
  writeFileSync(repoFile, "export const LOCK_WAIT_MS = 5000;\n");
  const reopened = await openReference({ catalogue, access: access(root, join(root, "repo")), notes: NO_NOTES, ref: finding!.id, callerKey: "test-caller" });
  assert.ok(reopened.text.includes("changed since the note"), reopened.text);
  assert.ok(reopened.text.includes("verify"), reopened.text);
});

test("recorded conflicts are shown together, not ranked apart", () => {
  const root = makeRoot();
  const first = "- Board writes take a lock and never reuse sequence numbers.";
  const second = "- Board writes take a lock and never reuse sequence numbers.";
  write(root, "Master/knowledge/knowledge.md", `# Knowledge\n\n${first}\n`);
  write(root, "Master/knowledge/decisions.md", `# Decisions\n\n${second}\n`);
  const k1 = refreshCatalogue([root]).catalogue.entries.find((entry) => entry.sourceKey.includes("knowledge.md"))!;
  write(root, "Master/knowledge/decisions.md", `# Decisions\n\n${second} See ${k1.id} for the superseded version.\n`);
  const catalogue = refreshCatalogue([root]).catalogue;
  const k2 = catalogue.entries.find((entry) => entry.sourceKey.includes("decisions.md") && entry.freshness !== "stale")!;
  assert.deepEqual(k2.conflicts, [k1.id], `the exact ${k1.id} reference recorded, got ${JSON.stringify(k2.conflicts)}`);
  const search = searchCatalogue({ catalogue, access: access(root), notes: NO_NOTES, query: "sequence numbers" });
  assert.ok(search.text.includes(k1.id) && search.text.includes(k2.id), search.text);
  assert.ok(search.text.includes(`records conflicts: ${k1.id}`), search.text);
  assert.ok(search.text.split("\n").findIndex((line) => line.startsWith(k1.id)) === search.text.split("\n").findIndex((line) => line.startsWith(k2.id)) - 1, "both sides appear together");
});

test("search and open from a root with no knowledge report unavailable coverage", () => {
  const root = makeRoot();
  const result = refreshCatalogue([root]);
  assert.equal(result.coverage, "unavailable");
  const search = searchCatalogue({ catalogue: result.catalogue, access: access(root), notes: NO_NOTES, query: "anything", coverage: result.coverage });
  assert.equal(search.matched, 0);
  assert.match(search.text, /coverage: unavailable/);
  assert.ok(existsSync(cataloguePath(root)));
});
