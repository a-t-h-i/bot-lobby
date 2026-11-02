import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactKnowledgeFile, maintainKnowledgeFile, overThreshold, planMaintenance } from "../src/knowledge/compactor.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { addNote, notesPath, readNotes } from "../src/knowledge/notes.ts";
import { refreshCatalogue } from "../src/knowledge/catalogue.ts";
import { searchCatalogue } from "../src/knowledge/retrieval.ts";
import { setPin } from "../src/knowledge/ledger.ts";
import { applyKnowledge, readFileOr, writeFileEnsured } from "../src/knowledge/store.ts";
import { ensureProjectStructure } from "../src/state/persistence.ts";

function dataRootFor(): string {
  const root = mkdtempSync(join(tmpdir(), "dh-c-"));
  ensureProjectStructure(root, ".pi");
  return join(root, ".pi", "bot-lobby");
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test("interrupted maintenance preserves active and durable history; overlapping maintenance is busy", async () => {
  const root = dataRootFor();
  const path = join(knowledgeDir(root, "backend"), "knowledge.md");
  const original = "# Knowledge\n\n## Superseded rule\nHistorical guidance\n";
  writeFileEnsured(path, original);
  const entry = { dataRoot: root, agent: "backend" as const, file: "knowledge.md", backupCount: 1 };
  await assert.rejects(maintainKnowledgeFile({ ...entry, afterArchive: () => { throw new Error("interrupted"); } }), /interrupted/);
  assert.equal(readFileOr(path), original);
  const history = join(root, "history", "Backend", "knowledge.md");
  assert.ok(readFileOr(history).includes(original));
  const ready = deferred();
  const gate = deferred();
  const first = maintainKnowledgeFile({ ...entry, afterArchive: () => { ready.release(); return gate.promise; } });
  await ready.promise;
  assert.equal((await maintainKnowledgeFile(entry)).status, "busy");
  gate.release();
  assert.equal((await first).status, "maintained");
  assert.match(readFileOr(history), /Historical guidance/);
});

function protectedFixture() {
  const root = dataRootFor();
  const path = join(knowledgeDir(root, "backend"), "knowledge.md");
  const pinned = "## Superseded pinned rule\n- Keep the real ledger pin active.";
  const repeated = "## Current rule\nKeep the current invariant.";
  const annotated = "## Superseded annotated rule\n- Retain this disputed guidance.";
  const inline = "## Superseded inline rule\nKeep this exception.\n> Note from the user: Still required.";
  writeFileEnsured(path, ["# Knowledge", pinned, annotated, inline, "## Superseded rule\nUNIQUE_REMOVED_RULE: Old historical instruction.", repeated, repeated].join("\n\n"));
  setPin(root, "backend", "knowledge.md", "- Keep the real ledger pin active.", true);
  addNote(root, { agent: "backend", file: "knowledge.md", entry: "- Retain this disputed guidance.", text: "Do not archive before resolution." });
  return { root, path, pinned, repeated, annotated, inline, notes: readNotes(root), log: readFileOr(notesPath(root)) };
}

function assertHistoricalSearch(root: string): void {
  const { catalogue } = refreshCatalogue([root]);
  const search = searchCatalogue({ catalogue, access: { dataRoots: [root], cwd: root }, notes: [], query: "UNIQUE_REMOVED_RULE" });
  assert.ok(search.matched > 0);
  assert.match(search.text, /history\/knowledge\.md/);
}

test("pinned and user-annotated rules survive while historical and duplicate sections archive", async () => {
  const fixture = protectedFixture();
  const { root, path, pinned, repeated, annotated, inline } = fixture;
  const result = await maintainKnowledgeFile({ dataRoot: root, agent: "backend", file: "knowledge.md", backupCount: 1 });
  assert.equal(result.status, "maintained");
  const active = readFileOr(path);
  for (const protectedContent of [pinned, annotated, inline]) assert.ok(active.includes(protectedContent), `retains ${protectedContent}`);
  assert.deepEqual(readNotes(root), fixture.notes);
  assert.equal(readFileOr(notesPath(root)), fixture.log);
  assert.doesNotMatch(active, /Old historical instruction/);
  assert.equal(active.split(repeated).length - 1, 1);
  assert.match(readFileOr(result.history), /Old historical instruction/);
  assert.equal(readFileOr(result.history).split(repeated).length - 1, 2);
  assertHistoricalSearch(root);
});

test("maintenance refuses to replace a snapshot changed by ordinary knowledge writes", async () => {
  const root = dataRootFor();
  const path = join(knowledgeDir(root, "backend"), "knowledge.md");
  const original = "# Knowledge\n\n## Superseded rule\nOld snapshot.\n";
  writeFileEnsured(path, original);
  const result = await maintainKnowledgeFile({
    dataRoot: root, agent: "backend", file: "knowledge.md", backupCount: 1,
    afterArchive: () => { applyKnowledge({ dataRoot: root, agent: "backend", kind: "knowledge", text: "Concurrent new guidance." }); },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error!, /changed during maintenance; retry/);
  assert.match(readFileOr(path), /Concurrent new guidance/);
  assert.ok(readFileOr(path).includes(original.trim()));
  assert.ok(readFileOr(result.history).includes(original));
});

test("only explicit supersession markers archive resolved ordinary guidance", () => {
  const cases: [string, boolean][] = [
    ["## Superseded rule\nThis has NOT been superseded.", false],
    ["## Superseded rule\nThis is not superseded.", false],
    ["## Superseded rule\nThis is not yet superseded.", false],
    ["## Superseded rule\nThis was never superseded.", false],
    ["## Superseded rule\nUnresolved guidance.", false],
    ["## Superseded rule\nPending decision.", false],
    ["## Current\nExplain how superseded rules are handled.", false],
    ['## Current\nWrite "Status: superseded" only after approval.', false],
    ["## Current\nThe old policy was superseded.", false],
    ["## Superseded rule\nOld resolved instruction.", true],
    ["## Superseded\nOld resolved instruction.", true],
    ["## Current\nStatus: superseded\nOld resolved instruction.", true],
  ];
  for (const [section, archived] of cases) {
    const plan = planMaintenance("knowledge.md", `# Knowledge\n\n${section}\n`);
    assert.equal(plan.removed.includes(section), archived, section);
  }
  assert.match(planMaintenance("completed-tasks.md", "# Completed\n\n## Old task\nUnresolved superseded wording.").removed, /Old task/);
});

test("overThreshold lists only files past the limit, largest first", () => {
  const root = dataRootFor();
  writeFileEnsured(join(knowledgeDir(root, "backend"), "knowledge.md"), "x".repeat(150));
  writeFileEnsured(join(knowledgeDir(root, "qa"), "knowledge.md"), "y".repeat(200));
  const oversized = overThreshold([root], 100);
  assert.deepEqual(oversized.map((entry) => entry.file), ["knowledge.md", "knowledge.md"]);
  assert.equal(oversized[0]!.agent, "qa");
  assert.equal(oversized[1]!.agent, "backend");
  assert.equal(oversized[1]!.chars, 150);
  assert.deepEqual(overThreshold([root], 10_000), []);
  assert.deepEqual(overThreshold([root], 149), [{ agent: "backend", file: "knowledge.md", chars: 150 }, { agent: "qa", file: "knowledge.md", chars: 200 }].sort((a, b) => b.chars - a.chars));
});

test("compactKnowledgeFile archives the previous version and writes the new one", () => {
  const root = dataRootFor();
  const path = join(knowledgeDir(root, "backend"), "knowledge.md");
  writeFileEnsured(path, "# Knowledge\n\nlong original content\n");
  const outcome = compactKnowledgeFile({
    dataRoot: root,
    agent: "backend",
    file: "knowledge.md",
    content: "# Knowledge\n\ncompact\n",
    backupCount: 1,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(readFileOr(path), "# Knowledge\n\ncompact\n");
  assert.ok(outcome.before > outcome.after);
  assert.ok(existsSync(outcome.archive));
  assert.match(readFileOr(outcome.archive), /long original content/);
  assert.match(outcome.archive, /archive\/Backend\//);
});

test("compaction keeps only the configured number of backups", () => {
  const root = dataRootFor();
  const dir = join(root, "archive", "Backend");
  for (const stamp of ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z"]) {
    compactKnowledgeFile({
      dataRoot: root,
      agent: "backend",
      file: "knowledge.md",
      content: `content ${stamp}`,
      backupCount: 1,
      now: new Date(stamp),
    });
  }
  const backups = readdirSync(dir).filter((entry) => entry.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.match(backups[0]!, /2026-01-03/);
});

test("compaction refuses files outside the agent's knowledge layout", () => {
  const root = dataRootFor();
  assert.throws(
    () => compactKnowledgeFile({ dataRoot: root, agent: "qa", file: "engineering-standards.md", content: "x", backupCount: 1 }),
    /not a knowledge file for qa/,
  );
  assert.throws(
    () => compactKnowledgeFile({ dataRoot: root, agent: "backend", file: "../../secrets.md", content: "x", backupCount: 1 }),
    /not a knowledge file/,
  );
});

test("archived knowledge stays outside the retrieval paths", () => {
  const root = dataRootFor();
  const outcome = compactKnowledgeFile({ dataRoot: root, agent: "designer", file: "design-language.md", content: "new", backupCount: 1 });
  const knowledgeFiles = readdirSync(knowledgeDir(root, "designer"));
  assert.ok(!knowledgeFiles.some((entry) => entry.includes(".bak")), `no backups inside the knowledge dir: ${knowledgeFiles}`);
  assert.ok(outcome.archive.includes(`${join("archive", "Designer")}`));
});

test("archived history material stays searchable through the catalogue after maintenance", async () => {
  const root = dataRootFor();
  const path = join(knowledgeDir(root, "backend"), "knowledge.md");
  writeFileEnsured(path, ["# Knowledge", "", "## Old heading", "- UNIQUE_HISTORY_SENTINEL: archived material must stay findable", "", "## Old heading", "- UNIQUE_HISTORY_SENTINEL: archived material must stay findable", ""].join("\n"));
  const maintained = await maintainKnowledgeFile({ dataRoot: root, agent: "backend", file: "knowledge.md", backupCount: 1, now: new Date("2026-02-01T00:00:00.000Z") });
  assert.equal(maintained.status, "maintained", "the old section is removed and archived");
  const result = refreshCatalogue([root]);
  const search = searchCatalogue({ catalogue: result.catalogue, access: { dataRoots: [root], cwd: root }, notes: [], query: "UNIQUE_HISTORY_SENTINEL" });
  assert.ok(search.matched > 0, `archived material matches a search: matched ${search.matched}`);
  assert.match(search.text, /history\/knowledge\.md/, "the hit names the history file it lives in");
});
