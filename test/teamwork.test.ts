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
import { DESK_ENV, DESK_TOOLS, DeskSession, PEER_TOOLS, peerId } from "../src/desk/session.ts";
import type { AgentHandle } from "../src/execution/agent-runner.ts";
import { AGENT_ENV, canConsult, DELEGATION_ENV, type AgentPolicy } from "../src/execution/delegation.ts";
import { runPiAgent, type ProcessOutcome } from "../src/execution/pi-runner.ts";
import type { AgentRun } from "../src/schemas/findings.ts";
import { closeWorkerTrees, mapToTop, mergeWorkerTrees, openWorkerTrees, snapshotTree } from "../src/execution/worker-trees.ts";
import { parseGoalCheck } from "../src/master/goal-check.ts";
import { DEFAULT_CONFIG, expertProfile, resolveConfig } from "../src/schemas/configuration.ts";
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
  const session = new DeskSession({ cwd: "/repo", boardPath: path, peers: true });
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
  const session = new DeskSession({ cwd: "/repo", boardPath: path, peers: true });
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
  const session = new DeskSession({ cwd: "/repo", boardPath: path, peers: true });
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

test("workers in a batch can ask each other questions, never wait on each other in a cycle, and time out", async () => {
  const path = boardPath(tempDir());
  const session = new DeskSession({ cwd: "/repo", boardPath: path, peers: true });
  await session.open();
  try {
    const toDesign: string[] = [];
    const toDev: string[] = [];
    session.attach("designer", handle("d", toDesign));
    session.attach("backend", handle("b", toDev));
    const design = createDeskClient(session.env("designer")[DESK_ENV.address]!, "designer");
    const dev = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");

    const asked = design.request({ op: "ask", to: "DEV", text: "Is the cursor field called next or cursor?", timeoutMs: 10_000 }, 15_000);
    while (toDev.length === 0) await new Promise((done) => setTimeout(done, 5));
    assert.match(toDev[0]!, /question #1 from DESIGN: Is the cursor field called next or cursor\? Answer it now with answer_peer \(id 1\)/);
    // While DESIGN waits on DEV, DEV asking DESIGN back would deadlock both: it is refused.
    assert.match((await dev.request({ op: "ask", to: "designer", text: "which page?" })).text, /DESIGN is waiting on your answer to its question #1/);
    assert.match((await design.request({ op: "answer", questionId: 1, text: "x" })).text, /no open question #1 for you/, "only the one asked answers");
    assert.match((await dev.request({ op: "answer", questionId: 1, text: "It is `next`, a string." })).text, /Answer sent to DESIGN/);
    assert.equal((await asked).text, "DEV answers: It is `next`, a string.");
    assert.match(readBoard(path).at(-1)!.text, /^Asked DEV: Is the cursor field called next or cursor\? Answer: It is `next`, a string\.$/, "the exchange is on the board for the oracle");

    assert.match((await dev.request({ op: "ask", to: "QA", text: "ready?" })).text, /QA is not working right now/);
    assert.match((await dev.request({ op: "ask", to: "DEV", text: "me?" })).text, /That is you/);
    const silent = await dev.request({ op: "ask", to: "DESIGN", text: "which breakpoint?", timeoutMs: 5000 }, 10_000);
    assert.match(silent.text, /DESIGN did not answer within 5 seconds/);
    design.close();
    dev.close();
  } finally {
    await session.close();
  }
});

test("a finished worker's open questions are released, and a desk without peers refuses questions", async () => {
  const session = new DeskSession({ cwd: "/repo", peers: true });
  await session.open();
  try {
    session.attach("designer", handle("d", []));
    session.attach("backend", handle("b", []));
    const design = createDeskClient(session.env("designer")[DESK_ENV.address]!, "designer");
    const asked = design.request({ op: "ask", to: "backend", text: "done yet?", timeoutMs: 60_000 }, 65_000);
    await new Promise((done) => setTimeout(done, 20));
    session.release("backend", () => "");
    assert.match((await asked).text, /DEV did not answer/);
    design.close();
  } finally {
    await session.close();
  }
  const lone = new DeskSession({ cwd: "/repo" });
  await lone.open();
  try {
    const client = createDeskClient(lone.env("backend")[DESK_ENV.address]!, "backend");
    assert.match((await client.request({ op: "ask", to: "DESIGN", text: "x" })).text, /No peers work alongside you/);
    assert.deepEqual(lone.tools(), DESK_TOOLS);
    client.close();
  } finally {
    await lone.close();
  }
  assert.equal(peerId("Dev"), "backend");
  assert.equal(peerId("DESIGN"), "designer");
});

test("a desk for workers with their own checkouts lets every edit through and offers questions only", async () => {
  const session = new DeskSession({ cwd: "/repo", claims: false, peers: true });
  await session.open();
  try {
    const client = createDeskClient(session.env("backend")[DESK_ENV.address]!, "backend");
    assert.equal((await client.request({ op: "check", path: "src/api.ts" })).allowed, true);
    assert.deepEqual(session.tools(), PEER_TOOLS);
    client.close();
  } finally {
    await session.close();
  }
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
  const session = new DeskSession({ cwd: "/repo", boardPath: path, peers: true });
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
  const session = new DeskSession({ cwd: "/repo", boardPath: path, peers: true });
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
  const session = new DeskSession({ cwd: "/repo", boardPath: path, peers: true });
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

// --- the goal check ---

test("the goal check's report reads as met, not met with its gaps, or unread", () => {
  assert.deepEqual(parseGoalCheck("## Verdict\nMET\n\n## Requirements\n- blue button — met — src/b.css:3\n\n## Gaps\n- none"), { verdict: "met", gaps: [] });
  assert.deepEqual(parseGoalCheck("## Verdict\nNOT MET\n\n## Requirements\n- x — not met — y\n\n## Gaps\n- the export button the user asked for is missing\n- dates are not shown in UTC"), {
    verdict: "not_met",
    gaps: ["the export button the user asked for is missing", "dates are not shown in UTC"],
  });
  assert.deepEqual(parseGoalCheck("## Verdict\nNOT MET\n\n## Requirements\n- export to CSV — not met — no route\n- keep the header — met — a.ts:1"), { verdict: "not_met", gaps: ["export to CSV — not met — no route"] }, "the requirements list stands in for missing gaps");
  assert.equal(parseGoalCheck("Looks fine to me.").verdict, "unread");
  for (const said of ["## Verdict\nNOT-MET", "## Verdict\nNOT_MET", "## Verdict\nUNMET", "## Verdict\nPARTIALLY MET", "## Verdict\nMET, except the CSV option", "**Verdict:** NOT MET", "# Verdict: MOSTLY MET", "### Verdict\nMET\n\n### Gaps\n- dates are not in UTC"]) {
    assert.equal(parseGoalCheck(said).verdict, "not_met", said);
  }
  for (const said of ["**Verdict:** MET", "# Verdict\nMET.", "## Verdict: MET\n\n## Gaps\n- none"]) assert.equal(parseGoalCheck(said).verdict, "met", said);
  assert.equal(parseGoalCheck("## Verdict\nMET or NOT MET").verdict, "unread", "the format line copied back says nothing");
});

// --- the expert and the settings ---

test("only a task's DESIGN and DEV workers consult the expert, and the settings default to the new ways of working", () => {
  assert.equal(canConsult({ runId: "r", taskId: "T", role: "worker", domain: "backend" }, true), true);
  assert.equal(canConsult({ runId: "r", taskId: "T", role: "worker", domain: "designer", depth: 2 }, true), false, "children do not");
  assert.equal(canConsult({ runId: "T", taskId: "T", role: "worker", domain: "backend" }, true), false, "a lobby chat reply does not");
  assert.equal(canConsult({ runId: "r", taskId: "T", role: "reviewer", domain: "qa" }, true), false);
  assert.equal(canConsult({ runId: "r", taskId: "T", role: "worker", domain: "backend" }, false), false);
  const config = resolveConfig({});
  assert.equal(config.workflow.parallelMode, "desk");
  assert.equal(config.workflow.cleanReview, true);
  assert.equal(config.workflow.goalCheck, true);
  assert.equal(config.workflow.consultExpert, true);
  assert.equal(resolveConfig({ workflow: { parallelMode: "swarm" } }).workflow.parallelMode, "desk");
  assert.equal(resolveConfig({ workflow: { parallelMode: "worktrees", goalCheck: false } }).workflow.goalCheck, false);
  assert.deepEqual(expertProfile(config), { thinking: "high" }, "the oracle's model, inherited");
  assert.deepEqual(expertProfile(resolveConfig({ master: { model: "anthropic/big" } })), { model: "anthropic/big", thinking: "high" });
  assert.deepEqual(expertProfile(resolveConfig({ master: { model: "anthropic/big" }, workflow: { expertModel: "openai/bigger" } })), { model: "openai/bigger", thinking: "high" });
});

// --- a worktree per worker ---

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

function repo(): string {
  const dir = tempDir("bl-repo-");
  gitIn(dir, "init", "-q");
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(dir, "b.txt"), "alpha\n");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-qm", "init");
  return dir;
}

test("each worker gets a checkout of the tree as it stands, and disjoint changes merge back", async () => {
  const top = repo();
  writeFileSync(join(top, "a.txt"), "one\ntwo\nthree\nfour\n");
  writeFileSync(join(top, "new.txt"), "untracked work in progress\n");
  mkdirSync(join(top, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(top, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  const indexBefore = gitIn(top, "diff", "--cached", "--name-only");

  const batch = await openWorkerTrees(top, ["backend", "designer"]);
  assert.ok(typeof batch !== "string", String(batch));
  try {
    const dev = batch.trees.get("backend")!;
    const design = batch.trees.get("designer")!;
    assert.equal(readFileSync(join(dev.dir, "a.txt"), "utf8"), "one\ntwo\nthree\nfour\n", "uncommitted changes are in the checkout");
    assert.equal(readFileSync(join(dev.dir, "new.txt"), "utf8"), "untracked work in progress\n", "so are untracked files");
    assert.ok(lstatSync(join(dev.dir, "node_modules")).isSymbolicLink(), "ignored folders are borrowed, so the worker can build and test");
    assert.equal(readFileSync(join(dev.dir, "node_modules", "dep", "index.js"), "utf8"), "module.exports = 1;\n");

    writeFileSync(join(dev.dir, "b.txt"), "alpha\nbeta\n");
    writeFileSync(join(dev.dir, "api.txt"), "GET /items\n");
    writeFileSync(join(design.dir, "a.txt"), "ONE\ntwo\nthree\nfour\n");
    assert.equal(readFileSync(join(top, "b.txt"), "utf8"), "alpha\n", "the task's tree is untouched while they work");

    const results = await mergeWorkerTrees(batch, ["backend", "designer"], join(tempDir(), "patches"));
    assert.deepEqual(results.map((entry) => entry.status), ["applied", "applied"]);
    assert.equal(readFileSync(join(top, "b.txt"), "utf8"), "alpha\nbeta\n");
    assert.equal(readFileSync(join(top, "api.txt"), "utf8"), "GET /items\n");
    assert.equal(readFileSync(join(top, "a.txt"), "utf8"), "ONE\ntwo\nthree\nfour\n");
    assert.ok(lstatSync(join(top, "node_modules")).isDirectory() && !lstatSync(join(top, "node_modules")).isSymbolicLink(), "the borrowed folder never comes back as a change");
    assert.equal(gitIn(top, "diff", "--cached", "--name-only"), indexBefore, "the user's index is never touched");
    assert.equal(mapToTop(batch, "backend", join(dev.dir, "b.txt")), join(top, "b.txt"));
    assert.equal(mapToTop(batch, "backend", "/elsewhere/x.txt"), "/elsewhere/x.txt");
  } finally {
    await closeWorkerTrees(batch);
  }
  assert.equal(existsSync(batch.home), false, "the worktrees are removed");
  assert.ok(existsSync(join(top, "node_modules", "dep", "index.js")), "and the borrowed folder survives their removal");
  assert.equal(gitIn(top, "worktree", "list").split("\n").length, 1, "only the main checkout is left");
});

test("a worker's change that clashes with an earlier one is kept as a patch, never half-applied", async () => {
  const top = repo();
  const batch = await openWorkerTrees(top, ["backend", "designer", "qa"]);
  assert.ok(typeof batch !== "string", String(batch));
  const patches = join(tempDir(), "patches");
  try {
    writeFileSync(join(batch.trees.get("backend")!.dir, "a.txt"), "one\nTWO (dev)\nthree\n");
    writeFileSync(join(batch.trees.get("designer")!.dir, "a.txt"), "one\nTWO (design)\nthree\n");
    writeFileSync(join(batch.trees.get("designer")!.dir, "b.txt"), "alpha (design)\n");
    const results = await mergeWorkerTrees(batch, ["backend", "designer", "qa"], patches);
    assert.deepEqual(results.map((entry) => entry.status), ["applied", "conflict", "empty"]);
    const conflict = results[1]!;
    assert.ok(conflict.status === "conflict" && existsSync(conflict.patch));
    assert.equal(readFileSync(join(top, "a.txt"), "utf8"), "one\nTWO (dev)\nthree\n");
    assert.equal(readFileSync(join(top, "b.txt"), "utf8"), "alpha\n", "none of the clashing worker's change is applied");
  } finally {
    await closeWorkerTrees(batch);
  }
  assert.equal(await openWorkerTrees(tempDir(), ["backend"]), "this folder is not a git repository");
  assert.match(await snapshotTree(top), /^[0-9a-f]{40}$/);
});

test("a clashing change is also kept as a git ref, staged borrowed folders never come back, and a nested repository is refused", async () => {
  const top = repo();
  mkdirSync(join(top, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(top, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  const batch = await openWorkerTrees(top, ["backend", "designer", "qa"]);
  assert.ok(typeof batch !== "string", String(batch));
  try {
    const dev = batch.trees.get("backend")!;
    const design = batch.trees.get("designer")!;
    const qa = batch.trees.get("qa")!;
    // DEV stages everything itself, the borrowed folder included, and commits.
    writeFileSync(join(dev.dir, "a.txt"), "one\nTWO (dev)\nthree\n");
    gitIn(dev.dir, "add", "-A", "-f");
    gitIn(dev.dir, "commit", "-qm", "dev work");
    writeFileSync(join(design.dir, "a.txt"), "one\nTWO (design)\nthree\n");
    mkdirSync(join(qa.dir, "newpkg"));
    writeFileSync(join(qa.dir, "newpkg", "index.js"), "export {};\n");
    gitIn(join(qa.dir, "newpkg"), "init", "-q");
    gitIn(join(qa.dir, "newpkg"), "add", "-A");
    gitIn(join(qa.dir, "newpkg"), "commit", "-qm", "nested");

    const results = await mergeWorkerTrees(batch, ["backend", "designer", "qa"], join(tempDir(), "patches"));
    assert.deepEqual(results.map((entry) => entry.status), ["applied", "conflict", "conflict"]);
    assert.equal(readFileSync(join(top, "a.txt"), "utf8"), "one\nTWO (dev)\nthree\n");
    assert.ok(lstatSync(join(top, "node_modules")).isDirectory() && !lstatSync(join(top, "node_modules")).isSymbolicLink());
    assert.ok(existsSync(join(top, "node_modules", "dep", "index.js")));
    const clash = results[1]!;
    assert.ok(clash.status === "conflict" && clash.saved.startsWith("refs/bot-lobby/designer-"));
    assert.match(gitIn(top, "show", `${clash.saved}:a.txt`), /TWO \(design\)/, "the ref holds the change");
    const nested = results[2]!;
    assert.ok(nested.status === "conflict" && /nested git repository \(newpkg\)/.test(nested.reason));
    assert.equal(existsSync(join(top, "newpkg")), false, "no empty folder stands in for it");
    assert.equal(qa.keep, true);
  } finally {
    await closeWorkerTrees(batch);
  }
  const qaDir = batch.trees.get("qa")!.dir;
  assert.ok(existsSync(join(qaDir, "newpkg", "index.js")), "the worktree holding the nested repository is kept");
  assert.equal(existsSync(join(batch.trees.get("backend")!.dir)), false);
  assert.ok(existsSync(join(top, "node_modules", "dep", "index.js")));
});

test("worktree mode is not used when the task's folder lies inside a borrowed folder, and a new task folder exists in each checkout", async () => {
  const top = repo();
  mkdirSync(join(top, "node_modules", "dep"), { recursive: true });
  assert.match(String(await openWorkerTrees(join(top, "node_modules", "dep"), ["backend"])), /inside the ignored folder node_modules/);
  mkdirSync(join(top, "fresh"));
  const batch = await openWorkerTrees(join(top, "fresh"), ["backend"]);
  assert.ok(typeof batch !== "string", String(batch));
  try {
    assert.ok(existsSync(batch.trees.get("backend")!.cwd));
  } finally {
    await closeWorkerTrees(batch);
  }
});

test("an expert consult runs on the oracle's model, reports once when it fails, does not count a failure, and its limit holds across retries", async () => {
  process.env.BOT_LOBBY_CONFIG_DIR ??= tempDir("bl-cfg-");
  const cwd = tempDir();
  mkdirSync(join(cwd, ".pi"));
  const reply = (text: string): ProcessOutcome => ({ exitCode: 0, killed: false, stderr: "", stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], usage: { input: 10, output: 5, cost: { total: 0.01 } } } }) });
  const updates: AgentRun[] = [];
  const expertArgs: string[][] = [];
  const expertEnv: Record<string, string>[] = [];
  let expertFails = true;
  const answers: string[] = [];
  const runner: ProcessRunner = async (args, options) => {
    const policy = JSON.parse(options.env![AGENT_ENV]!) as AgentPolicy;
    if (policy.depth === 2) {
      expertArgs.push(args);
      expertEnv.push(options.env!);
      return expertFails ? { exitCode: 1, killed: false, stderr: "boom", stdout: "" } : reply("Use a binary search.");
    }
    const target = JSON.parse(options.env![DELEGATION_ENV]!) as { address: string; token: string };
    const client = createDeskClient(target.address, target.token);
    try {
      for (let index = 0; index < 3; index++) {
        const answer = await client.request({ op: "consult", text: "how do I find the bad commit?" }, 60_000);
        answers.push(`${answer.ok}:${answer.text}`);
      }
    } finally {
      client.close();
    }
    return reply("done");
  };
  const quota = { used: 0 };
  const options = { cwd, task: "Step 1: find the regression", tools: ["read", "edit", "write"], delegationQuota: quota, expert: { model: "anthropic/oracle-model", thinking: "high" }, env: { [BOARD_ENV_NAME]: "/x/board.jsonl", KEEP: "1" }, agent: { runId: "w1", taskId: "TASK-1", domain: "backend" as const, role: "worker" as const }, onChildRun: (run: AgentRun) => updates.push(run) };

  await runPiAgent(options, runner);
  assert.ok(answers.every((answer) => answer.startsWith("false:The expert did not answer")), answers.join("\n"));
  assert.equal(expertArgs.length, 3, "a failed consult does not use one up");
  assert.ok(expertArgs[0]!.join(" ").includes("--model anthropic/oracle-model"), expertArgs[0]!.join(" "));
  assert.equal(expertEnv[0]![BOARD_ENV_NAME], undefined, "the expert is not on the worker's board");
  assert.equal(expertEnv[0]!.KEEP, "1");
  const finals = updates.filter((run) => run.status !== "running");
  assert.equal(finals.length, 3, `one final report per expert: ${finals.map((run) => run.status).join(", ")}`);

  expertFails = false;
  answers.length = 0;
  await runPiAgent(options, runner);
  assert.deepEqual(answers.map((answer) => answer.split(":")[0]), ["true", "true", "false"]);
  answers.length = 0;
  await runPiAgent(options, runner);
  assert.ok(answers.every((answer) => /used your 2 consults/.test(answer)), "a retry of the same step gets no fresh consults");
});

// --- the engine ---

function message(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
}

const WORKER = ["## Completed", "Added the export button.", "", "## Files Changed", "- `export.txt` — the button", "", "## Verdict", "PASS", "", "## Verification", "- `npm test` — passing"].join("\n");

test("the goal check holds completion on a gap until it is fixed or the oracle says why it is deliberate", async () => {
  const root = repo();
  const verdicts = ["NOT MET", "NOT MET", "MET"];
  const goalPrompts: string[] = [];
  const runner: ProcessRunner = async (args, options) => {
    const file = args[args.indexOf("--append-system-prompt") + 1];
    const system = file ? readFileSync(file, "utf8") : "";
    if (system.startsWith("# Goal Check")) {
      goalPrompts.push(options.prompt ?? "");
      const verdict = verdicts.shift()!;
      return { exitCode: 0, stdout: message(`## Verdict\n${verdict}\n\n## Gaps\n${verdict === "MET" ? "- none" : "- the CSV option the user asked for is missing"}`), stderr: "", killed: false };
    }
    writeFileSync(join(root, "export.txt"), `export ${goalPrompts.length}\n`);
    return { exitCode: 0, stdout: message(WORKER), stderr: "", killed: false };
  };
  const deps: WorkflowDeps = { root, configDir: ".pi", cwd: root, config: { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false } }, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess: runner };
  ensureProjectStructure(root, ".pi");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "project structure");
  const request = "add an export button to the report page with CSV and PDF options";
  const task = createTask("TASK-1", "task", "2026-01-01T00:00:00.000Z", request);
  task.track = { ...chooseTrack("change the submit button colour to blue", undefined, { fastTrack: true }, "2026-01-01T00:00:00.000Z"), roster: ["designer"] };
  createTaskDir(root, ".pi", task);
  transition(task, "clarifying");
  saveTask(root, ".pi", task);
  const act = (params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);

  assert.equal((await act({ action: "implement", domain: "designer", task: "Step 1: add the export button" })).ok, true);
  const refused = await act({ action: "complete", message: "Add export button" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /goal check read the change against the user's request[\s\S]*- the CSV option the user asked for is missing/);
  assert.match(goalPrompts[0]!, /## The user's request\n\nadd an export button to the report page with CSV and PDF options/);
  assert.match(goalPrompts[0]!, /export\.txt/, "it reads the change itself");
  assert.equal(loadTask(root, ".pi", "TASK-1")!.goalCheck!.verdict, "not_met");

  const again = await act({ action: "complete", message: "Add export button" });
  assert.equal(again.ok, false, "the same change is not checked twice, and still holds");
  assert.equal(goalPrompts.length, 1);

  // A fix step changes the tree, so the next completion checks the new change.
  await act({ action: "implement", domain: "designer", task: "Step 2: add the CSV option" });
  const still = await act({ action: "complete", message: "Add export button" });
  assert.equal(still.ok, false);
  assert.equal(goalPrompts.length, 2);
  const accepted = await act({ action: "complete", message: "Add export button", reason: "the user dropped CSV for now" });
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(accepted.state, "completed");
  assert.match(loadTask(root, ".pi", "TASK-1")!.decisions.map((entry) => entry.text).join("\n"), /Completed although the goal check named gaps \(the CSV option the user asked for is missing\): the user dropped CSV for now/);
});

test("an unreadable goal check is tried twice and never recorded, and a reason does not skip a check that has not refused yet", async () => {
  const root = repo();
  const replies = ["I could not decide.", "Still unsure.", "## Verdict\nNOT MET\n\n## Gaps\n- the PDF option is missing"];
  let checks = 0;
  const runner: ProcessRunner = async (args) => {
    const file = args[args.indexOf("--append-system-prompt") + 1];
    if ((file ? readFileSync(file, "utf8") : "").startsWith("# Goal Check")) {
      checks += 1;
      return { exitCode: 0, stdout: message(replies.shift() ?? "## Verdict\nNOT MET\n\n## Gaps\n- the PDF option is missing"), stderr: "", killed: false };
    }
    writeFileSync(join(root, "export.txt"), `export ${checks}\n`);
    return { exitCode: 0, stdout: message(WORKER), stderr: "", killed: false };
  };
  const deps: WorkflowDeps = { root, configDir: ".pi", cwd: root, config: { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false } }, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess: runner };
  ensureProjectStructure(root, ".pi");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "project structure");
  const task = createTask("TASK-1", "task", "2026-01-01T00:00:00.000Z", "add an export button with CSV and PDF options");
  task.track = { ...chooseTrack("change the submit button colour to blue", undefined, { fastTrack: true }, "2026-01-01T00:00:00.000Z"), roster: ["designer"] };
  createTaskDir(root, ".pi", task);
  transition(task, "clarifying");
  saveTask(root, ".pi", task);
  const act = (params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);

  await act({ action: "implement", domain: "designer", task: "Step 1: add the export button" });
  // Undo the completion the unread check lets through, so the same change is checked again.
  const before = loadTask(root, ".pi", "TASK-1")!;
  const done = await act({ action: "complete", message: "Add export button" });
  assert.equal(done.ok, true, done.message);
  assert.equal(checks, 2, "an unread check is read once more");
  assert.match(done.message, /goal check could not be read \(twice\)[\s\S]*tell the user/);
  assert.equal(loadTask(root, ".pi", "TASK-1")!.goalCheck, undefined, "nothing is recorded, so the next complete checks again");

  saveTask(root, ".pi", before);
  gitIn(root, "reset", "-q", "--soft", "HEAD~1");
  const upfront = await act({ action: "complete", message: "Add export button", reason: "the user dropped PDF" });
  assert.equal(upfront.ok, false, "a reason given before the check refused is not an answer to it");
  assert.match(upfront.message, /- the PDF option is missing/);
  const answered = await act({ action: "complete", message: "Add export button", reason: "the user dropped PDF" });
  assert.equal(answered.ok, true, answered.message);
  assert.match(answered.message, /gaps left open, because: the user dropped PDF[\s\S]*- the PDF option is missing/);
});

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

test("a parallel batch in worktrees mode gives each worker its own checkout and merges their work back", async () => {
  const root = repo();
  const seen: Array<{ domain: string; cwd: string; tools: string }> = [];
  const runner: ProcessRunner = async (args, options) => {
    const domain = roleOf(options.env?.BOT_LOBBY_BOARD_FROM ?? "?") ?? options.env?.BOT_LOBBY_BOARD_FROM ?? "?";
    assert.match(options.env?.BOT_LOBBY_BOARD_FROM ?? "", /^\w+(:[0-9a-f-]+)?$/, "the worker's board identity is its domain or a per-run assignment of it");
    seen.push({ domain, cwd: options.cwd, tools: args[args.indexOf("--tools") + 1] ?? "" });
    writeFileSync(join(options.cwd, `${domain}.txt`), `${domain} was here\n`);
    return { exitCode: 0, stdout: message(WORKER), stderr: "", killed: false };
  };
  const config = { ...DEFAULT_CONFIG, workflow: { ...DEFAULT_CONFIG.workflow, briefCheck: false, parallelMode: "worktrees" as const } };
  const deps: WorkflowDeps = { root, configDir: ".pi", cwd: root, config, ask: async () => undefined, choose: async () => undefined, notify: () => {}, runProcess: runner };
  ensureProjectStructure(root, ".pi");
  writeFileSync(join(root, ".gitignore"), "node_modules/\n.pi/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "ignore data");
  const task = createTask("TASK-1", "task", "2026-01-01T00:00:00.000Z", "change the submit button colour to blue");
  task.track = { ...chooseTrack("change the submit button colour to blue", undefined, { fastTrack: true }, "2026-01-01T00:00:00.000Z"), roster: ["designer", "backend"] };
  createTaskDir(root, ".pi", task);
  transition(task, "clarifying");
  saveTask(root, ".pi", task);
  const built = await runWorkflowAction({ action: "implement", taskId: "TASK-1", assignments: [{ domain: "designer", task: "Step 1: the page" }, { domain: "backend", task: "Step 2: the route" }] } as OrchestrateParams, deps);
  assert.equal(built.ok, true, built.message);
  assert.match(built.message, /Parallel batch: designer, backend \(a worktree each\)\./);
  assert.match(built.message, /Worktrees merged back: DESIGN, DEV\./);
  assert.equal(readFileSync(join(root, "designer.txt"), "utf8"), "designer was here\n");
  assert.equal(readFileSync(join(root, "backend.txt"), "utf8"), "backend was here\n");
  assert.equal(new Set(seen.map((entry) => entry.cwd)).size, 2, "each worker ran in a checkout of its own");
  assert.ok(seen.every((entry) => entry.cwd !== root));
  for (const entry of seen) {
    assert.match(entry.tools, /ask_peer,answer_peer/);
    assert.doesNotMatch(entry.tools, /claim_file/, "no claims in a checkout of one's own");
  }
  assert.equal(gitIn(root, "worktree", "list").split("\n").length, 1);
});
