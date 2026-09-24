import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capScratchpad,
  cleanupTaskDir,
  createTaskDir,
  ensureProjectStructure,
  loadTask,
  saveTask,
  taskDirFor,
} from "../src/state/persistence.ts";
import { knowledgeDir, KNOWLEDGE_FILES, AGENT_DIR_NAMES, scratchpadPath } from "../src/knowledge/paths.ts";
import { dataRoot } from "../src/state/project.ts";
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
