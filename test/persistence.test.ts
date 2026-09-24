import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  capScratchpad,
  cleanupTaskDir,
  createTaskDir,
  ensureProjectStructure,
  loadTask,
  listTasks,
  taskHealth,
  nextTaskId,
  saveTask,
  taskSlug,
  taskDirFor,
} from "../src/state/persistence.ts";
import { knowledgeDir, KNOWLEDGE_FILES, AGENT_DIR_NAMES, scratchpadPath } from "../src/knowledge/paths.ts";
import { dataRoot, legacyDataRoot } from "../src/state/project.ts";
import { createTask } from "../src/schemas/task.ts";
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

test("nextTaskId names a task from its request and falls back to a timestamp", () => {
  assert.equal(nextTaskId("Add pagination to the task list"), "TASK-add-pagination-to-the-task-list");
  assert.equal(nextTaskId("!!!", new Date("2026-01-01T00:10:00.000Z")), "TASK-task-20260101001000");
  assert.equal(nextTaskId("   ", new Date("2026-01-01T00:10:00.000Z")), "TASK-task-20260101001000");
});

test("a slug-named task round-trips and a timestamped directory still loads", () => {
  const root = project();
  const slugId = nextTaskId("Add pagination to the task list");
  const slugTask = createTask(slugId, "Add pagination to the task list");
  createTaskDir(root, ".pi", slugTask);
  slugTask.state = "implementing";
  saveTask(root, ".pi", slugTask);
  const loadedSlug = loadTask(root, ".pi", slugId);
  assert.equal(loadedSlug?.id, "TASK-add-pagination-to-the-task-list");
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

/** Write a task into the pre-rename dev-house tree, which merged reads still see. */
function writeLegacyTask(root: string, task: ReturnType<typeof createTask>): void {
  const dir = join(legacyDataRoot(root, ".pi"), "tasks", task.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(task, null, 2));
}

test("listTasks merges the legacy dev-house tree and lets dev-lobby win per id", () => {
  const root = project();
  const legacyOnly = createTask("TASK-legacy-only", "Legacy only");
  legacyOnly.state = "implementing";
  writeLegacyTask(root, legacyOnly);
  createTaskDir(root, ".pi", createTask("TASK-shared", "New copy"));
  writeLegacyTask(root, createTask("TASK-shared", "Stale copy"));

  const tasks = listTasks(root, ".pi");
  assert.deepEqual(tasks.map((task) => task.id).sort(), ["TASK-legacy-only", "TASK-shared"]);
  assert.equal(loadTask(root, ".pi", "TASK-shared")?.title, "New copy");
  assert.equal(loadTask(root, ".pi", "TASK-legacy-only")?.state, "implementing");
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

test("loadTask does not shadow a corrupt dev-lobby state with the legacy copy", () => {
  const root = project();
  createTaskDir(root, ".pi", createTask("TASK-shadow", "Live copy"));
  writeFileSync(join(taskDirFor(root, ".pi", "TASK-shadow"), "state.json"), "{broken");
  writeLegacyTask(root, createTask("TASK-shadow", "Legacy copy"));
  assert.equal(loadTask(root, ".pi", "TASK-shadow"), undefined);
});

test("ensureProjectStructure migrates legacy knowledge instead of seeding over it", () => {
  const root = project();
  const legacyPath = join(knowledgeDir(legacyDataRoot(root, ".pi"), "backend"), "knowledge.md");
  mkdirSync(dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, "# Legacy\n\nPagination facts.\n");
  ensureProjectStructure(root, ".pi");
  const migrated = join(knowledgeDir(dataRoot(root, ".pi"), "backend"), "knowledge.md");
  assert.equal(readFileSync(migrated, "utf8"), "# Legacy\n\nPagination facts.\n");
});
