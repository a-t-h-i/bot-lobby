import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_LABELS, FILE_LABELS, KnowledgeBook } from "../src/lobby/knowledge.ts";
import { ensureProjectStructure } from "../src/state/persistence.ts";
import { dataRoot, legacyDataRoot } from "../src/state/project.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { readNotes } from "../src/knowledge/notes.ts";
import { readAgentKnowledge } from "../src/knowledge/store.ts";

function project(threshold = 20_000) {
  const root = mkdtempSync(join(tmpdir(), "bl-kb-"));
  ensureProjectStructure(root, ".pi");
  const book = new KnowledgeBook({ root, configDir: ".pi", threshold: () => threshold, backups: () => 2, sessionId: () => "session-1", now: () => new Date("2026-09-29T10:00:00Z") });
  const file = (agent: "master" | "designer" | "backend" | "qa", name: string) => join(knowledgeDir(dataRoot(root, ".pi"), agent), name);
  return { root, book, file };
}

const DECISIONS = "# Decisions\n\n## 2026-09-01\n- REST over GraphQL.\n- Postgres for sessions.\n- REST over GraphQL.\n";

test("every agent's knowledge is listed, with size, notes and whether it is past the compaction threshold", () => {
  const { book, file } = project(100);
  writeFileSync(file("backend", "decisions.md"), DECISIONS.repeat(3));
  const files = book.files();
  assert.equal(files.length, 16, "four agents, four files each");
  assert.deepEqual(files.slice(0, 4).map((info) => [info.agent, info.file, info.label]), [
    ["master", "knowledge.md", "Knowledge"], ["master", "standards.md", "Standards"], ["master", "decisions.md", "Decisions"], ["master", "completed-tasks.md", "Completed tasks"],
  ]);
  assert.deepEqual(files.filter((info) => info.agent === "designer").map((info) => info.label), ["Knowledge", "Design language", "Decisions", "Completed tasks"]);
  const decisions = files.find((info) => info.agent === "backend" && info.file === "decisions.md")!;
  assert.deepEqual([decisions.chars, decisions.over, decisions.notes], [DECISIONS.repeat(3).length, true, 0]);
  assert.equal(files.find((info) => info.agent === "qa" && info.file === "knowledge.md")!.over, false);
  assert.equal(AGENT_LABELS.master, "Master (oracle)");
  assert.equal(FILE_LABELS["engineering-standards.md"], "Engineering standards");
});

test("one file opens as entries, with the notes on them and the ones whose entry is gone apart", () => {
  const { book, file } = project();
  writeFileSync(file("backend", "decisions.md"), DECISIONS);
  assert.equal(book.comment("backend", "decisions.md", { text: "- Postgres for sessions.", occurrence: 0 }, "Outdated: Redis now."), "note saved — every agent reads it under this entry");
  const view = book.open("backend", "decisions.md");
  assert.deepEqual(view.entries.map((entry) => entry.text), ["# Decisions", "## 2026-09-01", "- REST over GraphQL.", "- Postgres for sessions.", "- REST over GraphQL."]);
  assert.deepEqual(view.attached.map((note) => [note.entry, note.text, note.by]), [["- Postgres for sessions.", "Outdated: Redis now.", "session-1"]]);
  assert.deepEqual(view.detached, []);
  writeFileSync(file("backend", "decisions.md"), "# Decisions\n- Redis for sessions.\n");
  const changed = book.open("backend", "decisions.md");
  assert.deepEqual([changed.attached.length, changed.detached.map((note) => note.text), changed.notes], [0, ["Outdated: Redis now."], 1], "the note is kept, apart");
});

test("editing an entry archives the file first, keeps the notes with the entry, and touches nothing else", () => {
  const { root, book, file } = project();
  writeFileSync(file("backend", "decisions.md"), DECISIONS);
  book.comment("backend", "decisions.md", { text: "- Postgres for sessions.", occurrence: 0 }, "Why not Redis?");
  const notice = book.edit("backend", "decisions.md", { text: "- Postgres for sessions.", occurrence: 0 }, "- Redis for sessions.\n  Postgres kept for reports.");
  assert.equal(notice, "saved backend/decisions.md — the version before is in archive/Backend; 1 note stayed with it");
  assert.equal(readFileSync(file("backend", "decisions.md"), "utf8"), "# Decisions\n\n## 2026-09-01\n- REST over GraphQL.\n- Redis for sessions.\n  Postgres kept for reports.\n- REST over GraphQL.\n");
  const archive = join(dataRoot(root, ".pi"), "archive", "Backend");
  const backups = readdirSync(archive);
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(archive, backups[0]!), "utf8"), DECISIONS, "the version before is kept whole");
  assert.equal(readNotes(dataRoot(root, ".pi"))[0]!.entry, "- Redis for sessions.\n  Postgres kept for reports.");
  assert.equal(book.open("backend", "decisions.md").attached.length, 1, "the note is still on its entry");
  // What agents read now has the note under the edited entry.
  assert.match(readAgentKnowledge([dataRoot(root, ".pi")], "backend").decisions, /Postgres kept for reports\.\n> Note from the user: Why not Redis\?/);
});

test("of two identical entries only the picked one changes", () => {
  const { book, file } = project();
  writeFileSync(file("backend", "decisions.md"), DECISIONS);
  book.edit("backend", "decisions.md", { text: "- REST over GraphQL.", occurrence: 1 }, "- REST, with cursors.");
  assert.equal(readFileSync(file("backend", "decisions.md"), "utf8"), "# Decisions\n\n## 2026-09-01\n- REST over GraphQL.\n- Postgres for sessions.\n- REST, with cursors.\n");
});

test("an edit for an entry the file no longer has is refused, and writes nothing", () => {
  const { root, book, file } = project();
  writeFileSync(file("backend", "decisions.md"), "# Decisions\n- New.\n");
  const stale = { text: "- Old.", occurrence: 0 };
  const changed = "that entry changed on disk since it was drawn — r reloads the file";
  assert.equal(book.edit("backend", "decisions.md", stale, "- x"), changed);
  assert.equal(book.remove("backend", "decisions.md", stale), changed);
  assert.equal(book.add("backend", "decisions.md", stale, "x"), changed);
  assert.equal(book.comment("backend", "decisions.md", stale, "x"), changed);
  assert.equal(readFileSync(file("backend", "decisions.md"), "utf8"), "# Decisions\n- New.\n");
  assert.equal(existsSync(join(dataRoot(root, ".pi"), "archive", "Backend")), false, "no archive: nothing was written");
});

test("deleting an entry takes its notes with it; adding puts a bullet after the picked entry; blank or unchanged text does nothing", () => {
  const { book, file } = project();
  writeFileSync(file("backend", "decisions.md"), DECISIONS);
  book.comment("backend", "decisions.md", { text: "- Postgres for sessions.", occurrence: 0 }, "a");
  book.comment("backend", "decisions.md", { text: "- Postgres for sessions.", occurrence: 0 }, "b");
  assert.equal(book.remove("backend", "decisions.md", { text: "- Postgres for sessions.", occurrence: 0 }), "saved backend/decisions.md — the version before is in archive/Backend; its 2 notes went with it");
  assert.doesNotMatch(readFileSync(file("backend", "decisions.md"), "utf8"), /Postgres/);
  assert.equal(book.open("backend", "decisions.md").notes, 0);
  assert.match(book.add("backend", "decisions.md", { text: "## 2026-09-01", occurrence: 0 }, "Use ULIDs for ids."), /^saved backend\/decisions\.md/);
  assert.match(readFileSync(file("backend", "decisions.md"), "utf8"), /## 2026-09-01\n- Use ULIDs for ids\.\n- REST over GraphQL\./);
  assert.equal(book.add("backend", "decisions.md", undefined, "   "), "nothing to add");
  assert.equal(book.edit("backend", "decisions.md", { text: "- REST over GraphQL.", occurrence: 0 }, "- REST over GraphQL."), "nothing changed");
  assert.match(book.edit("backend", "decisions.md", { text: "- REST over GraphQL.", occurrence: 0 }, "  "), /nothing to save — d d deletes an entry, esc cancels/);
  assert.equal(book.add("qa", "knowledge.md", undefined, "Tests live in test/."), "saved qa/knowledge.md — the version before is in archive/QA");
  assert.match(readFileSync(file("qa", "knowledge.md"), "utf8"), /Stable facts and useful patterns for this project\.\n\n- Tests live in test\/\./);
});

test("a whole file is replaced from pi's editor; an unchanged one is left alone; a note can be taken back", () => {
  const { book, file } = project();
  writeFileSync(file("master", "knowledge.md"), "# Knowledge\n- a\n");
  assert.equal(book.replaceFile("master", "knowledge.md", "# Knowledge\n- a\n\n"), "nothing changed");
  assert.equal(book.replaceFile("master", "knowledge.md", "# Knowledge\n- a\n- b\n"), "saved master/knowledge.md — the version before is in archive/Master");
  assert.equal(readFileSync(file("master", "knowledge.md"), "utf8"), "# Knowledge\n- a\n- b\n");
  book.comment("master", "knowledge.md", { text: "- a", occurrence: 0 }, "hmm");
  const [note] = book.open("master", "knowledge.md").attached;
  assert.equal(book.unnote(note!.id), "note removed");
  assert.equal(book.open("master", "knowledge.md").notes, 0);
  assert.match(book.comment("master", "knowledge.md", { text: "- a", occurrence: 0 }, "   "), /needs some words/);
});

test("knowledge that only exists in an older tree is read from there, and the first edit writes it to the new one", () => {
  const { root, book } = project();
  const legacy = join(knowledgeDir(legacyDataRoot(root, ".pi", "dev-lobby"), "backend"));
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "decisions.md"), "# Decisions\n- Old tree.\n");
  const current = join(knowledgeDir(dataRoot(root, ".pi"), "backend"), "decisions.md");
  // ensureProjectStructure seeds the new tree; remove its copy so the older tree's is the one read.
  rmSync(current);
  assert.deepEqual(book.open("backend", "decisions.md").entries.map((entry) => entry.text), ["# Decisions", "- Old tree."]);
  book.add("backend", "decisions.md", { text: "- Old tree.", occurrence: 0 }, "New line.");
  assert.equal(readFileSync(current, "utf8"), "# Decisions\n- Old tree.\n- New line.\n");
});
