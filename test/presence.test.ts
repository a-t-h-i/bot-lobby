import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { livePresence, presenceDir, PRESENCE_TTL_MS, processAlive, removePresence, writePresence } from "../src/state/presence.ts";
import { readSessionInbox, sendToSession } from "../src/state/inbox.ts";
import { deliverSessionInbox, ownerTick, registerOwner, startOwner } from "../src/pi/owner.ts";
import { BackgroundSession } from "../src/lobby/sessions.ts";
import { FakeSessionProcess } from "./fake-session.ts";

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "bl-presence-"));
  ensureProjectStructure(root, ".pi");
  return root;
}

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

test("a heartbeat says a session is running until it goes quiet, its process ends or it is removed", () => {
  const root = project();
  const alive = new Set([100, 200]);
  writePresence(root, ".pi", { sessionId: "a", pid: 100, mode: "tui", name: "add login", taskId: "TASK-1" }, new Date(NOW - 1000));
  writePresence(root, ".pi", { sessionId: "b", pid: 200, mode: "rpc" }, new Date(NOW - PRESENCE_TTL_MS - 1000));
  writePresence(root, ".pi", { sessionId: "c", pid: 300, mode: "tui" }, new Date(NOW - 1000));
  writePresence(root, ".pi", { sessionId: "../escape", pid: 100, mode: "tui" }, new Date(NOW));
  writeFileSync(join(presenceDir(root, ".pi"), "broken.json"), "{");
  const live = livePresence(root, ".pi", NOW, (pid) => alive.has(pid));
  assert.deepEqual(live.map((entry) => [entry.sessionId, entry.name, entry.taskId]), [["a", "add login", "TASK-1"]]);
  const files = readdirSync(presenceDir(root, ".pi"));
  assert.ok(!files.includes("c.json"), "a heartbeat whose process is gone is cleared away");
  assert.ok(files.includes("b.json"), "a late one is only skipped");
  assert.ok(!files.some((file) => file.includes("escape")), "unsafe ids never become file names");
  assert.equal(livePresence(root, ".pi", NOW + 11 * 60_000, () => true).length, 0);
  assert.ok(!existsSync(join(presenceDir(root, ".pi"), "b.json")), "one silent for minutes is forgotten even if its process runs on");
  removePresence(root, ".pi", "a");
  assert.equal(livePresence(root, ".pi", NOW, () => true).length, 0);
  assert.equal(processAlive(process.pid), true);
  assert.equal(processAlive(0), false);
});

function fakeSession(root: string, sessionId: string) {
  const sent: string[] = [];
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => void handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    sendUserMessage: (text: string) => void sent.push(text),
    registerShortcut: () => {},
    getSessionName: () => "add login",
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: root,
    mode: "tui",
    isIdle: () => true,
    sessionManager: { getSessionId: () => sessionId, getSessionFile: () => `/sessions/${sessionId}.jsonl` },
    ui: { notify: () => {} },
  } as unknown as ExtensionContext;
  return { pi, ctx, sent, handlers };
}

test("the owner clock keeps this session's heartbeat, delivers messages left for the session, and clears the heartbeat when it ends", async () => {
  const root = project();
  const task = createTask("TASK-1", "add login", "2026-09-27T10:00:00.000Z", "x", "s-1");
  createTaskDir(root, ".pi", task);
  transition(task, "clarifying");
  saveTask(root, ".pi", task);
  const session = fakeSession(root, "s-1");
  registerOwner(session.pi, ".pi");
  for (const handler of session.handlers.get("session_start") ?? []) await handler({}, session.ctx);
  const [presence] = livePresence(root, ".pi");
  assert.deepEqual([presence?.sessionId, presence?.pid, presence?.name, presence?.sessionFile, presence?.taskId, presence?.mode], ["s-1", process.pid, "add login", "/sessions/s-1.jsonl", "TASK-1", "tui"]);

  sendToSession(root, ".pi", "s-1", "also add a logout button", "other-window");
  assert.equal(deliverSessionInbox(), 1);
  assert.deepEqual(session.sent, ["also add a logout button"]);
  assert.deepEqual(readSessionInbox(root, ".pi", "s-1").map((message) => message.delivered), [true]);
  ownerTick();
  assert.equal(session.sent.length, 1, "delivered once");

  for (const handler of session.handlers.get("session_shutdown") ?? []) await handler({}, session.ctx);
  assert.equal(livePresence(root, ".pi").length, 0);
});

test("a session without a task shows up too", () => {
  const root = project();
  const session = fakeSession(root, "s-2");
  startOwner(session.pi, session.ctx, ".pi", 0);
  assert.deepEqual(livePresence(root, ".pi").map((entry) => [entry.sessionId, entry.taskId]), [["s-2", undefined]]);
});

test("a stopped background session can be waited on, and one that ignores the stop is killed", async () => {
  const polite = new FakeSessionProcess();
  const session = new BackgroundSession(polite, { name: "x", request: "y" });
  const exited = session.whenExited();
  session.stop();
  await exited;
  assert.deepEqual(polite.signals, ["SIGTERM"]);
  await session.whenExited();

  const stubborn = new FakeSessionProcess();
  stubborn.kill = (signal: NodeJS.Signals = "SIGTERM") => {
    stubborn.signals.push(signal);
    if (signal === "SIGKILL") stubborn.exit(null);
    return true;
  };
  const hung = new BackgroundSession(stubborn, { name: "x", request: "y" });
  const done = hung.whenExited();
  hung.stop(10);
  // The kill timer does not hold pi open (it is unref'd), so something here must keep the loop alive until it fires.
  const keepAlive = setTimeout(() => {}, 1000);
  await done;
  clearTimeout(keepAlive);
  assert.deepEqual(stubborn.signals, ["SIGTERM", "SIGKILL"]);
});
