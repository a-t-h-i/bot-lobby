import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isQuiet, isSubagentProcess, setQuiet, toggleQuiet, visibleTools, WEB_TOOL_NAMES } from "../src/pi/quiet.ts";
import { registerQuietTools } from "../src/pi/tool-renderers.ts";
import { registerLifecycle } from "../src/pi/events.ts";
import { applyStatus, isMinimized, registerRevealShortcut, setMinimized, STATUS_KEY } from "../src/pi/ui.ts";
import { registerCommands } from "../src/pi/commands.ts";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, listTasks, loadTask } from "../src/state/persistence.ts";

type AnyTool = ToolDefinition<any, any, any>;
type Renderer = (...args: unknown[]) => { render(width: number): string[] };

function makePi(available: string[], active: string[] = [...available]) {
  const state = {
    available,
    active: [...active],
    activeCalls: [] as string[][],
    tools: [] as AnyTool[],
    shortcuts: [] as string[],
    commands: [] as string[],
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    shortcutHandler: undefined as ((ctx: ExtensionContext) => unknown) | undefined,
    shortcutHandlers: {} as Record<string, (ctx: ExtensionContext) => unknown>,
    commandHandlers: {} as Record<string, (args: string | undefined, ctx: ExtensionContext) => unknown>,
    on(event: string, handler: (...args: unknown[]) => unknown): () => void {
      state.handlers.set(event, handler);
      return () => {};
    },
    registerTool(tool: AnyTool): void {
      state.tools.push(tool);
    },
    registerShortcut(shortcut: string, options: { description?: string; handler: (ctx: ExtensionContext) => unknown }): void {
      state.shortcuts.push(shortcut);
      state.shortcutHandler = options.handler;
      state.shortcutHandlers[shortcut] = options.handler;
    },
    registerCommand(name: string, options?: { handler: (args: string | undefined, ctx: ExtensionContext) => unknown }): void {
      state.commands.push(name);
      if (options?.handler) state.commandHandlers[name] = options.handler;
    },
    getActiveTools(): string[] {
      return [...state.active];
    },
    getAllTools() {
      return state.available.map((name) => ({ name }));
    },
    setActiveTools(names: string[]): void {
      state.activeCalls.push([...names]);
      state.active = [...names];
    },
  };
  return state;
}

type FakePi = ReturnType<typeof makePi>;
const asPi = (fake: FakePi): ExtensionAPI => fake as unknown as ExtensionAPI;

function makeCtx(cwd: string, expanded = false, sessionId = "session-1") {
  const ui = {
    expanded,
    expandedCalls: [] as boolean[],
    statuses: [] as Array<{ key: string; text: string | undefined }>,
    widgets: [] as Array<{ key: string; content: unknown }>,
    notifications: [] as Array<{ message: string; type: string | undefined }>,
    setStatus(key: string, text: string | undefined): void {
      ui.statuses.push({ key, text });
    },
    setWidget(key: string, content: unknown): void {
      ui.widgets.push({ key, content });
    },
    setWorkingVisible(_visible: boolean): void {},
    workingIndicators: [] as unknown[],
    setWorkingIndicator(indicator?: unknown): void {
      ui.workingIndicators.push(indicator);
    },
    getToolsExpanded(): boolean {
      return ui.expanded;
    },
    setToolsExpanded(value: boolean): void {
      ui.expandedCalls.push(value);
      ui.expanded = value;
    },
    notify(message: string, type?: string): void {
      ui.notifications.push({ message, type });
    },
  };
  return { ctx: { cwd, ui, sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext, ui };
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// The suite also runs inside a subagent process (BOT_LOBBY_SUBAGENT=1), where
// registration, filtering and shortcut wiring are intentionally skipped. Tests
// must observe the master path, so the ambient flag is parked for the file.
let ambientSubagent: string | undefined;
before(() => {
  ambientSubagent = process.env.BOT_LOBBY_SUBAGENT;
  delete process.env.BOT_LOBBY_SUBAGENT;
});
after(() => {
  if (ambientSubagent === undefined) delete process.env.BOT_LOBBY_SUBAGENT;
  else process.env.BOT_LOBBY_SUBAGENT = ambientSubagent;
});

function setSubagent(value: string | undefined): () => void {
  const key = "BOT_LOBBY_SUBAGENT";
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
}

test("visibleTools drops exactly the four web tools and preserves the rest", () => {
  assert.deepEqual([...WEB_TOOL_NAMES], ["web_search", "fetch_content", "source_check", "get_search_content"]);
  const active = ["read", "web_search", "bash", "fetch_content", "custom_tool", "source_check", "get_search_content", "ls"];
  assert.deepEqual(visibleTools(active), ["read", "bash", "custom_tool", "ls"]);
});

test("visibleTools preserves unknown tools, is idempotent, and handles empty input", () => {
  const once = visibleTools(["read", "web_search", "extension__tool"]);
  assert.deepEqual(once, ["read", "extension__tool"]);
  assert.deepEqual(visibleTools(once), once);
  assert.deepEqual(visibleTools([]), []);
});

test("toggleQuiet round-trips with setQuiet and isQuiet", () => {
  setQuiet(true);
  assert.equal(isQuiet(), true);
  assert.equal(toggleQuiet(), false);
  assert.equal(isQuiet(), false);
  assert.equal(toggleQuiet(), true);
  assert.equal(isQuiet(), true);
  setQuiet(true);
});

test("isSubagentProcess reads BOT_LOBBY_SUBAGENT", () => {
  const restore = setSubagent(undefined);
  try {
    assert.equal(isSubagentProcess(), false);
    process.env.BOT_LOBBY_SUBAGENT = "0";
    assert.equal(isSubagentProcess(), false);
    process.env.BOT_LOBBY_SUBAGENT = "1";
    assert.equal(isSubagentProcess(), true);
  } finally {
    restore();
  }
});

test("registerQuietTools registers only existing built-ins with renderShell self", () => {
  const fake = makePi(["read", "bash", "web_search", "custom_tool"]);
  registerQuietTools(asPi(fake));
  assert.deepEqual(fake.tools.map((tool) => tool.name).sort(), ["bash", "read"]);
  assert.ok(fake.tools.every((tool) => tool.renderShell === "self"));
  assert.ok(fake.tools.every((tool) => typeof tool.execute === "function"));
});

test("quiet tool renderers render nothing and reveal one compact summary line", () => {
  const fake = makePi(["read"]);
  registerQuietTools(asPi(fake));
  const definition = fake.tools[0]!;
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const renderContext = { args: { path: "src/a.ts" }, isError: false };
  const renderCall = definition.renderCall as unknown as Renderer;
  const renderResult = definition.renderResult as unknown as Renderer;

  setQuiet(true);
  assert.deepEqual(renderCall({ path: "src/a.ts" }, theme, renderContext).render(80), []);
  assert.deepEqual(renderResult({ content: [{ type: "text", text: "line one" }] }, { expanded: false, isPartial: false }, theme, renderContext).render(80), []);
  setQuiet(false);
  assert.equal(renderCall({ path: "src/a.ts" }, theme, renderContext).render(80)[0]!.trim(), "read src/a.ts");
  const quietResult = renderResult({ content: [{ type: "text", text: "line one" }] }, { expanded: false, isPartial: false }, theme, renderContext);
  assert.equal(quietResult.render(80)[0]!.trim(), "✓ read src/a.ts");
  setQuiet(true);
});

test("session_start registers quiet built-ins and filters the web tools", () => {
  setQuiet(true);
  const available = ["read", "bash", "grep", "web_search", "fetch_content", "source_check", "get_search_content", "custom_tool"];
  const fake = makePi(available);
  registerLifecycle(asPi(fake), ".pi");
  const { ctx, ui } = makeCtx(tempDir("dh-quiet-"));
  fake.handlers.get("session_start")!({ type: "session_start", reason: "startup" }, ctx);
  assert.deepEqual(fake.active, ["read", "bash", "grep", "custom_tool"]);
  assert.deepEqual(fake.tools.map((tool) => tool.name).sort(), ["bash", "grep", "read"]);
  assert.ok(fake.tools.every((tool) => tool.renderShell === "self"));
  assert.ok(ui.statuses.some((entry) => entry.key === STATUS_KEY && entry.text?.includes("tools hidden")));
});

test("session_start never re-adds the web tools across reloads", () => {
  setQuiet(true);
  const available = ["read", "web_search", "fetch_content", "source_check", "get_search_content"];
  const fake = makePi(available);
  registerLifecycle(asPi(fake), ".pi");
  const { ctx } = makeCtx(tempDir("dh-quiet-reload-"));
  const handler = fake.handlers.get("session_start")!;
  handler({ type: "session_start", reason: "startup" }, ctx);
  handler({ type: "session_start", reason: "reload" }, ctx);
  assert.deepEqual(fake.active, ["read"]);
  assert.equal(fake.activeCalls.length, 2);
  assert.ok(fake.activeCalls.every((call) => call.every((name) => !WEB_TOOL_NAMES.includes(name))));
});

test("a subagent process skips registration, filtering, and the reveal shortcut", () => {
  const restore = setSubagent("1");
  try {
    const available = ["read", "web_search", "fetch_content"];
    const fake = makePi(available);
    registerLifecycle(asPi(fake), ".pi");
    const { ctx } = makeCtx(tempDir("dh-quiet-sub-"));
    fake.handlers.get("session_start")!({ type: "session_start", reason: "startup" }, ctx);
    registerRevealShortcut(asPi(fake), ".pi");
    assert.equal(fake.tools.length, 0);
    assert.equal(fake.activeCalls.length, 0);
    assert.deepEqual(fake.active, available);
    assert.deepEqual(fake.shortcuts, []);
  } finally {
    restore();
  }
});

test("alt+t flips quiet, restores tool expansion, and refreshes the status", () => {
  setQuiet(true);
  const fake = makePi(["read"]);
  registerRevealShortcut(asPi(fake), ".pi");
  assert.deepEqual(fake.shortcuts, ["alt+t", "ctrl+shift+m"]);
  const { ctx, ui } = makeCtx(tempDir("dh-reveal-"), false);
  fake.shortcutHandlers["alt+t"]!(ctx);
  assert.equal(isQuiet(), false);
  assert.deepEqual(ui.expandedCalls, [true, false]);
  assert.equal(ui.expanded, false);
  assert.ok(ui.statuses.some((entry) => entry.key === STATUS_KEY && entry.text?.includes("tools shown")));
  assert.ok(ui.notifications.some((entry) => entry.message.includes("shown")));
  setQuiet(true);
});

test("session_shutdown clears the bot-lobby status", () => {
  const fake = makePi(["read"]);
  registerLifecycle(asPi(fake), ".pi");
  const { ctx, ui } = makeCtx(tempDir("dh-shutdown-"));
  fake.handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);
  assert.deepEqual(ui.statuses.at(-1), { key: STATUS_KEY, text: undefined });
});

test("ctrl+shift+m minimizes and restores the widget without touching ownership", () => {
  setMinimized(false);
  const fake = makePi(["read"]);
  registerRevealShortcut(asPi(fake), ".pi");
  const { ctx, ui } = makeCtx(tempDir("dh-minimize-"));
  fake.shortcutHandlers["ctrl+shift+m"]!(ctx);
  assert.equal(isMinimized(), true);
  assert.ok(ui.statuses.at(-1)!.text?.includes("minimized"), "the footer signals minimize");
  fake.shortcutHandlers["ctrl+shift+m"]!(ctx);
  assert.equal(isMinimized(), false);
});

function ownedProject(sessionId: string, prefix: string): string {
  const root = tempDir(prefix);
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-owned", "Owned task");
  task.ownerSessionId = sessionId;
  createTaskDir(root, ".pi", task);
  return root;
}

test("applyStatus shows the widget and task only for the owning session", () => {
  setMinimized(false);
  const root = ownedProject("session-a", "dh-owner-widget-");
  const foreign = makeCtx(root, false, "session-b");
  applyStatus(foreign.ctx, root, ".pi");
  assert.equal(foreign.ui.widgets.at(-1)!.content, undefined, "a foreign session gets no widget");
  assert.ok(!foreign.ui.statuses.at(-1)!.text?.includes("TASK-owned"), "a foreign session's footer hides the task");
  const owner = makeCtx(root, false, "session-a");
  applyStatus(owner.ctx, root, ".pi");
  assert.equal(typeof owner.ui.widgets.at(-1)!.content, "function", "the owning session gets the widget");
  assert.ok(owner.ui.statuses.at(-1)!.text?.includes("TASK-owned"));
  setMinimized(true);
  applyStatus(owner.ctx, root, ".pi");
  assert.equal(owner.ui.widgets.at(-1)!.content, undefined, "minimize hides the widget");
  assert.ok(owner.ui.statuses.at(-1)!.text?.includes("minimized"));
  setMinimized(false);
  applyStatus(owner.ctx, root, ".pi");
  assert.equal(typeof owner.ui.widgets.at(-1)!.content, "function", "restore brings the widget back");
});

test("before_agent_start injects the Master section only for the owning session", () => {
  setMinimized(false);
  const root = ownedProject("session-a", "dh-owner-section-");
  const fake = makePi(["read"]);
  registerLifecycle(asPi(fake), ".pi");
  const handler = fake.handlers.get("before_agent_start")!;
  const foreign = { systemPromptOptions: { sections: {} as Record<string, string> } };
  handler(foreign, makeCtx(root, false, "session-b").ctx);
  assert.equal(foreign.systemPromptOptions.sections["bot-lobby"], undefined);
  const owner = { systemPromptOptions: { sections: {} as Record<string, string> } };
  handler(owner, makeCtx(root, false, "session-a").ctx);
  assert.ok(owner.systemPromptOptions.sections["bot-lobby"]?.includes("TASK-owned"));
  setMinimized(true);
  const hidden = { systemPromptOptions: { sections: { "bot-lobby": "stale" } as Record<string, string> } };
  handler(hidden, makeCtx(root, false, "session-a").ctx);
  assert.equal(hidden.systemPromptOptions.sections["bot-lobby"], undefined, "minimize removes the section");
  setMinimized(false);
});

test("a subagent process never gets the widget or the Master section", () => {
  setMinimized(false);
  const restore = setSubagent("1");
  try {
    const root = ownedProject("session-a", "dh-subgate-");
    const { ctx, ui } = makeCtx(root, false, "session-a");
    applyStatus(ctx, root, ".pi");
    assert.equal(ui.widgets.at(-1)!.content, undefined);
    const fake = makePi(["read"]);
    registerLifecycle(asPi(fake), ".pi");
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
    fake.handlers.get("before_agent_start")!(event, ctx);
    assert.equal(event.systemPromptOptions.sections["bot-lobby"], undefined);
  } finally {
    restore();
  }
});

test("starting a second task in one session is refused with a clear message", async () => {
  const root = ownedProject("session-1", "dh-one-active-");
  const fake = makePi(["read"]);
  registerCommands(asPi(fake), ".pi");
  const { ctx, ui } = makeCtx(root, false, "session-1");
  await fake.commandHandlers["bot-lobby"]!("ship the redesign", ctx);
  assert.ok(ui.notifications.some((entry) => entry.message.includes("already active")), "the session is told to finish the active task");
  assert.deepEqual(listTasks(root, ".pi").map((task) => task.id), ["TASK-owned"], "no second task is created");
});

test("/bot-lobby claim reassigns an ownerless task to this session", async () => {
  const root = tempDir("dh-claim-cmd-");
  ensureProjectStructure(root, ".pi");
  createTaskDir(root, ".pi", createTask("TASK-orphan", "Orphaned task"));
  const fake = makePi(["read"]);
  registerCommands(asPi(fake), ".pi");
  const { ctx, ui } = makeCtx(root, false, "session-1");
  await fake.commandHandlers["bot-lobby"]!("claim TASK-orphan", ctx);
  assert.equal(loadTask(root, ".pi", "TASK-orphan")!.ownerSessionId, "session-1");
  assert.ok(ui.notifications.some((entry) => entry.message.includes("TASK-orphan")), "the takeover is reported");
});

test("commands registration wires alt+t through the reveal shortcut", () => {
  const fake = makePi(["read"]);
  registerCommands(asPi(fake), ".pi");
  assert.ok(fake.shortcuts.includes("alt+t"));
  assert.ok(fake.commands.includes("bot-lobby"));
});
