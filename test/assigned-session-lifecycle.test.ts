import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { assignedSessionFile, cleanupTaskAssignedSessions, openAssignedSession } from "../src/execution/assigned-session.ts";
import { retryTerminalAssignedSessionCleanup, claimStoppedWindows } from "../src/state/recovery.ts";
import { archiveRoot, archiveTask, restoreTask } from "../src/state/archive.ts";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, saveTask, taskDirFor } from "../src/state/persistence.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "assigned-lifecycle-"));
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-session", "session", new Date().toISOString(), "request", "owner");
  createTaskDir(root, ".pi", task);
  const taskDir = taskDirFor(root, ".pi", task.id);
  const assignment = { taskDir, assignmentId: "backend/one", revision: 1 };
  return { root, task, assignment, remove: () => rmSync(root, { recursive: true, force: true }) };
}

test("terminal recovery retries a busy cleanup and retains outcomes/accounting metadata", () => {
  const { root, task, assignment, remove } = fixture();
  try {
    const session = openAssignedSession({ ...assignment, consumedDiscovery: 2, completedWork: ["done"], needs: [{ kind: "decision" }] }, root);
    task.state = "completed";
    saveTask(root, ".pi", task);
    const before = readFileSync(session.file, "utf8");
    const issues = retryTerminalAssignedSessionCleanup(root, ".pi");
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.error, /locked/);
    assert.equal(readFileSync(session.file, "utf8"), before);
    assert.ok(existsSync(join(assignment.taskDir, "assigned-session-cleanup-issue.json")));
    session.release();
    writeFileSync(session.file, "malformed body must still be removed on terminal cleanup");
    writeFileSync(`${session.file}.rewrite`, "interrupted rewrite");
    claimStoppedWindows(root, ".pi");
    assert.deepEqual(retryTerminalAssignedSessionCleanup(root, ".pi"), []);
    assert.ok(!existsSync(session.file));
    assert.ok(!existsSync(`${session.file}.rewrite`));
    assert.ok(!existsSync(join(assignment.taskDir, "assigned-session-cleanup-issue.json")));
    const state = JSON.parse(readFileSync(join(dirname(session.file), "state.json"), "utf8"));
    assert.equal(state.terminal, true);
    assert.equal(state.consumedDiscovery, 2);
    assert.deepEqual(state.completedWork, ["done"]);
    assert.deepEqual(state.needs, [{ kind: "decision" }]);
  } finally { remove(); }
});

test("recoverable stops leave conversation and metadata intact", () => {
  const { root, task, assignment, remove } = fixture();
  try {
    task.state = "implementing";
    saveTask(root, ".pi", task);
    const session = openAssignedSession(assignment, root);
    session.release();
    const before = readFileSync(session.file, "utf8");
    assert.deepEqual(retryTerminalAssignedSessionCleanup(root, ".pi"), []);
    assert.equal(readFileSync(session.file, "utf8"), before);
    const resumed = openAssignedSession({ ...assignment, revision: 2 }, root);
    assert.equal(resumed.file, session.file);
    assert.equal(resumed.state.terminal, undefined);
    resumed.release();
  } finally { remove(); }
});

test("missing/corrupt lock owner and interrupted reclamation guard fail closed", () => {
  const { root, assignment, remove } = fixture();
  try {
    const session = openAssignedSession(assignment, root);
    session.release();
    const dir = dirname(session.file);
    const lock = join(dir, "lock");
    const before = readFileSync(session.file, "utf8");
    mkdirSync(lock);
    for (const owner of [undefined, "{", JSON.stringify({ pid: process.pid, token: "live", host: hostname() }), JSON.stringify({ pid: 2147483646, token: "foreign", host: `${hostname()}-other` })]) {
      if (owner !== undefined) writeFileSync(join(lock, "owner.json"), owner);
      assert.throws(() => openAssignedSession(assignment, root), /locked/);
      assert.ok(existsSync(lock));
      assert.equal(readFileSync(session.file, "utf8"), before);
    }
    mkdirSync(`${lock}.guard`);
    assert.throws(() => openAssignedSession(assignment, root), /recovery is busy or interrupted/);
    assert.ok(existsSync(lock));
  } finally { remove(); }
});

test("missing metadata and orphaned directories are never silently recreated", () => {
  const { root, assignment, remove } = fixture();
  try {
    const file = assignedSessionFile(assignment);
    mkdirSync(dirname(file), { recursive: true });
    assert.throws(() => openAssignedSession(assignment, root), /missing or corrupt state/);
    assert.ok(!existsSync(file));
    assert.throws(() => cleanupTaskAssignedSessions(assignment.taskDir), /missing or corrupt state/);
    assert.ok(!existsSync(join(dirname(file), "state.json")));
  } finally { remove(); }
});

test("corrupt and unsupported metadata is reported without terminal history deletion", () => {
  const { root, task, assignment, remove } = fixture();
  try {
    const session = openAssignedSession(assignment, root);
    session.release();
    task.state = "abandoned";
    saveTask(root, ".pi", task);
    const metadata = join(dirname(session.file), "state.json");
    const before = readFileSync(session.file, "utf8");
    const valid = JSON.parse(readFileSync(metadata, "utf8"));
    for (const source of ["{", JSON.stringify({ ...valid, version: 2 })]) {
      writeFileSync(metadata, source);
      assert.equal(retryTerminalAssignedSessionCleanup(root, ".pi").length, 1);
      assert.equal(readFileSync(metadata, "utf8"), source);
      assert.equal(readFileSync(session.file, "utf8"), before);
    }
  } finally { remove(); }
});

test("archival abandons and clears bodies but keeps tombstones through restore", () => {
  const { root, task, assignment, remove } = fixture();
  try {
    task.state = "clarifying";
    saveTask(root, ".pi", task);
    const session = openAssignedSession(assignment, root);
    assert.throws(() => archiveTask(root, ".pi", task.id), /locked/);
    assert.ok(existsSync(session.file), "live owner is never deleted");
    session.release();
    archiveTask(root, ".pi", task.id);
    const archived = join(archiveRoot(root, ".pi"), task.id);
    const archivedAssignment = { ...assignment, taskDir: archived };
    const archivedFile = assignedSessionFile(archivedAssignment);
    assert.ok(!existsSync(archivedFile));
    assert.equal(JSON.parse(readFileSync(join(dirname(archivedFile), "state.json"), "utf8")).terminal, true);
    assert.deepEqual(retryTerminalAssignedSessionCleanup(root, ".pi"), []);
    restoreTask(root, ".pi", task.id);
    assert.throws(() => openAssignedSession(assignment, root), /terminal/);
  } finally { remove(); }
});
