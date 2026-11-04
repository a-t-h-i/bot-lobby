import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { chooseTrack } from "../src/workflow/track.ts";
import { startTask } from "../src/pi/start-task.ts";
import { taskName } from "../src/text.ts";
import { chatText } from "../src/lobby/feed.ts";
import { peekTasks } from "../src/state/persistence.ts";
import { parseWorkerResult, realAsks } from "../src/roles/worker.ts";

const HOURGLASS = "create a realistic three.js single page (single file) hourglass countdown timer. It should be mobile responsive and of a high framerate. User should be able to flip the hourglass and even be able to pan, zooom and change the hourglass material. Materials need to be (water, sand, goo and coke) Use realistic physics, realistic grains of glass and realistic liquids.";

let ambientConfig: string | undefined;
before(() => {
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-route-cfg-"));
});
after(() => {
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
});

test("a self-contained page takes the fast track, even a rich one", () => {
  assert.equal(chooseTrack(HOURGLASS, undefined, { fastTrack: true }).path, "fast", "it skips the survey and the plan round");
});

/* ------------------------------------------------------------ the flow */

function fakes(idle = true) {
  const root = mkdtempSync(join(tmpdir(), "bl-route-"));
  mkdirSync(join(root, ".pi"));
  const sent: Array<{ text: string; options?: unknown }> = [];
  const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
  const tools: Array<{ name: string; execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> }> = [];
  let active = ["read", "orchestrate"];
  const pi = {
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: (typeof tools)[number]) {
      tools.push(tool);
    },
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
    sendUserMessage(text: string, options?: unknown) {
      sent.push({ text, options });
    },
    getSessionName: () => "window",
    setSessionName: () => {},
    appendEntry: () => {},
    setThinkingLevel: () => {},
  } as unknown as ExtensionAPI;
  const notices: string[] = [];
  const ctx = {
    cwd: root,
    hasUI: false,
    isIdle: () => idle,
    sessionManager: { getSessionId: () => "session-1" },
    ui: new Proxy({ notify: (text: string) => notices.push(text) } as Record<string, unknown>, { get: (target, key: string) => target[key] ?? (() => undefined) }),
  } as unknown as ExtensionContext;
  const emit = async (event: string) => {
    for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
  };
  return { root, pi, ctx, sent, tools, emit, active: () => active, notices };
}

test("a request starts a task at once, and the lobby shows the request under the task's note", async () => {
  const { root, pi, ctx, sent } = fakes();
  const task = await startTask(pi, ctx, ".pi", "add a login page", { triaged: true, isolation: "off" });
  assert.ok(task);
  assert.equal(peekTasks(root, ".pi").length, 1);
  const kickoff = sent.at(-1)!.text;
  assert.match(kickoff, /^A bot-lobby task is active/);
  assert.deepEqual(chatText("user", kickoff).map((entry) => [entry.role, entry.text]), [["note", `task started · ${task!.title}`], ["you", "add a login page"]]);
});

test("starting a task uses its gist for title, ID and session without changing the request", async () => {
  const { root, pi, ctx } = fakes();
  const request = "I was looking at the lobby. Task names should reflect the goal, not the opening words.";
  let calls = 0;
  let name = taskName(request);
  pi.getSessionName = () => name;
  pi.setSessionName = (value) => { name = value; };
  ctx.model = { id: "test", provider: "test" } as NonNullable<ExtensionContext["model"]>;
  ctx.modelRegistry = { streamSimple: () => {
    calls += 1;
    return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "Improve task naming" }] }) };
  } } as unknown as ExtensionContext["modelRegistry"];
  const task = await startTask(pi, ctx, ".pi", request, { triaged: true, isolation: "off" });
  assert.equal(task?.title, "Improve task naming");
  assert.equal(task?.id, taskName("Improve task naming"));
  assert.equal(name, task?.id);
  assert.equal(peekTasks(root, ".pi")[0]?.request, request);
  assert.equal(calls, 1);
});

test("a task started while naming is pending prevents a duplicate owned task", async () => {
  const { root, pi, ctx } = fakes();
  let finish!: (reply: unknown) => void;
  ctx.model = { id: "test", provider: "test" } as NonNullable<ExtensionContext["model"]>;
  ctx.modelRegistry = { streamSimple: () => ({ result: () => new Promise((resolve) => { finish = resolve; }) }) } as unknown as ExtensionContext["modelRegistry"];
  const pending = startTask(pi, ctx, ".pi", "first request", { triaged: true, isolation: "off" });
  const task = await startTask(pi, ctx, ".pi", "second request", { title: "Explicit title", triaged: true, isolation: "off" });
  finish({ stopReason: "stop", content: [{ type: "text", text: "First task" }] });
  assert.equal(await pending, undefined);
  assert.equal(peekTasks(root, ".pi").length, 1);
  assert.equal(peekTasks(root, ".pi")[0]?.id, task?.id);
});

test("an explicit task title bypasses generation and preserves an intentional session name", async () => {
  const { pi, ctx } = fakes();
  ctx.modelRegistry = { streamSimple: () => { throw new Error("must not be called"); } } as unknown as ExtensionContext["modelRegistry"];
  const task = await startTask(pi, ctx, ".pi", "the full agreed plan", { title: "Export report CSV", triaged: true, isolation: "off" });
  assert.equal(task?.title, "Export report CSV");
  assert.equal(task?.id, taskName("Export report CSV"));
  assert.equal(pi.getSessionName(), "window");
});

test("a worker's 'None.' under Dependencies Needed asks for nothing", () => {
  assert.deepEqual(realAsks(["None.", "none", "N/A", "No new dependencies (three.js via CDN)", "No architecture changes.", "**None**", "zod for validation", "Nonce generator package"]), ["zod for validation", "Nonce generator package"]);
  const result = parseWorkerResult("designer", ["## Completed", "x", "", "## Dependencies Needed", "- None.", "", "## Architecture Changes", "- None"].join("\n"));
  assert.deepEqual(result.dependencyNeeds, []);
  assert.deepEqual(result.architectureChanges, []);
});
