import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeKnowledge, compactKnowledgeFile, overThreshold } from "../src/knowledge/compactor.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { readFileOr, writeFileEnsured } from "../src/knowledge/store.ts";
import { ensureProjectStructure } from "../src/state/persistence.ts";

function dataRootFor(): string {
  const root = mkdtempSync(join(tmpdir(), "dh-c-"));
  ensureProjectStructure(root, ".pi");
  return join(root, ".pi", "dev-lobby");
}

test("analyzeKnowledge finds duplicate lines", () => {
  const analysis = analyzeKnowledge("## Notes\n- Sessions are server-side.\n- sessions are server-side\n");
  assert.equal(analysis.duplicates.length, 1);
});

test("analyzeKnowledge flags hedging and unresolved wording", () => {
  const analysis = analyzeKnowledge("- Sessions are maybe server-side for now\n- The billing worker is TBD\n- Auth is centralized in src/auth/session.ts\n");
  assert.equal(analysis.ambiguity.length, 2);
});

test("analyzeKnowledge reports conflicting statements about the same subject", () => {
  const analysis = analyzeKnowledge(
    "- Sessions are stored server-side in the session service\n- Sessions are stored client-side in local storage\n",
  );
  assert.equal(analysis.conflictCandidates.length, 1);
  assert.equal(analysis.conflictCandidates[0]!.statements.length, 2);
  assert.ok(analysis.conflictCandidates[0]!.subject.includes("sessions"));
});

test("analyzeKnowledge does not report unrelated lines as conflicts", () => {
  const analysis = analyzeKnowledge("- Sessions live in the session service\n- Invoices render nightly from the billing queue\n");
  assert.deepEqual(analysis.conflictCandidates, []);
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

test("compaction creates the archive directory when it does not exist yet", () => {
  const root = dataRootFor();
  const path = join(knowledgeDir(root, "master"), "standards.md");
  writeFileSync(path, "original\n");
  const outcome = compactKnowledgeFile({ dataRoot: root, agent: "master", file: "standards.md", content: "rewritten", backupCount: 1 });
  assert.ok(existsSync(outcome.archive));
  assert.equal(readFileOr(path), "rewritten\n");
});
