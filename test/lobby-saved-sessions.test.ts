import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArchivedSessions, savedName, savedSessions, writeArchivedSessions } from "../src/lobby/saved-sessions.ts";

const file = (id: string, at: number, extra: { name?: string; firstMessage?: string; messageCount?: number } = {}) => ({
  id,
  path: `/s/${id}.jsonl`,
  modified: new Date(at),
  messageCount: extra.messageCount ?? 3,
  ...(extra.name ? { name: extra.name } : {}),
  ...(extra.firstMessage ? { firstMessage: extra.firstMessage } : {}),
});

test("saved sessions stay listed newest first, except the ones shown elsewhere and empty ones", () => {
  const list = savedSessions(
    [file("a", 1000, { name: "Alpha" }), file("b", 3000, { firstMessage: "fix the login form" }), file("c", 2000), file("empty", 4000, { messageCount: 0 }), file("here", 5000)],
    new Set(["here"]),
    new Set(["c"]),
  );
  assert.deepEqual(list.map((entry) => [entry.sessionId, entry.name, entry.archived ?? false]), [
    ["b", "fix the login form", false],
    ["c", "Untitled session", true],
    ["a", "Alpha", false],
  ]);
});

test("a session listed twice keeps its newest copy, and long first messages are cut", () => {
  const list = savedSessions([file("a", 1000, { name: "old" }), file("a", 2000, { name: "new" })], new Set(), new Set());
  assert.deepEqual(list.map((entry) => [entry.name, entry.at]), [["new", 2000]]);
  const long = savedName({ firstMessage: "x".repeat(200) });
  assert.equal(long.length, 60);
  assert.ok(long.endsWith("…"));
});

test("archived session ids are remembered in a file", () => {
  const path = join(mkdtempSync(join(tmpdir(), "saved-")), "sessions", "archived.json");
  assert.deepEqual([...readArchivedSessions(path)], []);
  writeArchivedSessions(path, new Set(["b", "a"]));
  assert.deepEqual([...readArchivedSessions(path)].sort(), ["a", "b"]);
});
