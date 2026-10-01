import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExcalidrawSession } from "../src/excalidraw/sessions.ts";
import { ensureProjectStructure } from "../src/state/persistence.ts";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { applyStatus, clearStatus, reportRuns, setMinimized } from "../src/pi/ui.ts";
import { ANCHOR_KEY, currentLobbyService, hideLobby, isLobbyVisible, registerLobbyEvents, setSessionLauncher, showLobby } from "../src/lobby/runtime.ts";
import { LOBBY_TOPICS, LobbyTopics, lobbyTopics } from "../src/lobby/topics.ts";
import { promptHub } from "../src/lobby/prompt-hub.ts";
import { lobbyFeed } from "../src/lobby/feed.ts";
import { registerOwner } from "../src/pi/owner.ts";
import type { BackgroundSession } from "../src/lobby/sessions.ts";
import { FakeSessionProcess } from "./fake-session.ts";

let ambientSubagent: string | undefined;
let ambientConfig: string | undefined;
before(() => {
  ambientSubagent = process.env.BOT_LOBBY_SUBAGENT;
  delete process.env.BOT_LOBBY_SUBAGENT;
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-topics-cfg-"));
});
after(() => {
  if (ambientSubagent === undefined) delete process.env.BOT_LOBBY_SUBAGENT;
  else process.env.BOT_LOBBY_SUBAGENT = ambientSubagent;
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
});

test("every topic starts at 0, bumps alone, and reports its versions", () => {
  const topics = new LobbyTopics();
  assert.deepEqual(Object.keys(topics.versions()).sort(), [...LOBBY_TOPICS].sort());
  assert.equal(topics.version("lobby"), 0);
  assert.equal(topics.bump("lobby"), 1);
  assert.equal(topics.bump("lobby"), 2);
  assert.equal(topics.version("lobby"), 2);
  assert.equal(topics.version("tasks"), 0);
  assert.equal(topics.versions().lobby, 2);
});

test("subscribe hears each bump in order; unsubscribe stops it; onChange hears all", () => {
  const topics = new LobbyTopics();
  const heard: Array<[string, number]> = [];
  const plain: number[] = [];
  const off = topics.subscribe((topic, version) => void heard.push([topic, version]));
  const stop = topics.onChange(() => void plain.push(1));
  topics.bump("tasks");
  topics.bump("plans");
  off();
  topics.bump("tasks");
  assert.deepEqual(heard, [["tasks", 1], ["plans", 1]]);
  assert.equal(plain.length, 3);
  stop();
  topics.bump("tasks");
  assert.equal(plain.length, 3);
});

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
    registerShortcut() {},
    sendUserMessage() {},
    getThinkingLevel: () => "high",
    getSessionName: () => "my window",
  };
  const emit = async (event: string, payload: unknown, ctx: ExtensionContext) => {
    for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
  };
  return { pi: pi as unknown as ExtensionAPI, emit };
}

function fakeUi() {
  const notes: string[] = [];
  const theme = { fg: (_c: string, text: string) => text, bg: (_c: string, text: string) => text, bold: (text: string) => text, italic: (text: string) => text };
  const widgets = new Map<string, unknown>();
  const ui = {
    theme,
    setWidget(key: string, content: unknown) {
      widgets.set(key, content);
    },
    setStatus() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    notify(message: string) {
      notes.push(message);
    },
  };
  return { ui, widgets, notes };
}

function context(root: string, ui: ReturnType<typeof fakeUi>["ui"]) {
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    ui,
    model: { provider: "p", id: "master-model" },
    modelRegistry: { find: () => undefined, getAvailable: () => [] },
    sessionManager: { getSessionId: () => "session-1", getSessionDir: () => join(root, "sessions"), getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  return ctx;
}

async function start(owned: boolean) {
  setMinimized(false);
  const root = mkdtempSync(join(tmpdir(), "bl-topics-"));
  ensureProjectStructure(root, ".pi");
  if (owned) {
    const task = createTask("TASK-live", "live task", new Date().toISOString(), "do it", "session-1");
    createTaskDir(root, ".pi", task);
    transition(task, "clarifying");
    saveTask(root, ".pi", task);
  }
  const fake = fakePi();
  const ui = fakeUi();
  const ctx = context(root, ui.ui);
  registerLobbyEvents(fake.pi, ".pi");
  registerOwner(fake.pi, ".pi");
  applyStatus(ctx, root, ".pi");
  await fake.emit("session_start", { type: "session_start" }, ctx);
  return { root, fake, ui, ctx };
}

async function stop(fake: ReturnType<typeof fakePi>, ctx: ExtensionContext): Promise<void> {
  await fake.emit("session_shutdown", { type: "session_shutdown" }, ctx);
  clearStatus(ctx);
  setSessionLauncher(undefined);
}

test("the terminal still anchors, opens and hides exactly as before", async () => {
  const { fake, ui, ctx } = await start(false);
  try {
    assert.ok(ui.widgets.has(ANCHOR_KEY));
    assert.equal(isLobbyVisible(), false);
    const tui = {
      mode: "regular",
      terminal: { rows: 30, columns: 100, write() {} },
      requestRender() {},
      showOverlay() {
        return { setHidden() {}, focus() {}, hide() {} };
      },
    };
    (ui.widgets.get(ANCHOR_KEY) as (tui: unknown, theme: unknown) => unknown)(tui, ui.ui.theme);
    assert.equal(showLobby(), true, "with a TUI captured the lobby still opens");
    assert.equal(isLobbyVisible(), true);
    hideLobby();
    assert.equal(isLobbyVisible(), false);
  } finally {
    await stop(fake, ctx);
  }
});

test("feed writes bump lobby; run updates bump tasks", async () => {
  const { root, fake, ctx } = await start(false);
  try {
    const lobby = lobbyTopics.version("lobby");
    const tasks = lobbyTopics.version("tasks");
    lobbyFeed.log("TEST", "hello", "info");
    assert.equal(lobbyTopics.version("lobby"), lobby + 1);
    reportRuns(ctx, root, ".pi", []);
    assert.equal(lobbyTopics.version("tasks"), tasks + 1);
  } finally {
    await stop(fake, ctx);
  }
});

test("pi dialogs and turns bump status; a finished turn bumps metrics", async () => {
  const { fake, ctx } = await start(true);
  try {
    const status = lobbyTopics.version("status");
    const metrics = lobbyTopics.version("metrics");
    await fake.emit("ui_prompt_start", { type: "ui_prompt_start" }, ctx);
    await fake.emit("ui_prompt_end", { type: "ui_prompt_end" }, ctx);
    assert.equal(lobbyTopics.version("status"), status + 2);
    await fake.emit("agent_start", { type: "agent_start" }, ctx);
    const assistant = { role: "assistant", content: [], stopReason: "stop" };
    await fake.emit("message_end", { type: "message_end", message: assistant }, ctx);
    await fake.emit("agent_end", { type: "agent_end", messages: [assistant] }, ctx);
    assert.equal(lobbyTopics.version("metrics"), metrics + 1);
    assert.ok(lobbyTopics.version("status") >= status + 3);
  } finally {
    await stop(fake, ctx);
  }
});

test("background sessions bump sessions; a hidden question bumps notices", async () => {
  const procs: FakeSessionProcess[] = [];
  setSessionLauncher(() => {
    const proc = new FakeSessionProcess();
    procs.push(proc);
    return proc;
  });
  const { fake, ui, ctx } = await start(false);
  try {
    const service = currentLobbyService()!;
    const sessions = lobbyTopics.version("sessions");
    const notices = lobbyTopics.version("notices");
    const started = service.startSession({ request: "hello test" });
    assert.ok(typeof started === "object", "a background session starts");
    assert.equal(lobbyTopics.version("sessions"), sessions + 1);
    hideLobby();
    procs[0]!.emit({ type: "extension_ui_request", id: "q1", method: "select", title: "Approve?", options: ["Yes", "No"] });
    assert.ok(lobbyTopics.version("sessions") >= sessions + 2);
    assert.ok(lobbyTopics.version("notices") >= notices + 1);
    assert.ok(ui.notes.some((note) => note.includes("is waiting for you")));
    (started as BackgroundSession).stop();
    await (started as BackgroundSession).whenExited();
  } finally {
    await stop(fake, ctx);
  }
});

test("the hub bumps prompts; a link check bumps excalidraw", async () => {
  const { fake, ctx } = await start(false);
  try {
    const service = currentLobbyService()!;
    const prompts = lobbyTopics.version("prompts");
    const prompt = promptHub.open("confirm", "test", { title: "Sure?" });
    assert.equal(lobbyTopics.version("prompts"), prompts + 1);
    assert.equal(promptHub.answer(prompt.id, true), true);
    assert.equal(lobbyTopics.version("prompts"), prompts + 2);
    const excalidraw = lobbyTopics.version("excalidraw");
    const session = { id: "x", name: "x", link: "not-a-link", agents: [], contribute: false, addedAt: "" } as unknown as ExcalidrawSession;
    const checked = await service.checkExcalidraw(session);
    assert.equal(checked.ok, false);
    assert.equal(lobbyTopics.version("excalidraw"), excalidraw + 1);
  } finally {
    await stop(fake, ctx);
  }
});
