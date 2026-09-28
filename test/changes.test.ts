import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendChange, EditLog, editedFile, explainChanges, ledgerPath, MAX_LEDGER_BYTES, provenanceLines, provenanceSummary, readChanges, type ChangeRecord } from "../src/state/changes.ts";
import { changedFiles } from "../src/execution/git.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { PiStreamEvent, ProcessRunner } from "../src/execution/pi-runner.ts";

function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "bl-changes-")));
}

function gitRepo(): string {
  const dir = tempDir();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "src"));
  for (const name of ["src/a.ts", "src/q.ts", "src/pre.ts", "src/old name.ts"]) writeFileSync(join(dir, name), "export {};\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return dir;
}

function record(overrides: Partial<ChangeRecord>): ChangeRecord {
  return { source: "quickfix", id: "QF-1", what: "fix the typo", files: [], startedAt: "2026-09-28T10:00:00.000Z", finishedAt: "2026-09-28T10:01:00.000Z", status: "success", ...overrides };
}

test("only edit and write calls count as edits, each file once, wherever the path points", () => {
  assert.equal(editedFile("read", { path: "src/a.ts" }, "/p"), undefined);
  assert.equal(editedFile("bash", { command: "sed -i s/a/b/ x" }, "/p"), undefined);
  assert.equal(editedFile("edit", {}, "/p"), undefined);
  assert.equal(editedFile("edit", { path: "src/a.ts" }, "/p"), "/p/src/a.ts");
  assert.equal(editedFile("Write", { file_path: "@lib/b.ts" }, "/p"), "/p/lib/b.ts");
  assert.equal(editedFile("write", { path: "/elsewhere/c.ts" }, "/p"), "/elsewhere/c.ts");
  const dir = tempDir();
  const edits = new EditLog(dir);
  assert.equal(edits.note("edit", { path: "src/a.ts" }), true);
  assert.equal(edits.note("edit", { path: "./src/a.ts" }), false, "the same file again");
  assert.equal(edits.note("read", { path: "src/b.ts" }), false);
  edits.note("write", { path: "/outside/x.ts" });
  assert.deepEqual(edits.list(), [join(dir, "src/a.ts"), "/outside/x.ts"]);
  assert.deepEqual(edits.shown(), ["src/a.ts", "/outside/x.ts"], "shown relative to the project when inside it");
});

test("the ledger keeps records across sessions, skips torn lines, reads from a time, and keeps its newer half when full", () => {
  const root = tempDir();
  appendChange(root, ".pi", record({ files: [] }));
  assert.deepEqual(readChanges(root, ".pi"), [], "a run that edited nothing leaves no record");
  appendChange(root, ".pi", record({ id: "QF-1", files: ["/p/a.ts"], finishedAt: "2026-09-28T09:00:00.000Z" }));
  appendFileSync(ledgerPath(root, ".pi"), '{"source":"quickfix","id":"QF-');
  appendFileSync(ledgerPath(root, ".pi"), "\n");
  appendChange(root, ".pi", record({ id: "QF-2", files: ["/p/b.ts"] }));
  assert.deepEqual(readChanges(root, ".pi").map((entry) => entry.id), ["QF-1", "QF-2"]);
  assert.deepEqual(readChanges(root, ".pi", "2026-09-28T09:30:00.000Z").map((entry) => entry.id), ["QF-2"]);
  const big = "x".repeat(2000);
  for (let index = 0; index < 400; index += 1) appendChange(root, ".pi", record({ id: `QF-${index + 3}`, what: big, files: ["/p/c.ts"] }));
  assert.ok(statSync(ledgerPath(root, ".pi")).size <= MAX_LEDGER_BYTES);
  const kept = readChanges(root, ".pi");
  assert.equal(kept.at(-1)?.id, "QF-402", "the newest record survives trimming");
  assert.ok(!kept.some((entry) => entry.id === "QF-1"), "the oldest ones go");
});

test("each changed file is explained: planned, quick fix, another task, pre-existing, or unattributed", () => {
  const top = "/repo";
  const records = [
    record({ source: "worker", id: "run-1", taskId: "TASK-1", domain: "backend", what: "Add the login endpoint\nwith tests", files: ["/repo/src/api.ts", "/repo/src/shared.ts"] }),
    record({ id: "QF-2", what: "fix the header typo", files: ["/repo/src/header.tsx", "/repo/src/shared.ts"] }),
    record({ source: "worker", id: "run-9", taskId: "TASK-2", domain: "designer", what: "restyle the footer", files: ["/repo/src/footer.css"] }),
    record({ id: "QF-3", files: ["/elsewhere/x.ts"] }),
  ];
  const files = explainChanges({ id: "TASK-1", baseline: { at: "t", files: ["README.md", "src/api.ts"] } }, ["src/api.ts", "src/shared.ts", "src/header.tsx", "src/footer.css", "README.md", "src/stray.ts"], top, records);
  const kinds = Object.fromEntries(files.map((file) => [file.path, file.kinds]));
  assert.deepEqual(kinds, {
    "src/api.ts": ["planned", "pre-existing"],
    "src/shared.ts": ["planned", "quickfix"],
    "src/header.tsx": ["quickfix"],
    "src/footer.css": ["other-task"],
    "README.md": ["pre-existing"],
    "src/stray.ts": ["unattributed"],
  });
  const header = files.find((file) => file.path === "src/header.tsx")!;
  assert.match(header.notes[0]!, /^quick fix QF-2 at \d\d:\d\d, asked by the user: "fix the header typo"$/);
  assert.match(files[0]!.notes[0]!, /^planned: DEV — Add the login endpoint with tests$/);
  assert.equal(provenanceSummary(files), "2 planned · 2 by quick fix (QF-2) · 1 by another task · 2 pre-existing · 1 unattributed (src/stray.ts)");
  const lines = provenanceLines(files).split("\n");
  assert.match(lines[0]!, /^- src\/stray\.ts — unattributed/, "the unexplained come first");
  assert.equal(explainChanges({ id: "TASK-1" }, ["a.ts"], top, [])[0]!.kinds[0], "unattributed", "no baseline: nothing is pre-existing");
  const many = explainChanges({ id: "TASK-1" }, Array.from({ length: 70 }, (_, index) => `f${index}.ts`), top, []);
  const capped = provenanceLines(many, 60).split("\n");
  assert.equal(capped.length, 61);
  assert.equal(capped.at(-1), "- …and 10 more: 10 unattributed (f60.ts, f61.ts, f62.ts, f63.ts, f64.ts, …)");
});

test("changed files come from git one by one: new folders, renames and odd names included", async () => {
  const dir = gitRepo();
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  mkdirSync(join(dir, "src/new"));
  writeFileSync(join(dir, "src/new/b.ts"), "export {};\n");
  renameSync(join(dir, "src/old name.ts"), join(dir, "src/new name.ts"));
  execFileSync("git", ["add", "-A", "src/old name.ts", "src/new name.ts"], { cwd: dir });
  const tree = await changedFiles(join(dir, "src"));
  assert.equal(tree?.top, dir);
  assert.deepEqual(tree?.files.sort(), ["src/a.ts", "src/new name.ts", "src/new/b.ts"]);
  assert.equal(await changedFiles(tempDir()), undefined, "no repository, no answer");
});

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning"];
const PLAN = "## Objective\nAdd a.\n## Domains\nbackend\n## Files\nsrc/a.ts\n## Sequence\n1\n## Dependencies\nnone\n## Testing\nunit\n## Acceptance Criteria\nworks\n## Rollback\nrevert\n## Review\npeer";

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

test("the QA gate and the Master are told which changes are planned, a quick fix, pre-existing or unattributed", async () => {
  const dir = gitRepo();
  const prompts: string[] = [];
  // The worker edits src/a.ts through its edit tool; the reviewer passes.
  const runProcess: ProcessRunner = async (args, options) => {
    const system = readFileSync(args[args.indexOf("--append-system-prompt") + 1]!, "utf8");
    prompts.push(system);
    if (/Worker Role/.test(system)) {
      const edit: PiStreamEvent = { type: "tool_execution_start", toolName: "edit", args: { path: "src/a.ts" } };
      options.onEvent?.(edit);
      writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
      return { exitCode: 0, stdout: reply("## Completed\nAdded a.\n\n## Files Changed\n- src/a.ts — added a"), stderr: "", killed: false, timedOut: false };
    }
    return { exitCode: 0, stdout: reply("## Verdict\nPASS\n\n## Verification\n- `npm test` — passing"), stderr: "", killed: false, timedOut: false };
  };
  const deps: WorkflowDeps = { root: dir, configDir: ".pi", cwd: dir, config: DEFAULT_CONFIG, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess };
  ensureProjectStructure(dir, ".pi");
  const task = createTask("TASK-1", "Add a", "2026-01-01T00:00:00.000Z");
  createTaskDir(dir, ".pi", task);
  for (const state of FLOW) transition(task, state);
  task.domains = ["backend"];
  task.plan = PLAN;
  saveTask(dir, ".pi", task);
  // The user's own work before the task's agents start, and a quick fix the user asked for.
  writeFileSync(join(dir, "src/pre.ts"), "export const pre = 1;\n");
  writeFileSync(join(dir, "src/q.ts"), "export const q = 1;\n");
  appendChange(dir, ".pi", record({ id: "QF-1", what: "rename q", files: [join(dir, "src/q.ts")], finishedAt: new Date().toISOString() }));
  const act = (params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);
  const implemented = await act({ action: "implement", domain: "backend", task: "Add a to src/a.ts" });
  assert.equal(implemented.ok, true, implemented.message);
  assert.deepEqual(loadTask(dir, ".pi", "TASK-1")!.baseline?.files.sort(), ["src/pre.ts", "src/q.ts"], "the tree as the first worker found it, without bot-lobby's own folder");
  assert.match(implemented.message, /Changed files: 1 planned · 1 by quick fix \(QF-1\) · 2 pre-existing\./);
  assert.ok(readChanges(dir, ".pi").some((entry) => entry.source === "worker" && entry.taskId === "TASK-1" && entry.files.includes(join(dir, "src/a.ts"))), "the worker's edit is on record");
  // Something no agent recorded appears.
  writeFileSync(join(dir, "src/stray.ts"), "export {};\n");
  const qa = await act({ action: "qa" });
  assert.equal(qa.ok, true, qa.message);
  const reviewer = prompts.at(-1)!;
  assert.match(reviewer, /## Change provenance/, "the reviewer's role says how to judge each source");
  assert.match(reviewer, /- src\/stray\.ts — unattributed: no bot-lobby agent recorded editing it/);
  assert.match(reviewer, /- src\/q\.ts — quick fix QF-1 at \d\d:\d\d, asked by the user: "rename q"; pre-existing/);
  assert.match(reviewer, /- src\/a\.ts — planned: DEV — Add a to src\/a\.ts/);
  assert.match(reviewer, /- src\/pre\.ts — pre-existing/);
  assert.doesNotMatch(reviewer, /\.pi\/bot-lobby/, "bot-lobby's own records are not changes");
  assert.match(qa.message, /Changed files: 1 planned · 1 by quick fix \(QF-1\) · 2 pre-existing · 1 unattributed \(src\/stray\.ts\)\. The user asked for the quick fixes directly: never revert them or send them back as fixes\. Pre-existing changes and other tasks' are not this task's to review or revert\. No agent recorded the unattributed edits: ask the user before counting them in or reverting them\./);
});

test("a task already under way before provenance existed is not misread", async () => {
  const dir = gitRepo();
  const runProcess: ProcessRunner = async () => ({ exitCode: 0, stdout: reply("## Verdict\nPASS\n\n## Verification\n- `npm test` — passing"), stderr: "", killed: false, timedOut: false });
  const deps: WorkflowDeps = { root: dir, configDir: ".pi", cwd: dir, config: DEFAULT_CONFIG, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess };
  ensureProjectStructure(dir, ".pi");
  const task = createTask("TASK-1", "Add a");
  createTaskDir(dir, ".pi", task);
  for (const state of [...FLOW, "implementing", "reviewing"] as TaskState[]) transition(task, state);
  task.domains = ["backend"];
  task.plan = PLAN;
  task.workerRuns = [{ runId: "old", domain: "backend", instruction: "Add a", status: "success", startedAt: "2026-01-01T00:00:00.000Z" }];
  saveTask(dir, ".pi", task);
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  const qa = await runWorkflowAction({ action: "qa", taskId: "TASK-1" } as OrchestrateParams, deps);
  assert.equal(qa.ok, true, qa.message);
  assert.doesNotMatch(qa.message, /Changed files/, "without a baseline the gate reviews as it always did");
});
