import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendPost, BOARD_ENV as BOARD_ENV_NAME, boardContext, boardPath, filterPosts, formatPost, readBoard, roleOf, subscriptionFor } from "../src/desk/board.ts";
import { deliveryPath, readDelivery } from "../src/desk/delivery.ts";
import { registerBoardClient } from "../src/desk/board-client.ts";
import { createDeskClient } from "../src/desk/ipc.ts";
import { DESK_ENV, DESK_TOOLS, DeskSession } from "../src/desk/session.ts";
import type { AgentHandle } from "../src/execution/agent-runner.ts";
import { AGENT_ENV, DELEGATION_ENV, type AgentPolicy } from "../src/execution/delegation.ts";
import { runPiAgent, type ProcessOutcome } from "../src/execution/pi-runner.ts";
import type { AgentRun } from "../src/schemas/findings.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import { createTask } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { chooseTrack } from "../src/workflow/track.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

function tempDir(prefix = "bl-team-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function handle(runId: string, steered: string[]): AgentHandle {
  return { runId, steer: (text) => steered.push(text), annotate: () => {} };
}

// --- the task board ---

test("the board keeps typed posts in order and each role reads what it follows", () => {
  const path = boardPath(tempDir());
  assert.deepEqual(readBoard(path), [], "a missing board is empty");
  appendPost(path, { from: "backend", kind: "contract", text: "GET /api/items returns { items: Item[], next?: string }", files: ["src/api.ts"] });
  appendPost(path, { from: "designer", kind: "note", text: "using the existing Card component" });
  appendPost(path, { from: "backend", kind: "done", text: "pagination endpoint ready" });
  writeFileSync(path, `${readFileSync(path, "utf8")}{"torn":\n`);
  const posts = readBoard(path);
  assert.deepEqual(posts.map((post) => post.seq), [1, 2, 3], "a torn line is skipped");
  assert.throws(() => appendPost(path, { from: "qa", kind: "note", text: "   " }), /needs text/);

  assert.deepEqual(filterPosts(posts, { kinds: subscriptionFor("designer") }).map((post) => post.kind), ["contract"], "builders follow contracts, not notes or done");
  assert.deepEqual(filterPosts(posts, { kinds: subscriptionFor("qa") }).map((post) => post.kind), ["contract", "done"], "QA also follows finished pieces");
  assert.deepEqual(filterPosts(posts, { after: 1, notFrom: "designer" }).map((post) => post.seq), [3]);
  assert.equal(formatPost(posts[0]!), "#1 [contract] DEV (src/api.ts): GET /api/items returns { items: Item[], next?: string }");
  assert.match(boardContext(path, "qa"), /^Task board[\s\S]*#1 \[contract\] DEV[\s\S]*#3 \[done\] DEV: pagination endpoint ready$/);
  assert.equal(boardContext(boardPath(tempDir()), "qa"), "", "nothing to say about an empty board");
});

test("contracts reach running peers at once; posts land on the board", async () => {
  const path = boardPath(tempDir());
  const session = new DeskSession({ cwd: "/repo", boardPath: path });
  await session.open();
  try {
    const toDesign: string[] = [];
    const toQa: string[] = [];
    const toDev: string[] = [];
    session.attach("designer", handle("d", toDesign));
    session.attach("qa", handle("q", toQa));
    session.attach("backend", handle("b", toDev));
    const dev = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");
    const qa = createDeskClient(session.env("qa")[DESK_ENV.address]!, "qa");
    await qa.request({ op: "claim", path: "src/auth.ts", intent: "covering the login tests" });
    const posted = await dev.request({ op: "post", kind: "contract", text: "POST /api/login takes { email, password }", files: ["src/auth.ts"] });
    assert.match(posted.text, /Posted #1\. QA was told now\./, "a post naming files reaches the holder of one");
    assert.match(toQa.at(-1)!, /^bot-lobby board: #1 \[contract\] DEV \(src\/auth\.ts\): POST \/api\/login/);
    assert.equal(toDesign.length, 0, "a worker holding none of the files is not pushed it");
    assert.equal(toDev.length, 0, "the poster is not told its own post");
    await dev.request({ op: "post", kind: "note", text: "refactored a helper" });
    assert.equal(toQa.length, 1, "notes wait on the board until someone reads it");
    assert.match((await dev.request({ op: "post", kind: "rumour", text: "x" })).text, /Unknown post kind/);
    assert.deepEqual(readBoard(path).map((post) => post.kind), ["contract", "note"]);
    dev.close();
    qa.close();
  } finally {
    await session.close();
  }
});

test("a post that lands while its reader is away reaches it on attach, never twice and never skipped", async () => {
  const path = boardPath(tempDir());
  const session = new DeskSession({ cwd: "/repo", boardPath: path });
  await session.open();
  try {
    let toDesign: string[] = [];
    session.attach("designer", handle("d", toDesign));
    session.attach("backend", handle("b", []));
    const dev = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");
    await dev.request({ op: "post", kind: "contract", text: "the token is --accent" });
    assert.match(toDesign.at(-1)!, /#1 \[contract\]/);

    // The designer goes away (a restart); a note and a blocker land with nobody to steer.
    session.release("designer", () => "");
    await dev.request({ op: "post", kind: "note", text: "routine chatter" });
    await dev.request({ op: "post", kind: "blocker", text: "waiting on the colour token" });
    // It comes back and is caught up on exactly what it missed.
    toDesign = [];
    session.attach("designer", handle("d2", toDesign));
    assert.equal(toDesign.length, 1, "only the missed blocker is sent, not the note it does not follow");
    assert.match(toDesign[0]!, /^bot-lobby board: #3 \[blocker\] DEV: waiting on the colour token$/);
    assert.equal(readDelivery(deliveryPath(path)).recipients["designer"]!.lastSeq, 3, "the cursor records what the catch-up showed");

    session.release("designer", () => "");
    session.attach("designer", handle("d3", toDesign));
    assert.equal(toDesign.length, 1, "an attach after a full catch-up steers nothing");
    dev.close();
  } finally {
    await session.close();
  }
});

test("a steer that cannot be sent is retried with the next post, and nothing is skipped", async () => {
  const path = boardPath(tempDir());
  const session = new DeskSession({ cwd: "/repo", boardPath: path });
  await session.open();
  try {
    const toDesign: string[] = [];
    let reachable = false;
    session.attach("designer", { runId: "d", steer: (text) => {
      if (!reachable) throw new Error("agent is starting up");
      toDesign.push(text);
    }, annotate: () => {} });
    session.attach("backend", handle("b", []));
    const dev = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");
    const missed = await dev.request({ op: "post", kind: "contract", text: "GET /api/items returns { items }" });
    assert.match(missed.text, /^Posted #1\.$/, "a peer that could not be told is not claimed as told");
    assert.equal(readDelivery(deliveryPath(path)).recipients["designer"], undefined, "the missed post stays undelivered");

    reachable = true;
    const next = await dev.request({ op: "post", kind: "blocker", text: "still need the shape" });
    assert.match(next.text, /DESIGN was told now\./);
    assert.equal(toDesign.length, 1);
    assert.match(toDesign[0]!, /#1 \[contract\][\s\S]*#2 \[blocker\]/, "the retry carries the missed post with the new one, oldest first");
    assert.equal(readDelivery(deliveryPath(path)).recipients["designer"]!.lastSeq, 2);
    dev.close();
  } finally {
    await session.close();
  }
});

test("posts carry stable ids, and a retried post that already landed is not posted twice", async () => {
  const path = boardPath(tempDir());
  const first = appendPost(path, { from: "backend", kind: "contract", text: "the cursor field is `next`" });
  assert.match(first.id!, /^[0-9a-f-]{36}$/, "every post gets a stable id");
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> }>();
  const failingDesk = { request: () => Promise.reject(new Error("socket hung up")), close: () => {} };
  registerBoardClient({ on: () => {}, registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never) } as never, { BOT_LOBBY_BOARD: path, BOT_LOBBY_BOARD_FROM: "backend" }, failingDesk as never);
  const again = await tools.get("post_board")!.execute("1", { kind: "contract", text: "the cursor field is `next`" });
  assert.match(again.content[0]!.text, /#1 \(already on the board\)/, "an ambiguous retry adopts the post that landed rather than duplicating it");
  assert.equal(readBoard(path).length, 1);
  const fresh = await tools.get("post_board")!.execute("2", { kind: "contract", text: "`limit` caps the page at 100" });
  assert.match(fresh.content[0]!.text, /^Posted #2\.$/, "a genuinely new post still lands");
  assert.equal(readBoard(path).length, 2);
});

test("the board tools post straight to the file without a desk and read by role", async () => {
  const path = boardPath(tempDir());
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> }>();
  const pi = { on: () => {}, registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never) };
  registerBoardClient(pi as never, { BOT_LOBBY_BOARD: path, BOT_LOBBY_BOARD_FROM: "qa" });
  assert.deepEqual([...tools.keys()].sort(), ["ack_board", "post_board", "read_board"]);
  assert.equal((await tools.get("post_board")!.execute("1", { kind: "done", text: "tests for login written" })).content[0]!.text, "Posted #1.");
  appendPost(path, { from: "backend", kind: "note", text: "renamed a variable" });
  assert.equal((await tools.get("read_board")!.execute("2", {})).content[0]!.text, "#1 [done] QA: tests for login written", "QA does not follow notes");
  assert.match((await tools.get("read_board")!.execute("3", { kinds: ["note"] })).content[0]!.text, /renamed a variable/);
  assert.equal(readDelivery(deliveryPath(path)).recipients["qa"]!.lastSeq, 2, "a read records receipt");
  assert.equal(readDelivery(deliveryPath(path)).recipients["qa"]!.handledSeq, undefined, "but never acknowledgement");
  assert.match((await tools.get("ack_board")!.execute("4", { events: [1, 7] })).content[0]!.text, /Acknowledged #1\. No board event matches: 7\./, "a stable number acknowledges, an event naming nothing is reported");
  assert.equal(readDelivery(deliveryPath(path)).recipients["qa"]!.handledSeq, 1, "only the ack moved the handled cursor");
  assert.match((await tools.get("ack_board")!.execute("5", { events: [2] })).content[0]!.text, /Not acknowledged: #2 is outside what your role follows/, "a note is not QA's business, kind or no kind");
  const none = new Map<string, unknown>();
  registerBoardClient({ on: () => {}, registerTool: (tool: { name: string }) => none.set(tool.name, tool) } as never, {});
  assert.equal(none.size, 0, "no board, no tools");
});

test("a read proves receipt of exactly what its window showed", async () => {
  const path = boardPath(tempDir());
  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> }>();
  registerBoardClient({ on: () => {}, registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never) } as never, { BOT_LOBBY_BOARD: path, BOT_LOBBY_BOARD_FROM: "qa" });
  appendPost(path, { from: "backend", kind: "contract", text: "GET /api/items" });
  appendPost(path, { from: "oracle", kind: "note", text: "for qa only", to: ["qa"] });
  appendPost(path, { from: "backend", kind: "done", text: "route ready" });
  await tools.get("read_board")!.execute("1", {});
  const read = readDelivery(deliveryPath(path)).recipients["qa"]!;
  assert.equal(read.lastSeq, 1, "the kinds filter hid the note addressed to qa, so the cursor stops below it");
  assert.deepEqual(read.seen, [3], "the post shown above the cursor is recorded out of order");
  const long = boardPath(tempDir());
  const window = new Map<string, { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> }>();
  registerBoardClient({ on: () => {}, registerTool: (tool: { name: string }) => window.set(tool.name, tool as never) } as never, { BOT_LOBBY_BOARD: long, BOT_LOBBY_BOARD_FROM: "qa" });
  for (let index = 0; index < 52; index += 1) appendPost(long, { from: "backend", kind: "contract", text: `shape ${index}` });
  const shown = await window.get("read_board")!.execute("2", {});
  assert.match(shown.content[0]!.text, /#52 \[contract\]/, "the window shows the newest fifty");
  assert.doesNotMatch(shown.content[0]!.text, /#1 \[contract\]/, "the oldest two are cut off");
  const truncated = readDelivery(deliveryPath(long)).recipients["qa"]!;
  assert.equal(truncated.lastSeq, 0, "a window that omitted relevant posts proves nothing below them");
  assert.equal(truncated.seen?.length, 50, "the fifty shown are recorded out of order instead");
});

test("a pushed post never marks the backlog it could not show as seen", async () => {
  const path = boardPath(tempDir());
  const session = new DeskSession({ cwd: "/repo", boardPath: path });
  await session.open();
  try {
    const toDesign: string[] = [];
    let reachable = false;
    session.attach("designer", { runId: "d", steer: (text: string) => { if (!reachable) throw new Error("starting up"); toDesign.push(text); }, annotate: () => {} });
    session.attach("backend", handle("b", []));
    const dev = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");
    for (let index = 0; index < 10; index += 1) await dev.request({ op: "post", kind: "contract", text: `shape ${index}` });
    assert.equal(readDelivery(deliveryPath(path)).recipients["designer"], undefined, "nothing was delivered while the designer was unreachable");
    reachable = true;
    assert.match((await dev.request({ op: "post", kind: "blocker", text: "still need the shape" })).text, /DESIGN was told now\./);
    assert.match(toDesign[0]!, /\(\+2 older board posts waiting/, "the waiting count names only what was not shown");
    const pushed = readDelivery(deliveryPath(path)).recipients["designer"]!;
    assert.equal(pushed.lastSeq, 8, "the batch proved the oldest eight");
    assert.deepEqual(pushed.seen, [11], "only the pushed post shown beyond the batch is recorded");
    session.release("designer", () => "");
    const caught: string[] = [];
    session.attach("designer", handle("d2", caught));
    assert.match(caught[0]!, /#9 \[contract\][\s\S]*#10 \[contract\]/, "the unseen backlog is caught up later, never skipped");
    dev.close();
  } finally {
    await session.close();
  }
});

test("an addressed post reaches only its targets, and acknowledgement is explicit, scope-checked and idempotent", async () => {
  const path = boardPath(tempDir());
  const session = new DeskSession({ cwd: "/repo", boardPath: path });
  await session.open();
  try {
    const toDesign: string[] = [];
    const toQa: string[] = [];
    session.attach("designer", handle("d", toDesign));
    session.attach("qa", handle("q", toQa));
    const dev = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");
    const qa = createDeskClient(session.env("qa")[DESK_ENV.address]!, "qa");
    const noted = await dev.request({ op: "post", kind: "note", text: "for design only", targets: ["DESIGN"] });
    assert.match(noted.text, /^Posted #1\. DESIGN was told now\.$/);
    assert.match(toDesign.at(-1)!, /#1 \[note\] DEV → DESIGN/);
    assert.equal(toQa.length, 0, "a note addressed to DESIGN is nobody else's, even a subscriber's");
    await dev.request({ op: "post", kind: "contract", text: "GET /api/items returns { items }" });
    assert.equal(toQa.length, 1, "an unaddressed contract reaches every subscriber at once");
    // QA cannot acknowledge the designer's note: outside its scope, and the whole call records nothing.
    const refused = await qa.request({ op: "ack", events: ["#2", 1] });
    assert.match(refused.text, /Not acknowledged: #1 is outside what your role follows\. Nothing was recorded\./);
    assert.equal(readDelivery(deliveryPath(path)).recipients["qa"]!.handledSeq, undefined);
    const acked = await qa.request({ op: "ack", events: ["#2"] });
    assert.match(acked.text, /Acknowledged #2\./);
    const again = await qa.request({ op: "ack", events: [2] });
    assert.match(again.text, /Acknowledged #2\./, "acknowledging twice records nothing new and never fails");
    assert.equal(readDelivery(deliveryPath(path)).recipients["qa"]!.handledSeq, 2);
    dev.close();
    qa.close();
  } finally {
    await session.close();
  }
});

test("a post naming files reaches the holders of those files, and only them among its subscribers", async () => {
  const path = boardPath(tempDir());
  const session = new DeskSession({ cwd: "/repo", boardPath: path });
  await session.open();
  try {
    const toDesign: string[] = [];
    const toQa: string[] = [];
    session.attach("designer", handle("d", toDesign));
    session.attach("qa", handle("q", toQa));
    const dev = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");
    const design = createDeskClient(session.env("designer")[DESK_ENV.address]!, "designer");
    await design.request({ op: "claim", path: "src/ui/Card.tsx", intent: "restyling" });
    const posted = await dev.request({ op: "post", kind: "contract", text: "GET /api/items returns { items }", files: ["src/ui/Card.tsx", "src/api.ts"] });
    assert.match(posted.text, /^Posted #1\. DESIGN was told now\.$/, "the holder of a named file is told at once");
    assert.equal(toQa.length, 0, "QA holds none of the files, so it reads the contract when it reads");
    await dev.request({ op: "post", kind: "note", text: "helper renamed", files: ["src/ui/Card.tsx"] });
    assert.equal(toDesign.length, 1, "a note about the file still waits on the board: kinds come first");
    dev.close();
    design.close();
  } finally {
    await session.close();
  }
});

// --- the settings ---

test("clean review is on by default, and the removed goal check, expert, worktrees and feature-approval settings are dropped on load", () => {
  assert.equal(resolveConfig({}).workflow.cleanReview, true);
  const old = resolveConfig({ workflow: { parallelMode: "worktrees", goalCheck: false, consultExpert: true, expertModel: "a/b", requireApprovalForFeatures: true } as never }).workflow as unknown as Record<string, unknown>;
  for (const key of ["parallelMode", "goalCheck", "consultExpert", "expertModel", "requireApprovalForFeatures"]) assert.equal(key in old, false, key);
});

// --- the engine ---

function message(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

const WORKER = ["## Completed", "Added the export button.", "", "## Files Changed", "- `export.txt` — the button", "", "## Verdict", "PASS", "", "## Verification", "- `npm test` — passing"].join("\n");

test("worker reports name the long report's file, and workers are told about the board", async () => {
  const root = tempDir();
  const long = `${WORKER}\n\n## Notes\n${"Detail line about the investigation.\n".repeat(120)}`;
  const systems: string[] = [];
  const runner: ProcessRunner = async (args) => {
    const file = args[args.indexOf("--append-system-prompt") + 1];
    systems.push(file ? readFileSync(file, "utf8") : "");
    return { exitCode: 0, stdout: message(long), stderr: "", killed: false };
  };
  const deps: WorkflowDeps = { root, configDir: ".pi", cwd: root, config: { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false } }, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess: runner };
  ensureProjectStructure(root, ".pi");
  const task = createTask("TASK-1", "task", "2026-01-01T00:00:00.000Z", "change the submit button colour to blue");
  task.track = chooseTrack("change the submit button colour to blue", undefined, { fastTrack: true }, "2026-01-01T00:00:00.000Z");
  createTaskDir(root, ".pi", task);
  transition(task, "clarifying");
  saveTask(root, ".pi", task);
  appendPost(boardPath(join(root, ".pi", "bot-lobby", "tasks", "TASK-1")), { from: "backend", kind: "contract", text: "the colour token is --accent" });
  const built = await runWorkflowAction({ action: "implement", taskId: "TASK-1", domain: "designer", task: "Step 1: make it blue" } as OrchestrateParams, deps);
  assert.equal(built.ok, true, built.message);
  const full = /Full report: (\S+)/.exec(built.message)?.[1];
  assert.ok(full && existsSync(full), built.message);
  assert.equal(readFileSync(full, "utf8").trim(), long.trim());
  assert.match(systems[0]!, /Task board: post with `post_board`/);
  assert.match(systems[0]!, /#1 \[contract\] DEV: the colour token is --accent/);
  assert.match(systems[0]!, /Long findings[\s\S]*notes/);
});
