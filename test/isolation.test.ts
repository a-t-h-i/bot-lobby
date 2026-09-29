import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerCommands, parseCommand } from "../src/pi/commands.ts";
import { setMinimized } from "../src/pi/ui.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, listTasks, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import { chooseTrack } from "../src/workflow/track.ts";
import { createWorkspace } from "../src/execution/workspace.ts";
import { stripStartFlags } from "../src/pi/start-flags.ts";
import type { ProcessRunner, ProcessRunOptions } from "../src/execution/pi-runner.ts";
import { kickoff } from "../src/pi/start-task.ts";

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bl-iso-")));
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.email", "test@example.com");
  sh(root, "config", "user.name", "Test");
  writeFileSync(join(root, "readme.md"), "hello\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-qm", "init");
  return root;
}

// The suite also runs inside a subagent process; the ambient flag is parked so the master path is observed.
let ambientSubagent: string | undefined;
let ambientConfig: string | undefined;
before(() => {
  ambientSubagent = process.env.BOT_LOBBY_SUBAGENT;
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  delete process.env.BOT_LOBBY_SUBAGENT;
});
after(() => {
  if (ambientSubagent !== undefined) process.env.BOT_LOBBY_SUBAGENT = ambientSubagent;
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
});

/** A fake pi with just what starting a task from `/bot-lobby` touches. */
function makePi() {
  const state = {
    sent: [] as string[],
    sessionName: undefined as string | undefined,
    handlers: {} as Record<string, (args: string | undefined, ctx: ExtensionContext) => unknown>,
    sendUserMessage: (message: string) => void state.sent.push(message),
    getSessionName: () => state.sessionName,
    setSessionName: (name: string) => void (state.sessionName = name),
    appendEntry: () => {},
    setThinkingLevel: () => {},
    registerShortcut: () => {},
    registerCommand: (name: string, options?: { handler: (args: string | undefined, ctx: ExtensionContext) => unknown }) => {
      if (options?.handler) state.handlers[name] = options.handler;
    },
    on: () => () => {},
    getActiveTools: () => [],
  };
  return state;
}

function makeCtx(cwd: string) {
  const notes: string[] = [];
  const ui = { notify: (message: string) => void notes.push(message), setStatus: () => {}, setWidget: () => {} };
  return { ctx: { cwd, ui, sessionManager: { getSessionId: () => "session-1", getBranch: () => [] }, isIdle: () => true } as unknown as ExtensionContext, notes };
}

/** Run `/bot-lobby <args>` in a repository, with `isolation` as the configured default. */
async function startIn(root: string, args: string, isolation?: string) {
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-iso-cfg-"));
  if (isolation) writeFileSync(join(process.env.BOT_LOBBY_CONFIG_DIR, "config.json"), JSON.stringify({ workflow: { gitIsolation: isolation } }));
  setMinimized(false);
  ensureProjectStructure(root, ".pi");
  const pi = makePi();
  registerCommands(pi as unknown as ExtensionAPI, ".pi");
  const { ctx, notes } = makeCtx(root);
  await pi.handlers["bot-lobby"]!(args, ctx);
  return { pi, notes, task: listTasks(root, ".pi")[0] };
}

test("--branch gives the task a branch named after it, and the oracle is told", async () => {
  const root = repo();
  const { pi, task } = await startIn(root, "--task --branch change the table font");
  assert.ok(task, "the task started");
  assert.match(task.id, /^Task-Change-Table-Font-\d{2}-\d{2}-\d{4}$/);
  assert.deepEqual([task.git?.mode, task.git?.branch, task.git?.from], ["branch", task.id, "main"]);
  assert.equal(sh(root, "branch", "--show-current"), task.id, "the working folder is on it");
  assert.match(pi.sent.at(-1)!, new RegExp(`Git: this task works on its own branch ${task.id} \\(from main\\)`));
  assert.equal(pi.sessionName, task.id, "the session carries the same name");
});

test("--worktree gives the task a worktree of its own; the main checkout stays put", async () => {
  const root = repo();
  const { pi, task } = await startIn(root, "--task --worktree change the table font");
  assert.equal(task?.git?.mode, "worktree");
  assert.equal(task?.git?.path, join(root, ".pi", "bot-lobby", "worktrees", task!.id));
  assert.ok(existsSync(join(task!.git!.path!, "readme.md")));
  assert.equal(sh(root, "branch", "--show-current"), "main");
  assert.match(pi.sent.at(-1)!, /own worktree .* on branch .*\. Every agent runs there\./);
  // Saved with the task, so a later session finds it.
  assert.deepEqual(loadTask(root, ".pi", task!.id)!.git, task!.git);
});

test("workflow.gitIsolation is the default for every task, and --no-branch opts one out", async () => {
  const root = repo();
  const configured = await startIn(root, "--task change the table font", "branch");
  assert.equal(configured.task?.git?.mode, "branch");
  const other = repo();
  const off = await startIn(other, "--task --no-branch change the table font", "branch");
  assert.equal(off.task?.git, undefined);
  assert.equal(sh(other, "branch", "--show-current"), "main");
  const never = repo();
  assert.equal((await startIn(never, "--task change the table font")).task?.git, undefined, "off unless asked for");
});

test("a task in a folder git cannot use still starts, and says why it has no branch", async () => {
  const plain = realpathSync(mkdtempSync(join(tmpdir(), "bl-iso-plain-")));
  const { pi, notes, task } = await startIn(plain, "--task --branch change the table font");
  assert.ok(task, "git never stops a task from starting");
  assert.equal(task.git, undefined);
  assert.ok(notes.some((note) => note.includes("runs without its own branch — this folder is not a git repository")), notes.join("\n"));
  assert.doesNotMatch(pi.sent.at(-1)!, /Git:/);
});

test("flags lead the request: they are read, stripped from the name, and never left in the request", () => {
  assert.deepEqual(parseCommand("--worktree --auto add login").isolation, "worktree");
  assert.equal(parseCommand("--branch add login").isolation, "branch");
  assert.equal(parseCommand("--no-branch add login").isolation, "off");
  assert.equal(parseCommand("--worktree add login").restText, "add login");
  assert.equal(parseCommand("--branchy add login").isolation, undefined, "only whole flags count");
  assert.equal(stripStartFlags("--task --worktree --budget 90m add login"), "add login");
  assert.equal(stripStartFlags("add --worktree login"), "add --worktree login");
});

test("gitIsolation in the config is one of off, branch, worktree; anything else is off", () => {
  assert.equal(DEFAULT_CONFIG.workflow.gitIsolation, "off");
  assert.equal(resolveConfig({ workflow: { gitIsolation: "worktree" } }).workflow.gitIsolation, "worktree");
  assert.equal(resolveConfig({ workflow: { gitIsolation: "branch" } }).workflow.gitIsolation, "branch");
  assert.equal(resolveConfig({ workflow: { gitIsolation: "sideways" } }).workflow.gitIsolation, "off");
  assert.equal(resolveConfig({ workflow: { gitIsolation: true } }).workflow.gitIsolation, "off");
});

const WORKER = ["## Completed", "Changed the colour.", "", "## Files Changed", "- `src/ui/button.css` — blue"].join("\n");

/** A fast task in `root`, with the git a workspace gave it, and a fake pi that records where each agent runs. */
async function taskWithWorkspace(mode: "branch" | "worktree") {
  const root = repo();
  ensureProjectStructure(root, ".pi");
  const task = createTask("Task-Blue-Button-27-09-2026", "blue button", "2026-01-01T00:00:00.000Z", "change the submit button colour to blue");
  task.track = chooseTrack(task.request, undefined, { fastTrack: true }, "2026-01-01T00:00:00.000Z");
  const made = await createWorkspace({ cwd: root, root, configDir: ".pi", name: task.id, mode });
  assert.equal(typeof made, "object");
  task.git = made as Exclude<typeof made, string>;
  createTaskDir(root, ".pi", task);
  transition(task, "clarifying");
  saveTask(root, ".pi", task);
  const cwds: Array<string | undefined> = [];
  const runner: ProcessRunner = async (_args: string[], options: ProcessRunOptions) => {
    cwds.push(options.cwd);
    return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: WORKER }], stopReason: "stop" } }), stderr: "", killed: false, timedOut: false };
  };
  const deps: WorkflowDeps = { root, configDir: ".pi", cwd: root, config: { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false } }, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess: runner };
  const act = (params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: task.id, ...params } as OrchestrateParams, deps);
  return { root, task, cwds, act };
}

test("every agent of a task with a worktree runs in it", async () => {
  const { root, task, cwds, act } = await taskWithWorkspace("worktree");
  const built = await act({ action: "implement", domain: "designer", task: "Step 1: make the submit button blue" });
  assert.equal(built.ok, true, built.message);
  assert.deepEqual(cwds, [task.git!.path], "the worker ran in the worktree, not in the main checkout");
  assert.notEqual(cwds[0], root);
  const qa = await act({ action: "qa" });
  assert.equal(qa.ok, true, qa.message);
  assert.equal(cwds.at(-1), task.git!.path, "and so did the QA gate");
});

test("a task on a branch, or without git, runs its agents where the session works", async () => {
  const { root, cwds, act } = await taskWithWorkspace("branch");
  await act({ action: "implement", domain: "designer", task: "Step 1: make the submit button blue" });
  assert.deepEqual(cwds, [root]);
});

test("a task whose worktree was removed is refused, with how to bring it back, rather than editing the main checkout", async () => {
  const { task, cwds, act } = await taskWithWorkspace("worktree");
  rmSync(task.git!.path!, { recursive: true, force: true });
  const refused = await act({ action: "implement", domain: "designer", task: "Step 1: make the submit button blue" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /the worktree .* of branch Task-Blue-Button-27-09-2026 is gone\. Restore it with: git worktree add/);
  assert.deepEqual(cwds, [], "no agent ran");
  assert.equal((await act({ action: "status" })).ok, true, "status still answers");
});

test("the kickoff carries the git line only for a task that has one", () => {
  const plain = createTask("Task-A-27-09-2026", "a");
  assert.doesNotMatch(kickoff(plain), /Git:/);
  const isolated = { ...plain, git: { mode: "branch" as const, branch: "Task-A-27-09-2026", from: "main" } };
  assert.match(kickoff(isolated), /State: created\nGit: this task works on its own branch Task-A-27-09-2026 \(from main\)/);
  assert.equal(loadTask(repo(), ".pi", "nothing"), undefined);
});
