import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { createLobbyService } from "../src/lobby/service.ts";
import { lobbyFeed } from "../src/lobby/feed.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { createTask } from "../src/schemas/task.ts";
import { requestApproval } from "../src/workflow/approvals.ts";
import { HttpError } from "../src/webui/api/index.ts";
import { taskExecution } from "../src/execution/task-cancellation.ts";
import { runWorkflowAction } from "../src/workflow/workflow.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";

let ambientConfig: string | undefined;
before(() => {
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-svc-cfg-"));
});
after(() => {
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
});

function fakeState(): Runtime {
  const root = mkdtempSync(join(tmpdir(), "bl-svc-"));
  ensureProjectStructure(root, ".pi");
  const ctx = {
    cwd: root,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => "session-1", getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  const pi = {
    sendUserMessage() {},
    getSessionName: () => "test window",
  } as unknown as ExtensionAPI;
  return { root, configDir: ".pi", ctx, pi } as unknown as Runtime;
}

test("the service exposes data and actions with no TUI", () => {
  const service = createLobbyService(fakeState());
  assert.equal(service.feed, lobbyFeed);
  assert.deepEqual(service.tasks(), []);
  assert.equal(typeof service.toOracle, "function");
  assert.equal(service.comment("TASK-nope", "hello"), "no task TASK-nope");
  assert.equal(typeof service.issuesEnabled(), "boolean");
});

test("accept persists explicit waivers and audit through a stale worker save without completing", async () => {
  const state = fakeState();
  const messages: string[] = [];
  state.pi.sendUserMessage = (message) => { assert.equal(typeof message, "string"); if (typeof message === "string") messages.push(message); };
  const task = createTask("TASK-accept", "Accept", undefined, undefined, "session-1");
  task.state = "blocked"; task.qaVerdict = "changes_required";
  task.blockers = [{ domain: "qa", reason: "QA asks", need: "fix", tried: ["review"], createdAt: task.createdAt }];
  saveTask(state.root, state.configDir, task);
  const stale = loadTask(state.root, state.configDir, task.id)!;
  const service = createLobbyService(state);
  assert.match((await service.acceptTask!(task.id)).notice, /accepted/);
  saveTask(state.root, state.configDir, stale);
  const saved = loadTask(state.root, state.configDir, task.id)!;
  assert.ok(saved.qaWaiver); assert.equal(saved.state, "reviewing"); assert.deepEqual(saved.blockers, []);
  assert.ok(saved.decisions.some((entry) => entry.text.includes("user accepted")));
  assert.match(messages[0]!, /action=complete/);
  assert.match(messages[0]!, /Do not merge automatically/);
  await assert.rejects(service.acceptTask!("TASK-missing"), (error: unknown) => error instanceof HttpError && error.status === 404);
  assert.equal(typeof service.forceCloseTask, "function");
});

test("approval resolution reuses pushback validation, survives stale saves, and rejects stale requests", async () => {
  const state = fakeState(); const task = createTask("TASK-approval", "Approval", undefined, undefined, "session-1");
  task.state = "implementing";
  const approval = requestApproval(task, "pushback", "backend", "unsafe change");
  saveTask(state.root, state.configDir, task);
  const stale = loadTask(state.root, state.configDir, task.id)!;
  const service = createLobbyService(state);
  await assert.rejects(service.resolveTaskApproval!(task.id, approval.id, "rejected"), (error: unknown) => error instanceof HttpError && error.status === 400);
  await service.resolveTaskApproval!(task.id, approval.id, "approved");
  saveTask(state.root, state.configDir, stale);
  const saved = loadTask(state.root, state.configDir, task.id)!;
  assert.equal(saved.approvals[0]!.status, "approved");
  assert.ok(saved.decisions.some((entry) => entry.text.includes("approved pushback")));
  await assert.rejects(service.resolveTaskApproval!(task.id, approval.id, "approved"), (error: unknown) => error instanceof HttpError && error.status === 409);
});

test("force close validates exactly, aborts only its task, retains audit and prevents late resurrection", async () => {
  const state = fakeState(); const service = createLobbyService(state);
  let aborts = 0; state.ctx.abort = () => { aborts++; };
  const task = createTask("TASK-close", " Exact Title ", undefined, undefined, "session-1");
  task.state = "implementing";
  saveTask(state.root, state.configDir, task);
  const stale = loadTask(state.root, state.configDir, task.id)!;
  const running = taskExecution(state.root, state.configDir, task.id);
  const other = taskExecution(state.root, state.configDir, "TASK-other");
  try {
    for (const title of ["Exact Title", " exact title ", " Exact Title"]) await assert.rejects(service.forceCloseTask!(task.id, title), (error: unknown) => error instanceof HttpError && error.status === 400);
    await assert.rejects(service.forceCloseTask!("missing", task.title), (error: unknown) => error instanceof HttpError && error.status === 404);
    assert.equal(running.signal.aborted, false);
    assert.match((await service.forceCloseTask!(task.id, task.title)).notice, /abandoned/);
    assert.equal(running.signal.aborted, true); assert.equal(other.signal.aborted, false); assert.equal(aborts, 1);
    stale.state = "completed"; saveTask(state.root, state.configDir, stale);
    const saved = loadTask(state.root, state.configDir, task.id)!;
    assert.equal(saved.state, "abandoned"); assert.ok(saved.decisions.some((entry) => entry.text.includes("force-closed")));
    assert.equal(service.canForceCloseTask!(task.id), false);
    await assert.rejects(service.forceCloseTask!(task.id, task.title), (error: unknown) => error instanceof HttpError && error.status === 400);
  } finally { running.release(); other.release(); }
});

test("force close cancels an actual workflow worker signal and rejects unsupported remote ownership", async () => {
  const state = fakeState(); const service = createLobbyService(state);
  const task = createTask("TASK-worker", "Worker", undefined, undefined, "session-1");
  task.state = "clarifying"; task.domains = ["backend"];
  saveTask(state.root, state.configDir, task);
  let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; });
  let cancelled = false;
  const work = runWorkflowAction({ action: "scout", taskId: task.id }, {
    root: state.root, configDir: state.configDir, cwd: state.root, sessionId: "session-1", config: DEFAULT_CONFIG,
    ask: async () => undefined, choose: async () => undefined, notify: () => {},
    runProcess: async (_args, options) => {
      started();
      await new Promise<void>((resolve) => options.signal!.addEventListener("abort", () => { cancelled = true; resolve(); }, { once: true }));
      return { exitCode: 1, stdout: "", stderr: "cancelled", killed: true, timedOut: false };
    },
  });
  await ready; await service.forceCloseTask!(task.id, task.title);
  assert.equal((await work).ok, false); assert.equal(cancelled, true);
  assert.equal(loadTask(state.root, state.configDir, task.id)!.state, "abandoned");
  const remote = createTask("TASK-remote", "Remote", undefined, undefined, "another-session");
  saveTask(state.root, state.configDir, remote);
  assert.equal(service.canForceCloseTask!(remote.id), false);
  await assert.rejects(service.forceCloseTask!(remote.id, remote.title), (error: unknown) => error instanceof HttpError && error.status === 400);
  assert.equal(loadTask(state.root, state.configDir, remote.id)!.state, "created");
});

test("the service carries no terminal-only members", () => {
  const service = createLobbyService(fakeState());
  for (const member of ["rows", "theme", "hide", "requestRender", "keys", "panels", "savePanels", "editText", "openSettings"]) {
    assert.ok(!(member in service), `${member} stays with the terminal`);
  }
});
