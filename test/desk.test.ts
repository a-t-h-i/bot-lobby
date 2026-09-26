import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileDesk, type DeskEvent } from "../src/desk/desk.ts";
import { createDeskClient, startDeskServer } from "../src/desk/ipc.ts";
import { autoNote, DESK_ENV, DESK_TOOLS, DeskSession, grantMessage, queueMessage } from "../src/desk/session.ts";
import { registerDeskClient } from "../src/desk/client-extension.ts";
import type { AgentHandle } from "../src/execution/agent-runner.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";

function desk(events: DeskEvent[] = []): FileDesk {
  return new FileDesk("/repo", (event) => events.push(event), () => 1000);
}

// --- desk rules ---

test("a free file is granted at once and a held one queues the claimant with its intent", () => {
  const events: DeskEvent[] = [];
  const d = desk(events);
  assert.deepEqual(d.claim("designer", "src/api.ts", "add theme prop"), { status: "granted", path: "src/api.ts", queue: [] });
  const queued = d.claim("backend", "/repo/src/api.ts", "add /health route");
  assert.equal(queued.status, "queued");
  assert.equal(queued.status === "queued" && queued.position, 1);
  assert.ok(d.holds("designer", "./src/api.ts"), "paths normalize to one key");
  assert.deepEqual(events.map((event) => event.type), ["queued", "queue"]);
  const holderView = events[1] as Extract<DeskEvent, { type: "queue" }>;
  assert.equal(holderView.to, "designer", "the holder is told who waits");
  assert.deepEqual(holderView.queue, [{ worker: "backend", intent: "add /health route" }]);
});

test("the holder always sees the whole queue in order, and re-claiming keeps one's place", () => {
  const events: DeskEvent[] = [];
  const d = desk(events);
  d.claim("designer", "a.ts", "style");
  d.claim("backend", "a.ts", "route");
  d.claim("qa", "a.ts", "tests");
  d.claim("backend", "a.ts", "route and types");
  const last = events.filter((event) => event.type === "queue").at(-1) as Extract<DeskEvent, { type: "queue" }>;
  assert.deepEqual(last.queue.map((claim) => claim.worker), ["backend", "qa"]);
  assert.deepEqual(d.heldBy("designer")[0]!.queue, [{ worker: "backend", intent: "route and types" }, { worker: "qa", intent: "tests" }]);
  assert.deepEqual(d.waitingFor("qa"), [{ path: "a.ts", holder: { worker: "designer", intent: "style" }, position: 2 }]);
});

test("handover passes the file to the head of the queue with the note, and tells them who is behind", () => {
  const events: DeskEvent[] = [];
  const d = desk(events);
  d.claim("designer", "a.ts", "style");
  d.claim("backend", "a.ts", "route");
  d.claim("qa", "a.ts", "tests");
  assert.deepEqual(d.handover("backend", "a.ts", "x"), { ok: false, path: "a.ts", error: "you do not hold a.ts (designer does)" });
  const result = d.handover("designer", "a.ts", "exported ButtonProps; keep the theme prop optional");
  assert.equal(result.ok && result.to?.worker, "backend");
  const grant = events.find((event) => event.type === "granted") as Extract<DeskEvent, { type: "granted" }>;
  assert.deepEqual(
    { to: grant.to, from: grant.from, note: grant.note, intent: grant.intent, behind: grant.queue.map((claim) => claim.worker) },
    { to: "backend", from: "designer", note: "exported ButtonProps; keep the theme prop optional", intent: "route", behind: ["qa"] },
  );
  assert.ok(d.holds("backend", "a.ts"));
  assert.equal(d.handovers().length, 1);
  assert.equal(d.handover("backend", "a.ts", "done").ok, true);
  assert.equal(d.handover("qa", "a.ts", "done").ok, true);
  assert.equal(d.holderOf("a.ts"), undefined, "the last handover frees the file");
});

test("a finishing worker hands everything over with a note written for each next worker, and leaves every queue", () => {
  const events: DeskEvent[] = [];
  const d = desk(events);
  d.claim("designer", "a.ts", "style");
  d.claim("designer", "b.ts", "layout");
  d.claim("backend", "a.ts", "route");
  d.claim("backend", "c.ts", "handler");
  d.claim("designer", "c.ts", "copy");
  const passed = d.release("designer", (path, next) => `note for ${next.worker} on ${path}: ${next.intent}`);
  assert.deepEqual(passed.map((entry) => [entry.path, entry.to, entry.note, entry.auto]), [["a.ts", "backend", "note for backend on a.ts: route", true]]);
  assert.equal(d.holderOf("b.ts"), undefined, "an unwanted file is simply freed");
  assert.deepEqual(d.heldBy("backend").map((file) => file.path).sort(), ["a.ts", "c.ts"]);
  assert.deepEqual(d.heldBy("backend").find((file) => file.path === "c.ts")!.queue, [], "the finished worker left the queue");
});

test("wait refuses while the caller owes a file, and wakes on a grant", async () => {
  const d = desk();
  d.claim("designer", "a.ts", "style");
  d.claim("backend", "b.ts", "route");
  d.claim("backend", "a.ts", "wire");
  d.claim("designer", "b.ts", "read types");
  // Each holds what the other needs: whoever waits first must hand over first.
  const refused = await d.wait("designer", 50);
  assert.deepEqual(refused.refused?.map((file) => file.path), ["a.ts"], "hand over first: breaks the deadlock");
  d.handover("designer", "a.ts", "done with styles");
  assert.deepEqual((await d.wait("backend", 50)).refused?.map((file) => file.path), ["b.ts"], "now the backend owes b.ts");
  const pending = d.wait("designer", 5000);
  d.handover("backend", "b.ts", "types exported");
  assert.equal(((await pending).grants[0] as Extract<DeskEvent, { type: "granted" }>).path, "b.ts");
  const queuedOnly = desk();
  queuedOnly.claim("designer", "c.ts", "x");
  queuedOnly.claim("qa", "c.ts", "tests");
  const woken = queuedOnly.wait("qa", 5000);
  queuedOnly.release("designer", () => "finished");
  assert.equal(((await woken).grants[0] as Extract<DeskEvent, { type: "granted" }>).note, "finished");
  assert.deepEqual((await d.wait("qa", 10)).grants, [], "nothing to wait for returns at once");
});

test("steering texts name the queue with intents and the handover note", () => {
  const queue = [{ worker: "backend", intent: "add /health route" }, { worker: "qa", intent: "failure tests" }];
  const text = queueMessage("src/api.ts", queue);
  assert.match(text, /1\) DEV — add \/health route; 2\) QA — failure tests/);
  assert.match(text, /call handover_file with a short note for DEV, who wants to: add \/health route/);
  const grant = grantMessage({ type: "granted", to: "backend", path: "src/api.ts", from: "designer", note: "exported types", intent: "add route", queue: [queue[1]!] });
  assert.match(grant, /`src\/api.ts` is yours now \(for: add route\)\. DESIGN's handover note: exported types\. Re-read/);
  assert.match(grant, /Queued behind you: 1\) QA — failure tests/);
  assert.match(autoNote("designer", "src/api.ts", queue[0]!, [{ path: "src/api.ts", change: "added theme prop" }], ""), /^DESIGN changed it: added theme prop \(auto-handover on finish; you asked for: add \/health route\)$/);
});

// --- transport and session ---

test("the socket carries requests both ways and a closed desk fails requests instead of hanging", async () => {
  const server = await startDeskServer(async (request) => ({ ok: true, text: `${request.worker}:${request.op}:${request.path ?? ""}` }));
  const client = createDeskClient(server.address, "backend");
  assert.deepEqual(await client.request({ op: "claim", path: "a.ts" }), { id: 1, ok: true, text: "backend:claim:a.ts" });
  await server.close();
  const after = await client.request({ op: "mine" }, 1000);
  assert.equal(after.ok, false);
  client.close();
});

function handle(runId: string, steered: string[], notes: object[]): AgentHandle {
  return { runId, steer: (text) => steered.push(text), annotate: (patch) => notes.push(patch) };
}

test("the session steers holders and receivers and annotates the panel", async () => {
  const session = new DeskSession({ cwd: "/repo" });
  await session.open();
  try {
    const steerDesign: string[] = [];
    const steerDev: string[] = [];
    const devNotes: object[] = [];
    session.attach("designer", handle("d", steerDesign, []));
    session.attach("backend", handle("b", steerDev, devNotes));
    const design = createDeskClient(session.env("designer")[DESK_ENV.address]!, "designer");
    const dev = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");
    assert.match((await dev.request({ op: "check", path: "src/api.ts" })).text, /Claim `src\/api.ts` first/);
    assert.match((await design.request({ op: "claim", path: "src/api.ts", intent: "theme prop" })).text, /is yours/);
    assert.equal((await design.request({ op: "check", path: "src/api.ts" })).allowed, true);
    assert.match((await dev.request({ op: "claim", path: "src/api.ts", intent: "health route" })).text, /with DESIGN \(theme prop\); you are #1 in line/);
    assert.match(steerDesign.at(-1)!, /queue for `src\/api.ts` \(you hold it\): 1\) DEV — health route/);
    assert.match((await design.request({ op: "mine" })).text, /waiting: 1\) DEV — health route/);
    assert.match((await design.request({ op: "handover", path: "src/api.ts", note: "props exported" })).text, /handed to DEV/);
    assert.match(steerDev.at(-1)!, /is yours now \(for: health route\)\. DESIGN's handover note: props exported/);
    assert.ok(devNotes.some((patch) => JSON.stringify(patch).includes("got api.ts from DESIGN")));
    assert.equal(session.handovers().length, 1);
    await design.request({ op: "hello" });
    assert.ok(session.greetedBy("designer") && !session.greetedBy("qa"));
    design.close();
    dev.close();
  } finally {
    await session.close();
  }
});

test("the worker-side extension blocks unclaimed edits and registers the desk tools", async () => {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> }>();
  const pi = {
    on: (name: string, fn: (event: unknown) => unknown) => handlers.set(name, fn),
    registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never),
  };
  const answers: Record<string, { ok: boolean; text: string; allowed?: boolean }> = {
    check: { ok: true, allowed: false, text: "claim it first" },
    claim: { ok: true, text: "yours" },
  };
  const seen: string[] = [];
  const client = {
    request: async (request: { op: string }) => {
      seen.push(request.op);
      return { id: 0, ...(answers[request.op] ?? { ok: true, text: request.op }) };
    },
    close: () => {},
  };
  registerDeskClient(pi as never, client);
  assert.deepEqual([...tools.keys()].sort(), [...DESK_TOOLS].sort());
  const toolCall = handlers.get("tool_call")!;
  assert.deepEqual(await toolCall({ toolName: "edit", input: { path: "a.ts" } }), { block: true, reason: "claim it first" });
  assert.equal(await toolCall({ toolName: "read", input: { path: "a.ts" } }), undefined, "reads are free");
  answers.check = { ok: true, allowed: true, text: "" };
  assert.equal(await toolCall({ toolName: "write", input: { path: "a.ts" } }), undefined);
  answers.check = { ok: false, text: "the file desk is unavailable" };
  assert.equal(await toolCall({ toolName: "edit", input: { path: "a.ts" } }), undefined, "a vanished desk never wedges the worker");
  const claimed = await tools.get("claim_file")!.execute("id", { path: "a.ts", intent: "x" });
  assert.equal(claimed.content[0]!.text, "yours");
  assert.ok(seen.includes("claim"));
});

// --- parallel implement end to end with fake workers talking to the real desk ---

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning"];

test("implement with assignments runs domains in parallel and hands shared files over through the desk", async () => {
  const root = mkdtempSync(join(tmpdir(), "dh-desk-"));
  let active = 0;
  let peak = 0;
  const seenTools: string[] = [];
  // DESIGN claims api.ts first; DEV queues behind it; DESIGN finishes without a manual handover,
  // so the desk hands the file to DEV automatically with a note built from DESIGN's report.
  let designHolds!: () => void;
  const designHasFile = new Promise<void>((done) => (designHolds = done));
  const runProcess: ProcessRunner = async (args, options) => {
    active += 1;
    peak = Math.max(peak, active);
    seenTools.push(args[args.indexOf("--tools") + 1]!);
    const worker = options.env![DESK_ENV.worker]!;
    const client = createDeskClient(options.env![DESK_ENV.address]!, worker);
    await client.request({ op: "hello" });
    let report: string;
    if (worker === "designer") {
      await client.request({ op: "claim", path: "src/api.ts", intent: "add theme prop" });
      designHolds();
      await new Promise((done) => setTimeout(done, 50));
      report = "## Completed\nstyled\n\n## Files Changed\n- `src/api.ts` — added theme prop\n\n## Verification\n- `npm test` — ok";
    } else {
      await designHasFile;
      const queued = await client.request({ op: "claim", path: "src/api.ts", intent: "add /health route" });
      assert.match(queued.text, /you are #1 in line/);
      const waited = await client.request({ op: "wait", timeoutMs: 5000 }, 10_000);
      assert.match(waited.text, /DESIGN's handover note: DESIGN changed it: added theme prop/);
      report = "## Completed\nroute\n\n## Files Changed\n- `src/api.ts` — added /health\n\n## Verification\n- `npm test` — ok";
    }
    client.close();
    active -= 1;
    return { exitCode: 0, stdout: reply(report), stderr: "", killed: false, timedOut: false };
  };
  const deps: WorkflowDeps = {
    root,
    configDir: ".pi",
    cwd: root,
    config: DEFAULT_CONFIG,
    ask: async () => undefined,
    choose: async () => undefined,
    notify: () => {},
    runProcess,
  };
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-1", "health badge");
  createTaskDir(root, ".pi", task);
  for (const step of FLOW) transition(task, step);
  task.plan = "## Steps\n1. Theme\n2. Route";
  saveTask(root, ".pi", task);
  const result = await runWorkflowAction(
    {
      action: "implement",
      taskId: "TASK-1",
      assignments: [
        { domain: "designer", task: "Step 1: theme prop" },
        { domain: "backend", task: "Step 2: health route" },
      ],
    } as OrchestrateParams,
    deps,
  );
  assert.equal(result.ok, true, result.message);
  assert.equal(peak, 2, "both workers ran at once");
  assert.ok(seenTools.every((tools) => tools.includes("claim_file") && tools.includes("handover_file")));
  assert.match(result.message, /Parallel batch: designer, backend\./);
  assert.match(result.message, /File handovers:\n- src\/api.ts: designer → backend \(on finish\)/);
  assert.ok(!result.message.includes("not enforced"));
  const saved = loadTask(root, ".pi", "TASK-1")!;
  assert.equal(saved.state, "implementing");
  assert.deepEqual(saved.workerRuns?.map((run) => run.domain).sort(), ["backend", "designer"]);
  assert.deepEqual([...saved.domains].sort(), ["backend", "designer"]);
});

test("parallel assignments reject a repeated domain", async () => {
  const root = mkdtempSync(join(tmpdir(), "dh-desk-dup-"));
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-1", "x");
  createTaskDir(root, ".pi", task);
  for (const step of FLOW) transition(task, step);
  saveTask(root, ".pi", task);
  const result = await runWorkflowAction(
    { action: "implement", taskId: "TASK-1", assignments: [{ domain: "backend", task: "a" }, { domain: "backend", task: "b" }] } as OrchestrateParams,
    { root, configDir: ".pi", cwd: root, config: DEFAULT_CONFIG, ask: async () => undefined, choose: async () => undefined, notify: () => {} },
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /distinct domains/);
});
