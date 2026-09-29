import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { addPlanComment, readPlanComments } from "../src/state/comments.ts";
import { readMetrics } from "../src/state/metrics.ts";
import { applyStatus, clearStatus, setMinimized } from "../src/pi/ui.ts";
import { ANCHOR_KEY, backgroundSessions, deliverComments, hideLobby, isLobbyVisible, lobbyView, registerLobbyEvents, setSessionLauncher, showLobby } from "../src/lobby/runtime.ts";
import { isAutoMode } from "../src/state/auto.ts";
import { readInbox } from "../src/state/inbox.ts";
import { FakeSessionProcess } from "./fake-session.ts";
import { lobbyFeed } from "../src/lobby/feed.ts";
import { registerOwner } from "../src/pi/owner.ts";

let ambientSubagent: string | undefined;
let ambientConfig: string | undefined;
before(() => {
  ambientSubagent = process.env.BOT_LOBBY_SUBAGENT;
  delete process.env.BOT_LOBBY_SUBAGENT;
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-rt-cfg-"));
});
after(() => {
  if (ambientSubagent === undefined) delete process.env.BOT_LOBBY_SUBAGENT;
  else process.env.BOT_LOBBY_SUBAGENT = ambientSubagent;
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
});

type Handler = (event: any, ctx: ExtensionContext) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const sent: Array<{ text: string; options?: unknown }> = [];
  const shortcuts: string[] = [];
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
    registerShortcut(key: string) {
      shortcuts.push(key);
    },
    sendUserMessage(text: string, options?: unknown) {
      sent.push({ text, options });
    },
    getThinkingLevel: () => "high",
    getSessionName: () => "my window",
  };
  const emit = async (event: string, payload: unknown, ctx: ExtensionContext) => {
    for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
  };
  return { pi: pi as unknown as ExtensionAPI, emit, sent, shortcuts };
}

function fakeUi() {
  const overlay = { shown: 0, hidden: [] as boolean[], focused: 0, removed: 0 };
  const written: string[] = [];
  const tui = {
    mode: "regular",
    terminal: { rows: 30, columns: 100, write: (data: string) => void written.push(data) },
    requestRender() {},
    showOverlay() {
      overlay.shown += 1;
      return {
        setHidden: (value: boolean) => void overlay.hidden.push(value),
        focus: () => void (overlay.focused += 1),
        hide: () => void (overlay.removed += 1),
      };
    },
  };
  const widgets = new Map<string, unknown>();
  const mounted = new Map<string, { dispose?(): void }>();
  const notes: string[] = [];
  const theme = { fg: (_c: string, text: string) => text, bg: (_c: string, text: string) => text, bold: (text: string) => text, italic: (text: string) => text };
  const ui = {
    theme,
    // Like pi: replacing or clearing a widget disposes the old component.
    setWidget(key: string, content: unknown) {
      mounted.get(key)?.dispose?.();
      mounted.delete(key);
      widgets.set(key, content);
      if (typeof content === "function") mounted.set(key, (content as (tui: unknown, theme: unknown) => { dispose?(): void })(tui, theme));
    },
    setStatus() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    notify(message: string) {
      notes.push(message);
    },
    asked: [] as string[],
    async select(title: string, options: string[]) {
      ui.asked.push(title);
      return options[0];
    },
  };
  return { ui, overlay, widgets, mounted, notes, written };
}

function project(owned: boolean) {
  const root = mkdtempSync(join(tmpdir(), "bl-rt-"));
  ensureProjectStructure(root, ".pi");
  if (owned) {
    const task = createTask("TASK-live", "live task", new Date().toISOString(), "do it", "session-1");
    createTaskDir(root, ".pi", task);
    transition(task, "clarifying");
    saveTask(root, ".pi", task);
  }
  return root;
}

function context(root: string, ui: ReturnType<typeof fakeUi>["ui"], idle = true) {
  let aborted = 0;
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    ui,
    model: { provider: "p", id: "master-model" },
    modelRegistry: { find: () => undefined, getAvailable: () => [] },
    sessionManager: { getSessionId: () => "session-1", getSessionDir: () => join(root, "sessions"), getBranch: () => [{ type: "message", message: { role: "user", content: "hello" } }] },
    isIdle: () => idle,
    abort: () => void (aborted += 1),
  } as unknown as ExtensionContext;
  return { ctx, aborted: () => aborted };
}

async function start(owned: boolean, idle = true) {
  setMinimized(false);
  const root = project(owned);
  const fake = fakePi();
  const ui = fakeUi();
  const { ctx } = context(root, ui.ui, idle);
  registerLobbyEvents(fake.pi, ".pi");
  registerOwner(fake.pi, ".pi");
  applyStatus(ctx, root, ".pi");
  await fake.emit("session_start", { type: "session_start" }, ctx);
  return { root, fake, ui, ctx };
}

async function stop(fake: ReturnType<typeof fakePi>, ctx: ExtensionContext): Promise<void> {
  await fake.emit("session_shutdown", { type: "session_shutdown" }, ctx);
  clearStatus(ctx);
}

test("session start anchors the lobby, seeds the conversation and auto-opens over an owned task", async () => {
  const { fake, ui, ctx } = await start(true);
  try {
    assert.ok(ui.widgets.has(ANCHOR_KEY), "a zero-line anchor widget captures the TUI");
    assert.ok(fake.shortcuts.includes("alt+l"));
    assert.equal(ui.overlay.shown, 1, "the lobby opens over the session's task");
    assert.equal(isLobbyVisible(), true);
    assert.deepEqual(lobbyFeed.chat.map((entry) => [entry.role, entry.text]), [["you", "hello"]]);
  } finally {
    await stop(fake, ctx);
  }
  assert.equal(ui.overlay.removed, 1, "shutdown removes the overlay");
  assert.equal(isLobbyVisible(), false);
});

test("the lobby stays closed without a task, opens on demand and steps aside for dialogs", async () => {
  const { fake, ui, ctx } = await start(false);
  try {
    assert.equal(ui.overlay.shown, 0);
    assert.equal(showLobby(), true);
    assert.equal(ui.overlay.shown, 1);
    await fake.emit("ui_prompt_start", { type: "ui_prompt_start", reason: "ui_prompt", kind: "select" }, ctx);
    await fake.emit("ui_prompt_end", { type: "ui_prompt_end", reason: "ui_prompt", kind: "select" }, ctx);
    assert.deepEqual(ui.overlay.hidden, [true, false], "hidden during the dialog, back after it");
    // Mouse reporting is on only while the lobby shows: off for the dialog, back after it.
    assert.deepEqual(ui.written, ["\x1b[?1000h\x1b[?1006h", "\x1b[?1006l\x1b[?1000l", "\x1b[?1000h\x1b[?1006h"]);
    hideLobby();
    assert.equal(ui.written.at(-1), "\x1b[?1006l\x1b[?1000l");
    assert.equal(isLobbyVisible(), false);
    await fake.emit("ui_prompt_start", { type: "ui_prompt_start", reason: "ui_prompt", kind: "select" }, ctx);
    await fake.emit("ui_prompt_end", { type: "ui_prompt_end", reason: "ui_prompt", kind: "select" }, ctx);
    assert.deepEqual(ui.overlay.hidden, [true, false, true], "a hidden lobby ignores dialogs");
    showLobby();
    assert.equal(ui.overlay.shown, 1, "showing again reuses the overlay");
    assert.equal(ui.overlay.focused, 1);
  } finally {
    await stop(fake, ctx);
  }
});

test("new plan comments reach the owning Master once, as a steer while it works", async () => {
  const { root, fake, ctx } = await start(true, false);
  try {
    addPlanComment(root, ".pi", "TASK-live", "use port 8080", "someone-else");
    assert.equal(deliverComments(), 1);
    assert.equal(deliverComments(), 0, "a delivered comment is not sent twice");
    assert.equal(fake.sent.length, 1);
    assert.match(fake.sent[0]!.text, /^The user left a comment on the proposal of TASK-live from the lobby:\n- use port 8080/);
    assert.deepEqual(fake.sent[0]!.options, { deliverAs: "steer" });
    assert.equal(readPlanComments(root, ".pi", "TASK-live")[0]!.status, "delivered");
    setMinimized(true);
    addPlanComment(root, ".pi", "TASK-live", "held while minimized");
    assert.equal(deliverComments(), 0);
  } finally {
    setMinimized(false);
    await stop(fake, ctx);
  }
});

test("the Master's turn is narrated into the feed and recorded as a metric", async () => {
  const { root, fake, ctx } = await start(true);
  try {
    await fake.emit("agent_start", { type: "agent_start" }, ctx);
    await fake.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "t1", toolName: "orchestrate", args: { action: "scout", domains: ["backend"] } }, ctx);
    await fake.emit("message_update", { type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_delta", delta: "scout the API first" } }, ctx);
    await fake.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: "t1", toolName: "orchestrate", result: {}, isError: false }, ctx);
    await fake.emit("message_update", { type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", delta: "Two questions" } }, ctx);
    assert.equal(lobbyFeed.reply, "Two questions");
    const assistant = { role: "assistant", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "Two questions." }], usage: { input: 100, output: 20, cost: { total: 0.01 } }, stopReason: "stop" };
    await fake.emit("message_end", { type: "message_end", message: assistant }, ctx);
    await fake.emit("agent_end", { type: "agent_end", messages: [assistant] }, ctx);
    assert.equal(lobbyFeed.reply, "");
    assert.ok(lobbyFeed.activity.some((entry) => entry.source === "MASTER" && entry.text === "scouting backend" && !entry.pending));
    assert.deepEqual(lobbyFeed.thoughts.map((entry) => [entry.source, entry.text, entry.live]), [["MASTER", "scout the API first", false]]);
    assert.deepEqual(lobbyFeed.chat.at(-1), { ...lobbyFeed.chat.at(-1)!, role: "oracle", text: "Two questions." });
    const [metric] = readMetrics(root, ".pi");
    assert.deepEqual({ kind: metric!.kind, model: metric!.model, thinking: metric!.thinking, status: metric!.status, tools: metric!.tools, input: metric!.input, taskId: metric!.taskId }, {
      kind: "master", model: "p/master-model", thinking: "high", status: "success", tools: 1, input: 100, taskId: "TASK-live",
    });
  } finally {
    await stop(fake, ctx);
  }
});

test("a failed Master turn shows up in the lobby, not only in pi's chat", async () => {
  const { fake, ctx } = await start(true);
  try {
    await fake.emit("message_end", { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "invalid token\nstack" } }, ctx);
    assert.deepEqual(lobbyFeed.chat.at(-1)!.text, "✗ the oracle's turn failed: invalid token");
    assert.equal(lobbyFeed.activity.at(-1)!.kind, "error");
  } finally {
    await stop(fake, ctx);
  }
});

test("the lobby starts a task in a named background session, relays its questions and messages other sessions' tasks", async () => {
  const launched: Array<{ args: string[]; cwd: string; proc: FakeSessionProcess }> = [];
  setSessionLauncher((args, cwd) => {
    const proc = new FakeSessionProcess();
    launched.push({ args, cwd, proc });
    return proc;
  });
  const { root, fake, ui, ctx } = await start(false);
  try {
    const elsewhere = createTask("TASK-api", "rate limits", new Date().toISOString(), "add rate limits", "other-terminal");
    createTaskDir(root, ".pi", elsewhere);
    transition(elsewhere, "clarifying");
    saveTask(root, ".pi", elsewhere);
    assert.equal(showLobby("lobby"), true);
    const view = lobbyView()!;
    view.handleInput("\x1bn");
    for (const char of "add a login page") view.handleInput(char);
    view.handleInput("\r");
    assert.equal(launched.length, 1);
    assert.deepEqual(launched[0]!.args.slice(0, 6), ["--mode", "rpc", "--name", "add login page", "--model", "p/master-model"]);
    assert.equal(launched[0]!.cwd, root);
    const session = backgroundSessions()[0]!;
    assert.equal(view.viewedEntry().name, "add login page", "named as its task will be");

    // A question while the lobby is up waits in it; enter on an empty prompt puts it to the user with pi's dialog.
    launched[0]!.proc.emit({ type: "extension_ui_request", id: "q1", method: "select", title: "Approve the proposal?", options: ["Approve", "Decline"] });
    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(ui.ui.asked, ["add login page — Approve the proposal?"]);
    assert.deepEqual(launched[0]!.proc.commands("extension_ui_response"), [{ type: "extension_ui_response", id: "q1", value: "Approve" }]);

    // With the lobby hidden, a new question is announced.
    hideLobby();
    launched[0]!.proc.emit({ type: "extension_ui_request", id: "q2", method: "confirm", title: "Sure?", message: "" });
    assert.ok(ui.notes.some((note) => note.includes("add login page is waiting for you")));

    // Another terminal's task: messages go to its inbox, and auto mode is switched in its folder.
    showLobby("lobby");
    view.view({ kind: "idle", taskId: "TASK-api" });
    for (const char of "cap bursts") view.handleInput(char);
    view.handleInput("\r");
    assert.deepEqual(readInbox(root, ".pi", "TASK-api").map((message) => [message.text, message.by]), [["cap bursts", "session-1"]]);
    view.handleInput("\x1bg");
    assert.equal(isAutoMode(root, ".pi", "TASK-api"), true);
    assert.equal(session.alive, true);
  } finally {
    await stop(fake, ctx);
    setSessionLauncher(undefined);
  }
  assert.ok(launched[0]!.proc.signals.length === 1, "resetting the launcher stops the sessions it started");
});

test("switching to a background session stops its process, then asks pi to run its session file here", async () => {
  const launched: FakeSessionProcess[] = [];
  setSessionLauncher(() => {
    const proc = new FakeSessionProcess();
    launched.push(proc);
    return proc;
  });
  const { fake, ctx } = await start(false);
  try {
    assert.equal(showLobby("lobby"), true);
    const view = lobbyView()!;
    view.handleInput("\x1bn");
    for (const char of "add a footer") view.handleInput(char);
    view.handleInput("\r");
    launched[0]!.emit({ type: "response", command: "get_state", success: true, data: { sessionId: "child-1", sessionFile: "/sessions/child-1.jsonl" } });
    view.switchTo(view.viewedEntry());
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(launched[0]!.signals, ["SIGTERM"], "the background process ends first");
    assert.deepEqual(fake.sent.at(-1), { text: "/bot-lobby switch /sessions/child-1.jsonl", options: { expandPromptTemplates: true } });
  } finally {
    await stop(fake, ctx);
    setSessionLauncher(undefined);
  }
});

test("while the lobby is hidden a one-line status shows under the editor, and it clears when the lobby opens or bot-lobby is minimized", async () => {
  setMinimized(false);
  const { fake, ui, ctx } = await start(false);
  try {
    hideLobby();
    const anchor = () => (ui.mounted.get(ANCHOR_KEY) as unknown as { render(width: number): string[] }).render(100);
    const idle = anchor();
    assert.equal(idle.length, 1);
    assert.match(idle[0]!, /bot-lobby.*idle.*Alt\+L opens/);
    showLobby();
    assert.deepEqual(anchor(), [], "the lobby is up: no status line");
    hideLobby();
    assert.equal(anchor().length, 1, "hidden again: the line is back");
    setMinimized(true);
    assert.deepEqual(anchor(), [], "minimized bot-lobby shows nothing");
    setMinimized(false);
  } finally {
    await stop(fake, ctx);
  }
});
