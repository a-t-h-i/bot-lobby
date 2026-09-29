import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  capScratchpad,
  cleanupTaskDir,
  createTaskDir,
  ensureProjectStructure,
  loadTask,
  listTasks,
  peekOwnedTask,
  peekTasks,
  taskHealth,
  ownedTask,
  ownerlessTask,
  claimTask,
  nextTaskId,
  saveTask,
  taskSlug,
  taskDirFor,
  readTaskArtifact,
  taskReadDirs,
} from "../src/state/persistence.ts";
import { knowledgeDir, KNOWLEDGE_FILES, AGENT_DIR_NAMES, scratchpadPath } from "../src/knowledge/paths.ts";
import { dataRoot, legacyDataRoot } from "../src/state/project.ts";
import { createTask } from "../src/schemas/task.ts";
import { loadScoutResults } from "../src/master/master.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";

function project(): string {
  return mkdtempSync(join(tmpdir(), "dh-persist-"));
}

test("ensureProjectStructure creates all knowledge dirs and seed files", () => {
  const root = project();
  ensureProjectStructure(root, ".pi");
  const dr = dataRoot(root, ".pi");
  for (const agent of Object.keys(AGENT_DIR_NAMES) as Array<keyof typeof AGENT_DIR_NAMES>) {
    for (const file of KNOWLEDGE_FILES[agent]) {
      const path = join(knowledgeDir(dr, agent), file);
      assert.ok(existsSync(path), `${path} should exist`);
      assert.ok(readFileSync(path, "utf8").length > 0, `${path} should have seed content`);
    }
  }
  assert.ok(existsSync(join(dr, "tasks")));
});

test("ensureProjectStructure does not overwrite existing knowledge", () => {
  const root = project();
  ensureProjectStructure(root, ".pi");
  const knowledge = join(knowledgeDir(dataRoot(root, ".pi"), "backend"), "knowledge.md");
  writeFileSync(knowledge, "hand written\n");
  ensureProjectStructure(root, ".pi");
  assert.equal(readFileSync(knowledge, "utf8"), "hand written\n");
});

test("createTaskDir creates state, proposal, plan, and scratchpads", () => {
  const root = project();
  const task = createTask("TASK-001", "Add feature X");
  createTaskDir(root, ".pi", task);
  const dir = taskDirFor(root, ".pi", "TASK-001");
  assert.ok(existsSync(join(dir, "state.json")));
  assert.ok(existsSync(join(dir, "proposal.md")));
  assert.ok(existsSync(join(dir, "plan.md")));
  for (const domain of ["designer", "backend", "qa"] as const) {
    assert.ok(existsSync(scratchpadPath(dir, domain)));
  }
});

test("ownedTask and ownerlessTask split tasks by session owner", () => {
  const root = project();
  const owned = createTask("TASK-owned", "Owned");
  owned.ownerSessionId = "session-a";
  createTaskDir(root, ".pi", owned);
  createTaskDir(root, ".pi", createTask("TASK-free", "Free"));
  assert.equal(ownedTask(root, ".pi", "session-a")?.id, "TASK-owned");
  assert.equal(ownedTask(root, ".pi", "session-b"), undefined);
  assert.equal(ownerlessTask(root, ".pi")?.id, "TASK-free");
  assert.equal(claimTask(root, ".pi", "TASK-free", "session-b")?.ownerSessionId, "session-b");
  assert.equal(ownedTask(root, ".pi", "session-b")?.id, "TASK-free");
});

test("saveTask and loadTask round-trip through state.json", () => {
  const root = project();
  const task = createTask("TASK-002", "Round trip");
  createTaskDir(root, ".pi", task);
  task.state = "implementing";
  saveTask(root, ".pi", task);
  const loaded = loadTask(root, ".pi", "TASK-002");
  assert.equal(loaded?.id, "TASK-002");
  assert.equal(loaded?.state, "implementing");
});

test("loadTask returns undefined for missing or corrupted state", () => {
  const root = project();
  assert.equal(loadTask(root, ".pi", "TASK-404"), undefined);
  const task = createTask("TASK-003", "Corrupt");
  createTaskDir(root, ".pi", task);
  writeFileSync(join(taskDirFor(root, ".pi", "TASK-003"), "state.json"), "{broken");
  assert.equal(loadTask(root, ".pi", "TASK-003"), undefined);
});

test("capScratchpad enforces paragraph and character limits", () => {
  const cfg = { ...DEFAULT_CONFIG.knowledge, scratchpadMaxParagraphs: 2, scratchpadMaxChars: 20 };
  assert.equal(capScratchpad("a\n\nb\n\nc", cfg), "a\n\nb");
  assert.match(capScratchpad("x".repeat(50), cfg), /\[truncated\]$/);
});

test("cleanupTaskDir removes the temporary task directory", () => {
  const root = project();
  const task = createTask("TASK-004", "Cleanup");
  createTaskDir(root, ".pi", task);
  const dir = taskDirFor(root, ".pi", "TASK-004");
  assert.ok(existsSync(dir));
  cleanupTaskDir(root, ".pi", "TASK-004");
  assert.ok(!existsSync(dir));
});

test("taskSlug turns a request into a bounded dash slug", () => {
  assert.equal(taskSlug("Add pagination to the task list!"), "add-pagination-to-the-task-list");
  assert.equal(taskSlug("  Mixed   CASE -- and punctuation??  "), "mixed-case-and-punctuation");
  assert.equal(taskSlug("!!! ???"), "");
  assert.equal(taskSlug("a".repeat(45)), "a".repeat(40));
  assert.equal(taskSlug("x".repeat(39) + "-yyy"), "x".repeat(39));
});

test("nextTaskId names a task from its request and the day, in a friendly form", () => {
  const day = new Date(2026, 8, 27, 10, 30);
  assert.equal(nextTaskId("Change the table font", day), "Task-Change-Table-Font-27-09-2026");
  assert.equal(nextTaskId("Add pagination to the task list", day), "Task-Add-Pagination-Task-List-27-09-2026");
  assert.equal(nextTaskId("!!!", day), "Task-Untitled-27-09-2026");
  assert.equal(nextTaskId("   ", new Date(2026, 0, 5)), "Task-Untitled-05-01-2026");
});

test("a friendly-named task round-trips and an older timestamped directory still loads", () => {
  const root = project();
  const slugId = nextTaskId("Add pagination to the task list", new Date(2026, 8, 27));
  const slugTask = createTask(slugId, "Add pagination to the task list");
  createTaskDir(root, ".pi", slugTask);
  slugTask.state = "implementing";
  saveTask(root, ".pi", slugTask);
  const loadedSlug = loadTask(root, ".pi", slugId);
  assert.equal(loadedSlug?.id, "Task-Add-Pagination-Task-List-27-09-2026");
  assert.equal(loadedSlug?.state, "implementing");

  const legacyId = "TASK-20260101001000";
  const legacy = createTask(legacyId, "legacy task");
  createTaskDir(root, ".pi", legacy);
  legacy.state = "reviewing";
  saveTask(root, ".pi", legacy);
  const loadedLegacy = loadTask(root, ".pi", legacyId);
  assert.equal(loadedLegacy?.id, legacyId);
  assert.equal(loadedLegacy?.state, "reviewing");
  assert.notEqual(loadedSlug?.id, loadedLegacy?.id);
});

/** Write a task into a pre-rename tree (dev-lobby or dev-house), which merged reads still see. */
function writeLegacyTask(root: string, task: ReturnType<typeof createTask>, name: "dev-lobby" | "dev-house" = "dev-lobby"): void {
  const dir = join(legacyDataRoot(root, ".pi", name), "tasks", task.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(task, null, 2));
}

test("listTasks merges both legacy trees and lets bot-lobby win per id", () => {
  const root = project();
  const lobbyOnly = createTask("TASK-lobby-only", "Lobby only");
  lobbyOnly.state = "implementing";
  writeLegacyTask(root, lobbyOnly, "dev-lobby");
  const houseOnly = createTask("TASK-house-only", "House only");
  houseOnly.state = "reviewing";
  writeLegacyTask(root, houseOnly, "dev-house");
  createTaskDir(root, ".pi", createTask("TASK-shared", "New copy"));
  writeLegacyTask(root, createTask("TASK-shared", "Stale copy"), "dev-lobby");

  const tasks = listTasks(root, ".pi");
  assert.deepEqual(tasks.map((task) => task.id).sort(), ["TASK-house-only", "TASK-lobby-only", "TASK-shared"]);
  assert.equal(loadTask(root, ".pi", "TASK-shared")?.title, "New copy");
  assert.equal(loadTask(root, ".pi", "TASK-lobby-only")?.state, "implementing");
  assert.equal(loadTask(root, ".pi", "TASK-house-only")?.state, "reviewing");
});

test("taskHealth reports a corrupt state.json from either tree", () => {
  const root = project();
  const dir = join(legacyDataRoot(root, ".pi"), "tasks", "TASK-broken");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), "{broken");
  const health = taskHealth(root, ".pi");
  assert.deepEqual(health.tasks, []);
  assert.deepEqual(health.corrupted, ["TASK-broken"]);
});

test("loadTask does not shadow a corrupt bot-lobby state with the legacy copy", () => {
  const root = project();
  createTaskDir(root, ".pi", createTask("TASK-shadow", "Live copy"));
  writeFileSync(join(taskDirFor(root, ".pi", "TASK-shadow"), "state.json"), "{broken");
  writeLegacyTask(root, createTask("TASK-shadow", "Legacy copy"));
  assert.equal(loadTask(root, ".pi", "TASK-shadow"), undefined);
});

test("ensureProjectStructure migrates the newest legacy knowledge instead of seeding over it", () => {
  const root = project();
  const housePath = join(knowledgeDir(legacyDataRoot(root, ".pi", "dev-house"), "backend"), "knowledge.md");
  const lobbyPath = join(knowledgeDir(legacyDataRoot(root, ".pi", "dev-lobby"), "backend"), "knowledge.md");
  for (const path of [housePath, lobbyPath]) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(housePath, "# House\n\nOld facts.\n");
  writeFileSync(lobbyPath, "# Lobby\n\nPagination facts.\n");
  ensureProjectStructure(root, ".pi");
  const migrated = join(knowledgeDir(dataRoot(root, ".pi"), "backend"), "knowledge.md");
  assert.equal(readFileSync(migrated, "utf8"), "# Lobby\n\nPagination facts.\n");
});

test("per-task artifacts fall back through the legacy trees, bot-lobby winning per file", () => {
  const root = project();
  const id = "TASK-artifacts";
  const legacyDir = join(legacyDataRoot(root, ".pi", "dev-lobby"), "tasks", id);
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "backend.md"), "legacy scratchpad\n");
  writeFileSync(join(legacyDir, "scout-backend.json"), JSON.stringify({ result: { domain: "backend" } }));

  assert.equal(readTaskArtifact(root, ".pi", id, "backend.md"), "legacy scratchpad\n");
  assert.deepEqual(loadScoutResults(taskReadDirs(root, ".pi", id), ["backend"]).map((entry) => entry.result.domain), ["backend"]);

  createTaskDir(root, ".pi", createTask(id, "Artifacts"));
  writeFileSync(join(taskDirFor(root, ".pi", id), "backend.md"), "new scratchpad\n");
  assert.equal(readTaskArtifact(root, ".pi", id, "backend.md"), "new scratchpad\n", "the new tree wins per file");
});

test("peeked tasks are parsed once and read again only when their file changes", () => {
  const root = mkdtempSync(join(tmpdir(), "bl-peek-"));
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-peek", "peek", "2026-09-27T10:00:00.000Z", "x", "s-1");
  createTaskDir(root, ".pi", task);
  const path = join(taskDirFor(root, ".pi", "TASK-peek"), "state.json");
  const settle = () => utimesSync(path, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
  settle();
  const first = peekTasks(root, ".pi")[0];
  assert.equal(first?.id, "TASK-peek");
  assert.equal(peekTasks(root, ".pi")[0], first, "an unchanged file is not parsed again");
  assert.equal(peekOwnedTask(root, ".pi", "s-1"), first);

  // Another process writes it (no saveTask here), keeping the size: the stat still changes.
  writeFileSync(path, readFileSync(path, "utf8").replace('"peek"', '"PEEK"'));
  settle();
  const second = peekTasks(root, ".pi")[0];
  assert.notEqual(second, first);
  assert.equal(second?.title, "PEEK");

  // A file written a moment ago is reread every time until it settles.
  writeFileSync(path, readFileSync(path, "utf8").replace('"PEEK"', '"Peek"'));
  const fresh = peekTasks(root, ".pi")[0];
  assert.equal(fresh?.title, "Peek");
  assert.notEqual(peekTasks(root, ".pi")[0], fresh, "not kept while it may still change within the same clock tick");

  settle();
  const kept = peekTasks(root, ".pi")[0]!;
  saveTask(root, ".pi", { ...kept, title: "saved here" });
  assert.equal(peekTasks(root, ".pi")[0]?.title, "saved here", "this process's own save is seen at once");

  rmSync(taskDirFor(root, ".pi", "TASK-peek"), { recursive: true });
  assert.deepEqual(peekTasks(root, ".pi"), []);
  assert.equal(peekOwnedTask(root, ".pi", "s-1"), undefined);
});
