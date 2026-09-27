import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTask, type Task } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, listTasks, loadTask, saveTask, taskDirFor } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { archiveRoot, archiveTask, deleteTask, listArchivedTasks, restoreTask } from "../src/state/archive.ts";
import { sendToInbox } from "../src/state/inbox.ts";

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "bl-archive-"));
  ensureProjectStructure(root, ".pi");
  return root;
}

function task(root: string, id: string, states: Task["state"][]): Task {
  const made = createTask(id, id.toLowerCase(), "2026-09-27T10:00:00.000Z", "x", "owner");
  createTaskDir(root, ".pi", made);
  for (const state of states) transition(made, state, "2026-09-27T10:30:00.000Z");
  saveTask(root, ".pi", made);
  return made;
}

test("an archived task leaves every list, keeps its folder whole, and comes back as it was", () => {
  const root = project();
  task(root, "TASK-done", ["clarifying", "abandoned"]);
  task(root, "TASK-keep", ["clarifying"]);
  sendToInbox(root, ".pi", "TASK-done", "a message it kept");
  const archived = archiveTask(root, ".pi", "TASK-done", new Date("2026-09-27T12:00:00.000Z"));
  assert.equal(archived.archivedAt, "2026-09-27T12:00:00.000Z");
  assert.deepEqual(listTasks(root, ".pi").map((entry) => entry.id), ["TASK-keep"]);
  assert.equal(loadTask(root, ".pi", "TASK-done"), undefined);
  assert.ok(existsSync(join(archiveRoot(root, ".pi"), "TASK-done", "inbox.jsonl")), "the whole folder moves");
  assert.deepEqual(listArchivedTasks(root, ".pi").map((entry) => [entry.id, entry.state]), [["TASK-done", "abandoned"]]);
  assert.throws(() => archiveTask(root, ".pi", "TASK-done"), /no task TASK-done/);

  const restored = restoreTask(root, ".pi", "TASK-done");
  assert.equal(restored.archivedAt, undefined);
  assert.deepEqual(listTasks(root, ".pi").map((entry) => entry.id).sort(), ["TASK-done", "TASK-keep"]);
  assert.equal(listArchivedTasks(root, ".pi").length, 0);
  assert.equal(loadTask(root, ".pi", "TASK-done")?.archivedAt, undefined);
});

test("a task still under way is abandoned when archived, and says why", () => {
  const root = project();
  task(root, "TASK-open", ["clarifying"]);
  const archived = archiveTask(root, ".pi", "TASK-open");
  assert.equal(archived.state, "abandoned");
  assert.ok(archived.decisions.some((decision) => decision.text === "Abandoned when it was archived from the lobby."));
});

test("deleting removes a task for good, from the list or from the archive", () => {
  const root = project();
  task(root, "TASK-a", ["clarifying", "abandoned"]);
  task(root, "TASK-b", ["clarifying", "abandoned"]);
  deleteTask(root, ".pi", "TASK-a");
  assert.ok(!existsSync(taskDirFor(root, ".pi", "TASK-a")));
  archiveTask(root, ".pi", "TASK-b");
  deleteTask(root, ".pi", "TASK-b", "archive");
  assert.deepEqual([listTasks(root, ".pi").length, listArchivedTasks(root, ".pi").length], [0, 0]);
  assert.throws(() => deleteTask(root, ".pi", "TASK-a"), /no task TASK-a/);
  assert.throws(() => deleteTask(root, ".pi", "../../etc"), /not a task id/);
  assert.throws(() => restoreTask(root, ".pi", ".."), /not a task id/);
});

test("restoring refuses to overwrite a task with the same id", () => {
  const root = project();
  task(root, "TASK-x", ["clarifying", "abandoned"]);
  archiveTask(root, ".pi", "TASK-x");
  task(root, "TASK-x", ["clarifying"]);
  assert.throws(() => restoreTask(root, ".pi", "TASK-x"), /already on the list/);
  writeFileSync(join(archiveRoot(root, ".pi"), "TASK-x", "state.json"), "{");
  assert.throws(() => restoreTask(root, ".pi", "TASK-x"), /not in the archive/);
});
