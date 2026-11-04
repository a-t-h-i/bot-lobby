/**
 * Resume from the Tasks screen: a paused task is unpaused where it runs and
 * its oracle told to carry on; a task nothing runs carries on in a background
 * session (its own session again when its file is known, else a fresh one
 * that takes it over with `/bot-lobby carry-on`). This window never moves.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTask, type Task } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask } from "../src/state/persistence.ts";
import { writePresence } from "../src/state/presence.ts";
import { readInbox } from "../src/state/inbox.ts";
import { createLobbyService, setSessionLauncher } from "../src/lobby/service.ts";
import { carryOnMessage, resumable, resumeRoute, type Drivers } from "../src/lobby/resume.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { tasksList, tasksResume } from "../src/webui/api/tasks.ts";
import type { ApiContext } from "../src/webui/api/index.ts";
import { registerCommands } from "../src/pi/commands.ts";
import { setMinimized } from "../src/pi/ui.ts";
import { FakeSessionProcess } from "./fake-session.ts";

let ambientSubagent: string | undefined;
before(() => {
  process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-resume-cfg-"));
  ambientSubagent = process.env.BOT_LOBBY_SUBAGENT;
  delete process.env.BOT_LOBBY_SUBAGENT;
});
after(() => {
  setSessionLauncher(undefined);
  if (ambientSubagent !== undefined) process.env.BOT_LOBBY_SUBAGENT = ambientSubagent;
});

const TIDY = "Task-Tidy-Copy-01-10-2026";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bl-resume-root-"));
  ensureProjectStructure(root, ".pi");
  const sent: string[] = [];
  const ctx = {
    cwd: root,
    ui: { notify() {}, setStatus() {}, setWidget() {} },
    sessionManager: { getSessionId: () => "session-1", getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  const pi = { sendUserMessage: (text: string) => void sent.push(text), getSessionName: () => "test window" } as unknown as ExtensionAPI;
  const launched: Array<{ args: string[]; proc: FakeSessionProcess }> = [];
  setSessionLauncher((args) => {
    const proc = new FakeSessionProcess();
    launched.push({ args, proc });
    return proc;
  });
  const service = createLobbyService({ root, ctx, pi, configDir: ".pi" } as unknown as Runtime);
  const task = (id: string, extra: Partial<Task>) => {
    const made: Task = { ...createTask(id, "Tidy the settings copy"), state: "implementing", ...extra };
    createTaskDir(root, ".pi", made);
    return made;
  };
  const row = (id: string) => tasksList({ service } as unknown as ApiContext).rows.find((entry) => entry.id === id)!;
  return { root, sent, launched, service, task, row };
}

test("resumeRoute: paused where it runs, stopped when nothing runs it; running and finished tasks offer nothing", () => {
  const drivers: Drivers = { me: "me", background: new Set(["bg"]), carrying: new Set(["Task-C"]), live: new Set(["other"]) };
  const task = (extra: Partial<Task>): Task => ({ ...createTask("Task-A", "A"), state: "implementing", ...extra });
  assert.deepEqual(resumeRoute(task({ ownerSessionId: "me" }), drivers), { kind: "running", where: "here" });
  assert.deepEqual(resumeRoute(task({ ownerSessionId: "me", paused: true }), drivers), { kind: "paused", where: "here" });
  assert.deepEqual(resumeRoute(task({ ownerSessionId: "bg", paused: true }), drivers), { kind: "paused", where: "background" });
  assert.deepEqual(resumeRoute(task({ ownerSessionId: "other", paused: true }), drivers), { kind: "paused", where: "elsewhere" });
  assert.deepEqual(resumeRoute(task({ ownerSessionId: "gone" }), drivers), { kind: "stopped" });
  assert.deepEqual(resumeRoute(task({}), drivers), { kind: "stopped" }, "no owner at all");
  assert.deepEqual(resumeRoute({ ...task({ ownerSessionId: "gone" }), id: "Task-C" }, drivers), { kind: "running", where: "background" }, "a background session is starting to carry it on");
  assert.deepEqual(resumeRoute(task({ state: "completed", ownerSessionId: "gone" }), drivers), { kind: "finished" });
  assert.equal(resumable(task({ ownerSessionId: "other" }), drivers), false);
  assert.equal(resumable(task({ ownerSessionId: "other", paused: true }), drivers), true);
  assert.equal(resumable(task({ ownerSessionId: "gone" }), drivers), true);
});

test("a stopped task carries on in a fresh background session that takes it over; this window stays put", async () => {
  const { root, sent, launched, service, task, row } = setup();
  task(TIDY, { ownerSessionId: "session-gone", paused: true });
  assert.equal(row(TIDY).resumable, true);
  assert.equal(row(TIDY).owner, "not running");

  const result = await service.resumeTask!(TIDY);
  assert.match(result.notice, /resumed .* in a background session/);
  assert.equal(launched.length, 1);
  assert.ok(!launched[0]!.args.includes("--session"), "no file to start its old session from: a fresh one");
  assert.deepEqual(launched[0]!.proc.commands("prompt").map((command) => command.message), [`/bot-lobby carry-on ${TIDY}`]);
  assert.equal(result.key, service.sessions()[0]!.key);
  assert.deepEqual(sent, [], "this window's oracle is left alone");
  assert.match(loadTask(root, ".pi", TIDY)!.decisions.at(-1)!.text, /resumed from the Tasks screen/);
  assert.equal(loadTask(root, ".pi", TIDY)!.paused, false);

  assert.equal(row(TIDY).owner, "background", "its session is starting");
  assert.equal(row(TIDY).resumable, undefined);
  const again = await service.resumeTask!(TIDY);
  assert.match(again.notice, /already under way in Tidy the settings copy/);
  assert.equal(launched.length, 1, "a second click starts nothing");
});

test("a stopped task whose session file is known starts that session again, so its oracle keeps the conversation", async () => {
  const { root, launched, service, task } = setup();
  task(TIDY, { ownerSessionId: "session-gone" });
  await service.resumeTask!(TIDY);
  const first = launched[0]!.proc;
  first.emit({ type: "response", command: "get_state", success: true, data: { sessionId: "session-bg-9", sessionFile: join(root, "bg-9.jsonl") } });
  // `/bot-lobby carry-on` made it the owner; then the session stops.
  const saved = loadTask(root, ".pi", TIDY)!;
  createTaskDir(root, ".pi", { ...saved, ownerSessionId: "session-bg-9" });
  first.exit(0);

  await service.resumeTask!(TIDY);
  assert.equal(launched.length, 2);
  const args = launched[1]!.args;
  assert.equal(args[args.indexOf("--session") + 1], join(root, "bg-9.jsonl"));
  assert.deepEqual(launched[1]!.proc.commands("prompt").map((command) => command.message), [`/bot-lobby carry-on ${TIDY}`]);
});

test("a paused task is unpaused where it runs: this window, a background session, another terminal", async () => {
  const { root, sent, launched, service, task } = setup();
  // Heartbeats are read at most once a second: the other terminal is up from the start.
  writePresence(root, ".pi", { sessionId: "session-other", pid: process.pid, mode: "tui" });
  task(TIDY, { ownerSessionId: "session-1", paused: true });
  assert.match((await service.resumeTask!(TIDY)).notice, /resumed .* in this window/);
  assert.equal(loadTask(root, ".pi", TIDY)!.paused, false);
  assert.deepEqual(sent, [carryOnMessage({ id: TIDY, state: "implementing" }, "paused")]);
  assert.equal(launched.length, 0);

  const other = "Task-Rename-Button-01-10-2026";
  task(other, { ownerSessionId: "session-other", paused: true });
  assert.match((await service.resumeTask!(other)).notice, /another terminal carries on/);
  assert.equal(loadTask(root, ".pi", other)!.paused, false);
  assert.match(readInbox(root, ".pi", other).at(-1)!.text, /resumed .* from the Tasks screen/);
  assert.equal(launched.length, 0);

  const bg = "Task-Export-Csv-01-10-2026";
  task(bg, { ownerSessionId: "session-gone" });
  const started = await service.resumeTask!(bg);
  launched[0]!.proc.emit({ type: "response", command: "get_state", success: true, data: { sessionId: "session-bg-2" } });
  createTaskDir(root, ".pi", { ...loadTask(root, ".pi", bg)!, ownerSessionId: "session-bg-2", paused: true });
  const resumed = await service.resumeTask!(bg);
  assert.equal(resumed.key, started.key);
  assert.equal(loadTask(root, ".pi", bg)!.paused, false);
  assert.match(String(launched[0]!.proc.commands("prompt").at(-1)!.message), /resumed .* from the Tasks screen\. Carry on/);
  assert.equal(launched.length, 1, "no second session");
});

test("tasks.resume refuses finished and unknown tasks", async () => {
  const { service, task } = setup();
  task(TIDY, { ownerSessionId: "session-gone", state: "completed" });
  const ctx = { service } as unknown as ApiContext;
  await assert.rejects(tasksResume({ taskId: TIDY }, ctx), /nothing to resume/);
  await assert.rejects(tasksResume({ taskId: "Task-Nope-01-10-2026" }, ctx), /no task/);
});

test("/bot-lobby carry-on takes over a task nothing runs, unpauses it and starts the oracle; a running owner keeps it", async () => {
  const { root, task } = setup();
  setMinimized(false);
  const sent: string[] = [];
  const notes: string[] = [];
  const handlers: Record<string, (args: string | undefined, ctx: ExtensionContext) => unknown> = {};
  const pi = {
    sendUserMessage: (message: string) => void sent.push(message),
    registerCommand: (name: string, options?: { handler: (args: string | undefined, ctx: ExtensionContext) => unknown }) => {
      if (options?.handler) handlers[name] = options.handler;
    },
    registerShortcut: () => {},
    on: () => () => {},
  };
  registerCommands(pi as unknown as ExtensionAPI, ".pi");
  const ctx = {
    cwd: root,
    ui: { notify: (message: string) => void notes.push(message), setStatus() {}, setWidget() {} },
    sessionManager: { getSessionId: () => "session-new", getBranch: () => [] },
    isIdle: () => true,
  } as unknown as ExtensionContext;

  task(TIDY, { ownerSessionId: "session-gone", paused: true });
  await handlers["bot-lobby"]!(`carry-on ${TIDY}`, ctx);
  const taken = loadTask(root, ".pi", TIDY)!;
  assert.equal(taken.ownerSessionId, "session-new");
  assert.equal(taken.paused, false);
  assert.match(sent.at(-1)!, /resumed .* the session that drove it had stopped/);

  const other = "Task-Rename-Button-01-10-2026";
  writePresence(root, ".pi", { sessionId: "session-other", pid: process.pid, mode: "tui" });
  task(other, { ownerSessionId: "session-other" });
  sent.length = 0;
  // This session's own task is done, so it may take another.
  createTaskDir(root, ".pi", { ...taken, state: "completed" });
  await handlers["bot-lobby"]!(`carry-on ${other}`, ctx);
  assert.equal(loadTask(root, ".pi", other)!.ownerSessionId, "session-other");
  assert.deepEqual(sent, []);
  assert.match(notes.at(-1)!, /still running/);
});
