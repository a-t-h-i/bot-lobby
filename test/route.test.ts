import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Domain } from "../src/schemas/agent.ts";
import type { TaskTriage } from "../src/schemas/task.ts";
import { chooseRoute, chooseTrack } from "../src/workflow/track.ts";
import { clearPendingRequest, pendingRequest, registerRouteTool, routeMessage, routeRequest, ROUTE_TOOL, setQuickFixHandoff, startRequest } from "../src/pi/route.ts";
import { ROUTED_LINE } from "../src/pi/start-task.ts";
import { chatText } from "../src/lobby/feed.ts";
import { peekTasks } from "../src/state/persistence.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import { parseWorkerResult, realAsks } from "../src/roles/worker.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const HOURGLASS = "create a realistic three.js single page (single file) hourglass countdown timer. It should be mobile responsive and of a high framerate. User should be able to flip the hourglass and even be able to pan, zooom and change the hourglass material. Materials need to be (water, sand, goo and coke) Use realistic physics, realistic grains of glass and realistic liquids.";

let ambientConfig: string | undefined;
before(() => {
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-route-cfg-"));
});
after(() => {
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
  setQuickFixHandoff(undefined);
});
beforeEach(() => clearPendingRequest());

test("a request one agent can do alone reads as a quick fix; a self-contained page is a quick feature, even a rich one", () => {
  const hourglass = chooseRoute(HOURGLASS, undefined);
  assert.equal(hourglass.to, "quickfix", "one file, one area: the hourglass that took the team an hour");
  assert.equal(hourglass.size, "medium");
  assert.equal(hourglass.builder, "designer", "a three.js page is frontend work");
  assert.match(hourglass.reasons[0]!, /self-contained \(single page\)/);
  assert.equal(chooseTrack(HOURGLASS, undefined, { fastTrack: true }).path, "fast", "sent to the team anyway, it skips the survey and the plan round");

  assert.equal(chooseRoute("change the submit button colour to blue", undefined).to, "quickfix");
  assert.equal(chooseRoute("return 404 instead of 500 when the user is missing", undefined).builder, "backend");
  for (const [request, why] of [
    ["add a login page", /touches frontend and backend/],
    ["show the user's last login on the profile page", /touches frontend and backend/],
    ["let users reset their password", /serious: touches password/],
    ["use the latest version of the OpenAI SDK", /needs outside facts/],
    ["make it better", /unclear/],
    ["store sessions in redis", /medium: redis/],
  ] as const) {
    const route = chooseRoute(request, undefined);
    assert.equal(route.to, "task", request);
    assert.match(route.reasons.join("; "), why, request);
  }
});

test("the classifier's one-engineer answer decides when it is sure; risk and ambiguity still go to the team", () => {
  const triage = (overrides: Partial<TaskTriage> = {}): TaskTriage => ({ size: "medium", sizeConfidence: 0.8, domains: { designer: 0.9, backend: 0.2 }, research: 0.1, ambiguous: 0.1, solo: 0.85, at: "2026-01-01T00:00:00Z", ...overrides });
  const quick = chooseRoute("add a CSV export to the reports page", triage());
  assert.equal(quick.to, "quickfix", "the classifier says one engineer can do it, though the rules would call the team");
  assert.equal(quick.source, "classifier");
  assert.equal(quick.builder, "designer");
  assert.equal(chooseRoute("change the button colour", triage({ solo: 0.2 })).to, "task");
  assert.equal(chooseRoute("change the button colour", triage({ solo: 0.5 })).to, "quickfix", "unsure: the rules decide");
  assert.match(chooseRoute("change the button colour", triage({ solo: 0.5 })).reasons.join("; "), /unsure \(0\.50\)/);
  assert.equal(chooseRoute("change the button colour", triage({ ambiguous: 0.8 })).to, "task");
  assert.equal(chooseRoute("hash the passwords with argon2", triage({ solo: 0.95 })).to, "task");
  assert.equal(chooseRoute("add a CSV export to the reports page", triage({ solo: 0.75 }), 0.8).to, "task", "the threshold is the user's");
  assert.equal(chooseRoute("fix the api", triage({ domains: { designer: 0.1, backend: 0.9 } })).builder, "backend");
});

/* ------------------------------------------------------------ the flow */

function fakes(idle = true) {
  const root = mkdtempSync(join(tmpdir(), "bl-route-"));
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

test("the oracle confirms a quick fix: the lobby hands it to the quick-fix agent and no task is made", async () => {
  const handed: Array<[string, Domain | undefined, string]> = [];
  setQuickFixHandoff((request, builder, reason) => (handed.push([request, builder, reason]), "QF-1"));
  const { root, pi, ctx, sent, tools, emit, active } = fakes(false);
  registerRouteTool(pi, ".pi");
  assert.equal(await startRequest(pi, ctx, ".pi", HOURGLASS), "routing");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.text, routeMessage(HOURGLASS, chooseRoute(HOURGLASS, undefined)));
  assert.match(sent[0]!.text, /^bot-lobby: a new request, not a task yet\.\nRequest: create a realistic/);
  assert.match(sent[0]!.text, /Read: a quick feature — self-contained \(single page\)/);
  assert.deepEqual(sent[0]!.options, { deliverAs: "followUp" }, "queued behind a busy oracle");
  assert.deepEqual(chatText("user", sent[0]!.text), [{ role: "you", text: HOURGLASS }, { role: "note", text: "reads as a quick fix · the oracle confirms where it goes" }]);

  // The tool is offered only while a request waits.
  await emit("before_agent_start");
  assert.ok(active().includes(ROUTE_TOOL));
  const tool = tools.find((entry) => entry.name === ROUTE_TOOL)!;
  const result = await tool.execute("call-1", { to: "quickfix", reason: "one file" }, undefined, undefined, ctx);
  assert.match(result.content[0]!.text, /^QF-1 is running on the lobby's Quick fix tab.*quick feature/);
  assert.deepEqual(handed, [[HOURGLASS, "designer", "one file"]], "a quick feature runs on DESIGN's settings");
  assert.equal(pendingRequest(), undefined);
  assert.deepEqual(peekTasks(root, ".pi"), [], "no task");
  await emit("before_agent_start");
  assert.ok(!active().includes(ROUTE_TOOL));
  assert.match((await routeRequest(pi, ctx, ".pi", { to: "quickfix" })).text, /No request is waiting/);
});

test("the oracle may send it to the team instead: the task starts, and the lobby shows the request once", async () => {
  setQuickFixHandoff(() => "QF-9");
  const { root, pi, ctx, sent } = fakes();
  assert.equal(await startRequest(pi, ctx, ".pi", "change the submit button colour to blue"), "routing");
  const routed = await routeRequest(pi, ctx, ".pi", { to: "task", reason: "the user wants it reviewed" });
  assert.equal(routed.ok, true, routed.text);
  assert.match(routed.text, /^Started TASK-.* as a task/);
  const tasks = peekTasks(root, ".pi");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.track!.path, "fast");
  const kickoff = sent.at(-1)!.text;
  assert.ok(kickoff.includes(ROUTED_LINE));
  assert.deepEqual(chatText("user", kickoff).map((entry) => entry.role), ["note"], "the request is already in the conversation");
});

test("a request for the team, a placed request, or no lobby starts a task at once", async () => {
  setQuickFixHandoff(() => "QF-1");
  const team = fakes();
  assert.equal(await startRequest(team.pi, team.ctx, ".pi", "add a login page"), "task");
  assert.match(team.sent[0]!.text, /^A bot-lobby task is active/);
  assert.equal(pendingRequest(), undefined);

  for (const options of [{ task: true }, { track: "fast" as const }, { track: "full" as const }]) {
    const placed = fakes();
    assert.equal(await startRequest(placed.pi, placed.ctx, ".pi", "change the submit button colour to blue", options), "task", JSON.stringify(options));
  }

  setQuickFixHandoff(undefined);
  const headless = fakes();
  assert.equal(await startRequest(headless.pi, headless.ctx, ".pi", "change the submit button colour to blue"), "task", "no lobby runs quick fixes here");
});

test("a routed job skips the 'looks like a task' hold and runs on its builder's profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-route-qf-"));
  const seen: Array<{ model?: string; thinking?: string }> = [];
  const runner: ProcessRunner = async (args) => {
    const at = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? String(args[index + 1]) : undefined; };
    seen.push({ model: at("--model"), thinking: at("--thinking") });
    return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## Done\nx" }], stopReason: "stop" } }), stderr: "", killed: false, timedOut: false };
  };
  const queue = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ model: "p/quick", thinking: "low", timeoutMs: 60_000 }), runProcess: runner });
  const job = queue.submit(HOURGLASS, Date.now(), { force: true, profile: { model: "p/design", thinking: "high", timeoutMs: 900_000 }, note: "The oracle sent your request here." });
  for (let i = 0; i < 50 && job.status !== "success"; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(job.status, "success");
  assert.equal(job.routed, true);
  assert.equal(job.model, "p/design");
  assert.equal(job.thinking, "high");
  assert.deepEqual(seen, [{ model: "p/design", thinking: "high" }]);
});

test("a worker's 'None.' under Dependencies Needed asks for nothing", () => {
  assert.deepEqual(realAsks(["None.", "none", "N/A", "No new dependencies (three.js via CDN)", "No architecture changes.", "**None**", "zod for validation", "Nonce generator package"]), ["zod for validation", "Nonce generator package"]);
  const result = parseWorkerResult("designer", ["## Completed", "x", "", "## Dependencies Needed", "- None.", "", "## Architecture Changes", "- None"].join("\n"));
  assert.deepEqual(result.dependencyNeeds, []);
  assert.deepEqual(result.architectureChanges, []);
});
