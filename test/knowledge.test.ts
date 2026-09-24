import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendCompletedTask,
  appendDecision,
  applyKnowledge,
  knowledgeFilePath,
  readFileOr,
  writeFileEnsured,
  readAgentKnowledge,
} from "../src/knowledge/store.ts";
import { parseKnowledgeProposals } from "../src/roles/worker.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { selectKnowledge } from "../src/knowledge/selector.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";

function dataRootFor(): string {
  const root = mkdtempSync(join(tmpdir(), "dh-k-"));
  ensureProjectStructure(root, ".pi");
  return join(root, ".pi", "dev-lobby");
}

function makeDeps(): WorkflowDeps {
  const root = mkdtempSync(join(tmpdir(), "dh-k-"));
  return {
    root,
    configDir: ".pi",
    cwd: process.cwd(),
    config: DEFAULT_CONFIG,
    ask: async () => undefined,
    choose: async () => undefined,
    notify: () => {},
  };
}

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "reviewing"];

function withTask(deps: WorkflowDeps, state: TaskState): Task {
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Add pagination");
  createTaskDir(deps.root, deps.configDir, task);
  for (const step of FLOW) {
    if (step === state) break;
    transition(task, step);
  }
  if (state !== "created") transition(task, state);
  saveTask(deps.root, deps.configDir, task);
  return task;
}

function act(deps: WorkflowDeps, params: Partial<OrchestrateParams>) {
  return runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
}

test("knowledgeFilePath maps kinds onto the documented files", () => {
  const root = dataRootFor();
  assert.match(knowledgeFilePath(root, "backend", "knowledge"), /Backend\/knowledge\/knowledge\.md$/);
  assert.match(knowledgeFilePath(root, "backend", "standard"), /Backend\/knowledge\/engineering-standards\.md$/);
  assert.match(knowledgeFilePath(root, "designer", "standard"), /Designer\/knowledge\/design-language\.md$/);
  assert.match(knowledgeFilePath(root, "master", "standard"), /Master\/knowledge\/standards\.md$/);
  assert.match(knowledgeFilePath(root, "qa", "decision"), /QA\/knowledge\/decisions\.md$/);
});

test("applyKnowledge writes once and rejects duplicates", () => {
  const root = dataRootFor();
  const first = applyKnowledge({ dataRoot: root, agent: "backend", kind: "knowledge", text: "REST endpoints live in src/api." });
  assert.equal(first.result, "added");
  assert.match(readFileOr(first.path), /REST endpoints live in src\/api/);
  const again = applyKnowledge({ dataRoot: root, agent: "backend", kind: "knowledge", text: "REST endpoints live in src/api." });
  assert.equal(again.result, "duplicate");
  const empty = applyKnowledge({ dataRoot: root, agent: "backend", kind: "knowledge", text: "   " });
  assert.equal(empty.result, "empty");
});

test("readAgentKnowledge prefers the dev-lobby file and falls back per file", () => {
  const root = mkdtempSync(join(tmpdir(), "dh-kmerge-"));
  const legacyRoot = join(root, ".pi", "dev-house");
  const newRoot = join(root, ".pi", "dev-lobby");
  writeFileEnsured(join(knowledgeDir(legacyRoot, "backend"), "knowledge.md"), "legacy facts");
  writeFileEnsured(join(knowledgeDir(legacyRoot, "backend"), "decisions.md"), "legacy decision");
  writeFileEnsured(join(knowledgeDir(newRoot, "backend"), "knowledge.md"), "new facts");

  const slices = readAgentKnowledge([newRoot, legacyRoot], "backend");
  assert.equal(slices.knowledge, "new facts");
  assert.equal(slices.decisions, "legacy decision");
  assert.equal(readAgentKnowledge([newRoot], "backend").decisions, "");
});

test("decisions and history group under a date heading", () => {
  const root = dataRootFor();
  const dir = knowledgeDir(root, "backend");
  const day1 = new Date("2026-01-01T10:00:00.000Z");
  const day2 = new Date("2026-01-02T10:00:00.000Z");
  appendDecision(dir, "first decision", day1);
  appendDecision(dir, "second decision", day1);
  appendDecision(dir, "third decision", day2);
  const decisions = readFileOr(join(dir, "decisions.md"));
  assert.equal(decisions.match(/# 2026-01-01/g)?.length, 1, "one heading per day");
  assert.match(decisions, /- first decision\n- second decision/);
  assert.match(decisions, /# 2026-01-02\n\n- third decision/);

  appendCompletedTask(dir, "TASK-1: did a thing", day1);
  assert.match(readFileOr(join(dir, "completed-tasks.md")), /- \[x\] TASK-1: did a thing/);
});

test("knowledge action records Master-approved knowledge", async () => {
  const deps = makeDeps();
  withTask(deps, "implementing");
  const result = await act(deps, { action: "knowledge", domain: "backend", kind: "knowledge", text: "Pagination belongs in src/api/users.ts." });
  assert.equal(result.ok, true, result.message);
  assert.match(result.message, /Recorded knowledge for backend/);
  assert.match(readFileOr(join(knowledgeDir(join(deps.root, ".pi", "dev-lobby"), "backend"), "knowledge.md")), /Pagination belongs/);
});

test("knowledge action reports duplicates and rejects empty text", async () => {
  const deps = makeDeps();
  withTask(deps, "implementing");
  await act(deps, { action: "knowledge", text: "The API layer is thin." });
  const duplicate = await act(deps, { action: "knowledge", text: "The API layer is thin." });
  assert.match(duplicate.message, /Already recorded/);
  const empty = await act(deps, { action: "knowledge", text: "  " });
  assert.equal(empty.ok, false);
  assert.match(empty.message, /requires text/);
});

test("agent workers have no knowledge write action of their own", async () => {
  // The orchestrate tool is master-only; workers run as isolated pi processes
  // with a read-only tool allowlist, so the engine's only writer is this action.
  const deps = makeDeps();
  withTask(deps, "implementing");
  const result = await act(deps, { action: "knowledge", domain: "backend", kind: "standard", text: "Always validate query params." });
  assert.equal(result.ok, true);
  assert.match(readFileOr(join(knowledgeDir(join(deps.root, ".pi", "dev-lobby"), "backend"), "engineering-standards.md")), /Always validate query params/);
});

test("completion flushes the task's decisions into the knowledge store", async () => {
  const deps = makeDeps();
  const task = withTask(deps, "reviewing");
  task.domains = ["backend"];
  task.plan = "plan mentions files, sequence, dependencies, testing, acceptance, rollback, review";
  task.qaVerdict = "pass";
  task.decisions.push({ domain: "backend", text: "Use the existing query builder.", createdAt: "2026-01-01T00:00:00.000Z" });
  saveTask(deps.root, deps.configDir, task);

  const result = await act(deps, { action: "complete" });
  assert.equal(result.ok, true, result.message);
  const decisions = readFileOr(join(knowledgeDir(join(deps.root, ".pi", "dev-lobby"), "backend"), "decisions.md"));
  assert.match(decisions, /TASK-1 Use the existing query builder\./);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.state, "completed");
});

test("worker knowledge proposals are parsed with their kind", () => {
  const proposals = parseKnowledgeProposals("backend", "- knowledge: API tests live in test/api\n- standard: always validate query params\n- bare proposal");
  assert.equal(proposals.length, 3);
  assert.deepEqual(proposals[0], { domain: "backend", kind: "knowledge", content: "API tests live in test/api" });
  assert.equal(proposals[1]!.kind, "standard");
  assert.equal(proposals[2]!.kind, "knowledge");
  assert.deepEqual(parseKnowledgeProposals("qa", undefined), []);
});

test("context selection keeps only task-relevant knowledge", () => {
  const root = dataRootFor();
  const path = knowledgeFilePath(root, "backend", "knowledge");
  writeFileEnsured(path, "# Knowledge\n\n## Billing\nInvoices are generated nightly.\n\n## Auth\nSessions are server-side.\n");
  const selected = selectKnowledge("auth sessions", { knowledge: readFileOr(path) }, 70);
  assert.match(selected.knowledge, /Auth/);
  assert.doesNotMatch(selected.knowledge, /Billing/);
});
