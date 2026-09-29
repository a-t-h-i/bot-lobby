import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bulletOf, findEntry, insertAfter, parseEntries, removeEntry, replaceEntry } from "../src/knowledge/edit.ts";
import { addNote, annotate, moveNotes, notesPath, readNotes, removeNote, removeNotesOn } from "../src/knowledge/notes.ts";
import { readAgentKnowledge } from "../src/knowledge/store.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { selectKnowledge } from "../src/knowledge/selector.ts";

const FILE = [
  "# Knowledge",
  "",
  "Stable facts about the project.",
  "It has two lines.",
  "",
  "## Storage",
  "- Sessions live in Postgres.",
  "  Rows expire after a day.",
  "  - nested detail",
  "- Uploads go to S3.",
  "",
  "## Style",
  "1. Tabs, not spaces.",
  "2. Small functions.",
].join("\n");

test("a knowledge file reads as entries: headings, bullets with what hangs under them, and paragraphs", () => {
  const entries = parseEntries(FILE);
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.text]), [
    ["heading", "# Knowledge"],
    ["text", "Stable facts about the project.\nIt has two lines."],
    ["heading", "## Storage"],
    ["bullet", "- Sessions live in Postgres.\n  Rows expire after a day.\n  - nested detail"],
    ["bullet", "- Uploads go to S3."],
    ["heading", "## Style"],
    ["bullet", "1. Tabs, not spaces."],
    ["bullet", "2. Small functions."],
  ]);
  assert.deepEqual(entries.map((entry) => [entry.start, entry.end]), [[0, 1], [2, 4], [5, 6], [6, 9], [9, 10], [11, 12], [12, 13], [13, 14]]);
  assert.deepEqual(parseEntries(""), []);
  assert.deepEqual(parseEntries("\n\n  \n"), []);
  assert.deepEqual(parseEntries("a\r\nb").map((entry) => entry.text), ["a\nb"], "Windows line ends read the same");
});

test("identical entries are told apart by which of them they are", () => {
  const twice = parseEntries("- same\n- other\n- same");
  assert.deepEqual(twice.map((entry) => entry.occurrence), [0, 0, 1]);
  assert.equal(findEntry("- same\n- other\n- same", "- same", 1)?.start, 2);
  assert.equal(findEntry("- same", "- gone"), undefined, "an entry the file no longer has is not found");
  assert.equal(findEntry("- same", "- same", 1), undefined);
});

test("replacing an entry rewrites just its lines, however many the new text has", () => {
  const sessions = findEntry(FILE, "- Uploads go to S3.")!;
  const edited = replaceEntry(FILE, sessions, "- Uploads go to GCS.\n  Behind a signed URL.");
  assert.match(edited, /  - nested detail\n- Uploads go to GCS\.\n {2}Behind a signed URL\.\n\n## Style/);
  assert.equal(parseEntries(edited).length, parseEntries(FILE).length, "still one entry there");
  assert.equal(replaceEntry("- a\n- b\n", findEntry("- a\n- b\n", "- b")!, "- c"), "- a\n- c\n");
  assert.equal(replaceEntry(FILE, sessions, "- Uploads go to S3.\n\n\n"), FILE.concat("\n"), "trailing blank lines in the new text are dropped");
});

test("replacing an entry with nothing deletes it and leaves no double gap", () => {
  const style = findEntry(FILE, "## Style")!;
  const without = replaceEntry(FILE, style, "  ");
  assert.doesNotMatch(without, /## Style/);
  assert.doesNotMatch(without, /\n\n\n/);
  assert.match(without, /- Uploads go to S3\.\n\n1\. Tabs, not spaces\./, "the blank line that separated the sections stays");
});

test("deleting an entry closes the gap, at the start, in the middle and at the end", () => {
  assert.equal(removeEntry("- a\n- b\n- c\n", findEntry("- a\n- b\n- c\n", "- b")!), "- a\n- c\n");
  assert.equal(removeEntry("# T\n\n- a\n\n- b\n", findEntry("# T\n\n- a\n\n- b\n", "- a")!), "# T\n\n- b\n");
  assert.equal(removeEntry("- a\n\n- b\n", findEntry("- a\n\n- b\n", "- b")!), "- a\n", "the blank line before the last one goes too");
  assert.equal(removeEntry("# T\n\n- a\n", findEntry("# T\n\n- a\n", "# T")!), "- a\n", "no blank line is left at the top");
  assert.equal(removeEntry("- only\n", findEntry("- only\n", "- only")!), "", "an emptied file is empty");
});

test("a new entry is a bullet after the picked one, or at the end, after a paragraph with a blank line between", () => {
  const storage = findEntry(FILE, "- Uploads go to S3.")!;
  assert.match(insertAfter(FILE, storage, "Logs go to Loki."), /- Uploads go to S3\.\n- Logs go to Loki\.\n\n## Style/);
  assert.match(insertAfter(FILE, findEntry(FILE, "## Storage")!, "Everything is encrypted."), /## Storage\n- Everything is encrypted\.\n- Sessions live/);
  assert.match(insertAfter(FILE, findEntry(FILE, "Stable facts about the project.\nIt has two lines.")!, "Owned by the platform team."), /It has two lines\.\n\n- Owned by the platform team\.\n\n## Storage/);
  assert.equal(insertAfter("- a\n", undefined, "b"), "- a\n- b\n");
  assert.equal(insertAfter("Some prose.", undefined, "b"), "Some prose.\n\n- b\n");
  assert.equal(insertAfter("", undefined, "first"), "- first\n");
  assert.equal(insertAfter("- a\n", undefined, "   "), "- a\n", "nothing to add");
  assert.equal(bulletOf("one\ntwo\n\nthree"), "- one\n  two\n\n  three", "later lines hang under the bullet");
  assert.equal(bulletOf("   "), "", "no words, no bullet");
  assert.equal(bulletOf("- already\n  a bullet"), "- already\n  a bullet");
  assert.equal(bulletOf("## a heading"), "## a heading");
});

/* ------------------------------------------------------------------ notes */

function dataRoot(): string {
  return mkdtempSync(join(tmpdir(), "bl-notes-"));
}

test("a note is kept on an entry, moves with it when it is edited, and goes with it when it is deleted", () => {
  const root = dataRoot();
  const first = addNote(root, { agent: "backend", file: "knowledge.md", entry: "- Sessions live in Postgres.", text: "Outdated: it is Redis now.", by: "session-1" }, new Date("2026-09-29T10:00:00Z"));
  addNote(root, { agent: "backend", file: "decisions.md", entry: "- REST", text: "Why?" });
  assert.deepEqual(readNotes(root).map((note) => [note.agent, note.file, note.entry, note.text]), [
    ["backend", "knowledge.md", "- Sessions live in Postgres.", "Outdated: it is Redis now."],
    ["backend", "decisions.md", "- REST", "Why?"],
  ]);
  assert.deepEqual([first.by, first.createdAt], ["session-1", "2026-09-29T10:00:00.000Z"]);
  assert.equal(moveNotes(root, "backend", "knowledge.md", "- Sessions live in Postgres.", "- Sessions live in Redis."), 1);
  assert.equal(readNotes(root)[0]!.entry, "- Sessions live in Redis.");
  assert.equal(moveNotes(root, "backend", "knowledge.md", "- x", "- x"), 0, "an unchanged entry moves nothing");
  assert.equal(removeNotesOn(root, "backend", "knowledge.md", "- Sessions live in Redis."), 1);
  assert.deepEqual(readNotes(root).map((note) => note.text), ["Why?"]);
  removeNote(root, readNotes(root)[0]!.id);
  assert.deepEqual(readNotes(root), []);
  assert.throws(() => addNote(root, { agent: "qa", file: "knowledge.md", entry: "- x", text: "  " }), /needs some words/);
  assert.throws(() => addNote(root, { agent: "qa", file: "knowledge.md", entry: " ", text: "x" }), /needs an entry/);
});

test("a torn or foreign line in the notes log is skipped, never fatal", () => {
  const root = dataRoot();
  addNote(root, { agent: "qa", file: "knowledge.md", entry: "- a", text: "kept" });
  appendFileSync(notesPath(root), '{"kind":"note","id":"x","agent":"qa","file":"knowledge.md","entry":"- b","te\n[1,2]\nnot json\n{"kind":"mystery","id":"y"}\n');
  assert.deepEqual(readNotes(root).map((note) => note.text), ["kept"]);
  assert.deepEqual(readNotes(undefined), []);
  assert.deepEqual(readNotes(join(root, "missing")), []);
});

test("notes sit right under their entries in what an agent reads; one whose entry changed is kept at the end", () => {
  const note = (entry: string, text: string) => ({ id: text, agent: "backend" as const, file: "knowledge.md", entry, text, createdAt: "" });
  const read = annotate(FILE, [note("- Uploads go to S3.", "Check the region."), note("- Sessions live in Postgres.\n  Rows expire after a day.\n  - nested detail", "Outdated:\nit is Redis."), note("- Gone entry that used to say a lot of things", "Was this ever true?")]);
  assert.match(read, /- Sessions live in Postgres\.\n {2}Rows expire after a day\.\n {2}- nested detail\n> Note from the user: Outdated:\n> it is Redis\.\n- Uploads go to S3\.\n> Note from the user: Check the region\.\n\n## Style/);
  assert.match(read, /\n\n> Note from the user about "- Gone entry that used to say a lot of things": Was this ever true\?$/);
  assert.equal(annotate(FILE, []), FILE, "no notes, no change");
  const copied = annotate(FILE, [note("- Uploads go to S3.", "Check the region.")]);
  assert.equal(annotate(copied, [note("- Uploads go to S3.", "Check the region.")]), copied.replace(/\n+$/, ""), "a note an agent already copied in is not added twice");
});

test("agents read the notes with their knowledge, and the budgeted slice keeps a note with its entry", () => {
  const root = dataRoot();
  const dir = knowledgeDir(root, "backend");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "knowledge.md"), FILE);
  writeFileSync(join(dir, "decisions.md"), "# Decisions\n\n- REST over GraphQL.\n");
  addNote(root, { agent: "backend", file: "knowledge.md", entry: "- Uploads go to S3.", text: "Check the region." });
  addNote(root, { agent: "backend", file: "decisions.md", entry: "- REST over GraphQL.", text: "Revisit for the mobile app." });
  addNote(root, { agent: "qa", file: "knowledge.md", entry: "- Uploads go to S3.", text: "Not for backend." });
  const slices = readAgentKnowledge([root], "backend");
  assert.match(slices.knowledge, /- Uploads go to S3\.\n> Note from the user: Check the region\./);
  assert.match(slices.decisions, /- REST over GraphQL\.\n> Note from the user: Revisit for the mobile app\./);
  assert.doesNotMatch(slices.knowledge, /Not for backend/, "another agent's note is not read here");
  // Only the sections a task needs are kept when a file is long; the note stays inside its section.
  const selected = selectKnowledge("uploads S3 storage", { knowledge: slices.knowledge + "\n\n## Elsewhere\n" + "- filler line\n".repeat(300) }, 900);
  assert.match(selected.knowledge, /Uploads go to S3\.\n> Note from the user: Check the region\./);
  assert.doesNotMatch(selected.knowledge, /filler line/);
  // Without notes nothing changes.
  assert.equal(readAgentKnowledge([root], "designer").knowledge, readAgentKnowledge([root], "designer").knowledge);
  assert.equal(readAgentKnowledge([], "backend").knowledge, "");
});
