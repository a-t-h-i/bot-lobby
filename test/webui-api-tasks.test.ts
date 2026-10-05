/**
 * The Tasks tab calls over HTTP: rows, archived tasks, comments and the row
 * actions. Each call runs against a real `LobbyService` over a temp project;
 * the last test sweeps every mock scenario so the mock answers them too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureProjectStructure, saveTask } from "../src/state/persistence.ts";
import { updateWork } from "../src/state/work-time.ts";
import { addPlanComment, readPlanComments } from "../src/state/comments.ts";
import { savePlannedTask } from "../src/state/backlog.ts";
import { createTask } from "../src/schemas/task.ts";
import { newDelivery } from "../src/delivery/review.ts";
import { createLobbyService } from "../src/lobby/service.ts";
import type { RunLogEntry } from "../src/schemas/task.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-tasks-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-tasks-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const json = { "content-type": "application/json" };

interface CallAnswer {
  status: number;
  body: string;
  payload: { ok: boolean; result?: Record<string, unknown>; error?: string; code?: string };
}

function send(port: number, path: string, headers: Record<string, string>, body: string): Promise<CallAnswer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, body: text, payload: JSON.parse(text) as CallAnswer["payload"] });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function fakeState() {
  const root = mkdtempSync(join(tmpdir(), "bl-tasks-root-"));
  ensureProjectStructure(root, ".pi");
  const ctx = {
    cwd: root,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => "session-1", getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  const pi = {
    sendUserMessage() {},
    getSessionName: () => "test window",
  } as unknown as ExtensionAPI;
  return { root, ctx, pi };
}

function seedRoot(root: string) {
  const mine = createTask("TASK-mine", "Mine", new Date().toISOString(), "Mine", "session-1");
  mine.state = "implementing";
  mine.plan = "1. Write the API\n2. Add the header\n3. Write the tests";
  mine.workerRuns = [
    { runId: "run-1", domain: "backend", instruction: "Implement step 1: Write the API", status: "success", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
  ];
  saveTask(root, ".pi", mine);
  const other = createTask("TASK-other", "Other", new Date().toISOString(), "Other", "session-2");
  other.state = "implementing";
  saveTask(root, ".pi", other);
  const done = createTask("TASK-done", "Done");
  done.state = "completed";
  saveTask(root, ".pi", done);
  savePlannedTask(root, ".pi", { title: "A saved plan", brief: "## Agreed plan\n\nDo it well." });
}

async function login(port: number, token: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/api/auth.login", headers: { host: `127.0.0.1:${port}`, ...json } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        assert.equal(res.statusCode, 200, Buffer.concat(chunks).toString("utf8"));
        resolve(String(res.headers["set-cookie"] ?? "").split(";")[0]!);
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify({ token }));
    req.end();
  });
}

async function setup() {
  const state = fakeState();
  seedRoot(state.root);
  const service = createLobbyService({ ...state, configDir: ".pi" } as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const token = new URL(server.link).hash.replace("#token=", "");
  const cookie = await login(server.port, token);
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { server, service, call, root: state.root, close: () => server.close() };
}

test("tasks.open selects actual owner metadata without claiming or replacing sessions", async () => {
  const { call, service, close } = await setup();
  try {
    assert.deepEqual((await call("tasks.open", { taskId: "TASK-mine" })).payload.result, { sessionId: "session-1" });
    const ended = await call("tasks.open", { taskId: "TASK-other" });
    assert.match(String(ended.payload.result!.notice), /ended or is unavailable/);
    assert.equal(ended.payload.result!.sessionId, undefined);
    const ownerless = await call("tasks.open", { taskId: "TASK-done" });
    assert.match(String(ownerless.payload.result!.notice), /no owning session/);
    service.liveSessions = () => [{ sessionId: "session-2", pid: process.pid, mode: "interactive" }];
    assert.deepEqual((await call("tasks.open", { taskId: "TASK-other" })).payload.result, { sessionId: "session-2" });
    assert.equal(service.tasks().find((task) => task.id === "TASK-other")!.ownerSessionId, "session-2");
  } finally { await close(); }
});

test("tasks.open refuses unauthenticated, foreign-project and caller-selected session payloads", async () => {
  const { server, call, close } = await setup();
  try {
    const unauthorized = await send(server.port, "/api/tasks.open", json, JSON.stringify({ taskId: "TASK-mine" }));
    assert.equal(unauthorized.status, 401);
    assert.equal((await call("tasks.open", { taskId: "foreign-project-task" })).status, 404);
    assert.equal((await call("tasks.open", { taskId: "TASK-mine", sessionId: "foreign-session" })).status, 400);
  } finally { await close(); }
});

test("delivery review routes authorize project scope, persist deferral and reject stale identities", async () => {
  const { server, call, root, service, close } = await setup();
  try {
    const task = createTask("TASK-review", "Review"); task.state = "completed";
    task.delivery = newDelivery(task, root); saveTask(root, ".pi", task);
    assert.equal((await send(server.port, "/api/tasks.deliveryReview", json, JSON.stringify({ taskId: task.id }))).status, 401);
    assert.equal((await call("tasks.deliveryReview", { taskId: "foreign" })).status, 404);
    assert.equal((await call("tasks.deliveryReview", { taskId: "../escape" })).status, 400);
    assert.equal((await call("tasks.deliveryReview", { taskId: "TASK-done" })).status, 400);
    const review = await call("tasks.deliveryReview", { taskId: task.id });
    assert.equal(review.status, 200);
    const delivery = review.payload.result!.delivery as { reviewId: string };
    assert.equal((await call("tasks.deliveryDefer", { taskId: task.id, reviewId: "stale" })).status, 409);
    assert.equal((await call("tasks.deliveryDefer", { taskId: task.id, reviewId: delivery.reviewId })).status, 200);
    assert.equal(service.tasks().find((entry) => entry.id === task.id)!.delivery!.status, "deferred");
    assert.equal((await call("tasks.deliver", { taskId: task.id, reviewId: delivery.reviewId, action: "merge_main" })).status, 400);
    assert.equal((await call("tasks.deliver", { taskId: "foreign", reviewId: delivery.reviewId, action: "create_pr" })).status, 404);
    assert.equal((await call("tasks.deliver", { taskId: task.id, reviewId: "stale", action: "create_pr" })).status, 409);
    assert.equal((await call("tasks.deliver", { taskId: task.id, reviewId: delivery.reviewId, action: "create_pr", path: "/client/path" })).status, 400);
    assert.equal((await send(server.port, "/api/tasks.deliver", json, JSON.stringify({ taskId: task.id, reviewId: delivery.reviewId, action: "create_pr" }))).status, 401);
    service.deliveryDeliver = async (_id, request) => ({ ...task.delivery!, status: "successful", result: { action: request.action, pullNumber: 42 } });
    const published = await call("tasks.deliver", { taskId: task.id, reviewId: delivery.reviewId, action: "create_pr" });
    assert.equal(published.status, 200);
    assert.equal((published.payload.result!.delivery as { result: { pullNumber: number } }).result.pullNumber, 42);
  } finally { await close(); }
});

test("tasks.list rows mirror the terminal: mine, others, pending, recent", async () => {
  const { call, close } = await setup();
  try {
    const answer = await call("tasks.list");
    assert.equal(answer.status, 200, answer.body);
    const rows = answer.payload.result!.rows as Array<Record<string, unknown>>;
    assert.deepEqual(rows.map((row) => [row.kind, row.id, row.section]), [
      ["task", "TASK-mine", "mine"],
      ["task", "TASK-other", "others"],
      ["plan", "PLAN-a-saved-plan", "pending"],
      ["task", "TASK-done", "recent"],
    ]);
    const mine = rows[0]!;
    assert.equal(mine.check, "open");
    assert.deepEqual(mine.progress, { done: 1, total: 3 });
    const other = rows[1]!;
    assert.equal(other.owner, "not running", "an owner with no heartbeat and no background name reads as not running");
  } finally {
    await close();
  }
});

test("tasks.editComment rejects missing, foreign, unknown authors and blank edits", async () => {
  const { call, root, close } = await setup();
  try {
    const own = addPlanComment(root, ".pi", "TASK-mine", "original", "session-1");
    const foreign = addPlanComment(root, ".pi", "TASK-mine", "foreign", "session-2");
    const unknown = addPlanComment(root, ".pi", "TASK-mine", "unknown");
    const edit = (commentId: string, text = "corrected") => call("tasks.editComment", { taskId: "TASK-mine", commentId, text });
    assert.equal((await edit("missing")).status, 404);
    assert.equal((await edit(foreign.id)).status, 403);
    assert.equal((await edit(unknown.id)).status, 403);
    assert.equal((await edit(own.id, "   ")).status, 400);
    assert.equal((await call("tasks.editComment", { taskId: "TASK-mine", commentId: own.id, text: "ok", by: "session-2" })).status, 400);
    const result = await edit(own.id);
    assert.equal(result.status, 200, result.body);
    const comment = result.payload.result!.comment as typeof own;
    assert.equal(comment.text, "corrected");
    assert.equal(comment.createdAt, own.createdAt);
    assert.ok(comment.editedAt);
    assert.equal(readPlanComments(root, ".pi", "TASK-mine")[0]!.editedAt, comment.editedAt);
  } finally { await close(); }
});

test("tasks.comments starts empty; tasks.comment adds one and answers its notice", async () => {
  const { call, close } = await setup();
  try {
    assert.deepEqual((await call("tasks.comments", { taskId: "TASK-mine" })).payload, { ok: true, result: { comments: [] } });
    const sent = await call("tasks.comment", { taskId: "TASK-mine", text: "steer toward the simpler shape" });
    assert.equal(sent.status, 200, sent.body);
    assert.match(String(sent.payload.result!.notice), /oracle/, "the terminal's notice text");
    const after = await call("tasks.comments", { taskId: "TASK-mine" });
    const comments = after.payload.result!.comments as Array<{ text: string; status: string }>;
    assert.equal(comments.length, 1);
    assert.equal(comments[0]!.text, "steer toward the simpler shape");
    assert.equal(comments[0]!.status, "open");
    assert.deepEqual((await call("tasks.comment", { taskId: "TASK-mine", text: "   " })).payload, {
      ok: true,
      result: { notice: "type something first" },
    });
  } finally {
    await close();
  }
});

test("tasks.archive, tasks.restore and tasks.delete move tasks with notices", async () => {
  const { call, close } = await setup();
  try {
    const archived = await call("tasks.archive", { taskId: "TASK-other" });
    assert.equal(archived.status, 200, archived.body);
    assert.match(String(archived.payload.result!.notice), /^archived TASK-other/);
    const listed = (await call("tasks.list")).payload.result!.rows as Array<{ id: string }>;
    assert.ok(!listed.some((row) => row.id === "TASK-other"), "archived tasks leave the list");
    const archiveRows = (await call("tasks.archived")).payload.result!.rows as Array<{ id: string; kind: string }>;
    assert.ok(archiveRows.some((row) => row.id === "TASK-other" && row.kind === "archived"));
    const restored = await call("tasks.restore", { taskId: "TASK-other" });
    assert.match(String(restored.payload.result!.notice), /^restored TASK-other/);
    const relisted = (await call("tasks.list")).payload.result!.rows as Array<{ id: string }>;
    assert.ok(relisted.some((row) => row.id === "TASK-other"), "restored tasks return to the list");
    const deleted = await call("tasks.delete", { taskId: "TASK-other", where: "list" });
    assert.match(String(deleted.payload.result!.notice), /^deleted TASK-other/);
    const gone = (await call("tasks.list")).payload.result!.rows as Array<{ id: string }>;
    assert.ok(!gone.some((row) => row.id === "TASK-other"));
    const missing = await call("tasks.delete", { taskId: "TASK-nope", where: "list" });
    assert.match(String(missing.payload.result!.notice), /no task TASK-nope/);
    const badWhere = await call("tasks.delete", { taskId: "TASK-mine", where: "everywhere" });
    assert.equal(badWhere.status, 400);
    assert.equal(badWhere.payload.code, "bad_request");
  } finally {
    await close();
  }
});

test("tasks.auto switches auto mode; unknown or finished tasks are refused", async () => {
  const { call, close } = await setup();
  try {
    const on = await call("tasks.auto", { taskId: "TASK-mine", on: true });
    assert.equal(on.status, 200, on.body);
    assert.equal(on.payload.result!.on, true);
    assert.match(String(on.payload.result!.notice), /auto mode on/);
    const off = await call("tasks.auto", { taskId: "TASK-mine", on: false });
    assert.equal(off.payload.result!.on, false);
    assert.match(String(off.payload.result!.notice), /auto mode off/);
    const unknown = await call("tasks.auto", { taskId: "TASK-nope", on: true });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
    const finished = await call("tasks.auto", { taskId: "TASK-done", on: true });
    assert.equal(finished.status, 400);
    assert.equal(finished.payload.code, "bad_request");
  } finally {
    await close();
  }
});

test("tasks.message leaves a message for the task's oracle", async () => {
  const { call, close } = await setup();
  try {
    const sent = await call("tasks.message", { taskId: "TASK-other", text: "the spec changed — reread it" });
    assert.equal(sent.status, 200, sent.body);
    assert.match(String(sent.payload.result!.notice), /saved|sent/);
    const blank = await call("tasks.message", { taskId: "TASK-other", text: "  " });
    assert.equal(blank.payload.result!.notice, "type something first");
  } finally {
    await close();
  }
});

function logEntry(index: number): RunLogEntry {
  const startedAt = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString();
  return { runId: `run-${index}`, domain: "backend", role: "worker", status: index === 7 ? "failed" : "success", startedAt, finishedAt: new Date(Date.parse(startedAt) + 192_000).toISOString(), attempts: 1, ...(index === 7 ? { error: "the build broke\nsecond line" } : {}) };
}

test("tasks.get reads a plan's checklist: steps, no request when it equals the title, no proposal beside a plan", async () => {
  const { call, close } = await setup();
  try {
    const got = await call("tasks.get", { taskId: "TASK-mine" });
    assert.equal(got.status, 200, got.body);
    const { timing, ...detail } = got.payload.result!;
    assert.equal((timing as { waiting: boolean }).waiting, false);
    assert.equal((timing as { elapsedMs: number }).elapsedMs, 0);
    assert.ok(Number.isFinite(Date.parse((timing as { serverNow: string }).serverNow)));
    assert.deepEqual(detail, {
      plan: "1. Write the API\n2. Add the header\n3. Write the tests",
      steps: [{ text: "Write the API", status: "done" }, { text: "Add the header", status: "current" }, { text: "Write the tests", status: "open" }],
      amendments: [],
      waiting: [],
      blockers: [],
      runs: [],
    });
  } finally {
    await close();
  }
});

test("tasks.get marks the steps a worker is on with their time, keeps the plan's detail apart from its steps, and says how long the agents worked", async () => {
  const { call, close, root } = await setup();
  try {
    const task = createTask("TASK-timed", "timed", "2026-10-05T12:00:00.000Z", "time it", "s1");
    task.state = "implementing";
    task.plan = "## Steps\n1. Add the clock\n2. Show it\n\n## Details\n### Step 1: Add the clock\nIn `src/state/budget.ts`.";
    saveTask(root, ".pi", task);
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    updateWork(root, ".pi", "TASK-timed", (work) => {
      work.workedMs = 600_000;
      work.runningSince = new Date(Date.now() - 30_000).toISOString();
      work.active = [{ runId: "r1", instruction: "Step 2: show it", startedAt }];
    });
    const got = await call("tasks.get", { taskId: "TASK-timed" });
    assert.equal(got.status, 200, got.body);
    const detail = got.payload.result as { steps: Array<{ text: string; status: string; active?: boolean; workedMs?: number }>; work: { workedMs: number; running: boolean }; planDetails: string };
    assert.deepEqual(detail.steps.map((step) => [step.text, step.status, Boolean(step.active)]), [["Add the clock", "done", false], ["Show it", "current", true]]);
    assert.ok(detail.steps[1]!.workedMs! >= 89_000 && detail.steps[1]!.workedMs! < 100_000, `step time ${detail.steps[1]!.workedMs}`);
    assert.equal(detail.steps[0]!.workedMs, undefined, "only steps under way carry a time");
    assert.equal(detail.work.running, true);
    assert.ok(detail.work.workedMs >= 629_000 && detail.work.workedMs < 640_000, `worked ${detail.work.workedMs}`);
    assert.equal(detail.planDetails, "## Details\n### Step 1: Add the clock\nIn `src/state/budget.ts`.");
    const rows = await call("tasks.list", {});
    const row = (rows.payload.result!.rows as Array<{ id: string; work?: { running: boolean } }>).find((entry) => entry.id === "TASK-timed");
    assert.equal(row?.work?.running, true, "the row carries the clock too");
  } finally {
    await close();
  }
});

test("tasks.get carries the request, proposal, amendments, waits, blockers and the last six runs in the terminal's wording", async () => {
  const { call, root, close } = await setup();
  try {
    const task = createTask("TASK-detail", "Short title", new Date().toISOString(), "The long request\n\n- with a list");
    task.state = "awaiting_approval";
    task.proposal = "Do it in two moves.";
    task.amendments = ["Keep the old endpoint."];
    task.blockers = [{ domain: "backend", reason: "No database in CI", tried: ["sqlite"], need: "a test database", createdAt: new Date().toISOString() }];
    task.approvals = [
      { id: "APR-1", kind: "dependency", domain: "backend", detail: "add zod", status: "pending", createdAt: new Date().toISOString() },
      { id: "APR-2", kind: "architecture", domain: "designer", detail: "already answered", status: "approved", createdAt: new Date().toISOString() },
    ];
    task.runLog = Array.from({ length: 8 }, (_, index) => logEntry(index));
    saveTask(root, ".pi", task);
    const got = await call("tasks.get", { taskId: "TASK-detail" });
    assert.equal(got.status, 200, got.body);
    const result = got.payload.result as unknown as { request: string; proposal: string; plan?: string; steps: unknown[]; amendments: string[]; waiting: unknown[]; blockers: unknown[]; runs: string[] };
    assert.equal(result.request, "The long request\n\n- with a list");
    assert.equal(result.proposal, "Do it in two moves.");
    assert.equal(result.plan, undefined);
    assert.deepEqual(result.steps, []);
    assert.deepEqual(result.amendments, ["Keep the old endpoint."]);
    assert.deepEqual(result.waiting, [{ kind: "dependency", detail: "for backend: add zod" }]);
    assert.deepEqual(result.blockers, [{ reason: "No database in CI", need: "a test database" }]);
    assert.equal(result.runs.length, 6, "the last six");
    assert.match(result.runs[0]!, /^✓ DEV worker · 3m 12s/);
    assert.match(result.runs[5]!, /^✗ DEV worker · 3m 12s · failed — the build broke$/);
  } finally {
    await close();
  }
});

test("tasks.get finds archived tasks; unknown ids are 404; extra fields are 400", async () => {
  const { call, close } = await setup();
  try {
    await call("tasks.archive", { taskId: "TASK-done" });
    assert.equal((await call("tasks.get", { taskId: "TASK-done" })).status, 200, "archived tasks read too");
    const unknown = await call("tasks.get", { taskId: "TASK-nope" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
    const extra = await call("tasks.get", { taskId: "TASK-mine", more: 1 });
    assert.equal(extra.status, 400);
    assert.equal((await call("tasks.get", {})).status, 400);
  } finally {
    await close();
  }
});

test("every scenario's mock answers the tasks calls without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const token = new URL(server.link).hash.replace("#token=", "");
      const authed = await login(server.port, token);
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie: authed }, JSON.stringify(body));
      assert.equal((await call("tasks.list")).status, 200, `${name}: tasks.list`);
      assert.equal((await call("tasks.archived")).status, 200, `${name}: tasks.archived`);
      assert.equal((await call("tasks.comments", { taskId: "T-mock-1" })).status, 200, `${name}: tasks.comments`);
      assert.equal((await call("tasks.get", { taskId: "T-mock-1" })).status, name === "full" ? 200 : 404, `${name}: tasks.get`);
      assert.equal((await call("tasks.get", { taskId: "T-nope" })).status, 404, `${name}: unknown tasks.get is 404`);
      if (name === "full") {
        const detail = (await call("tasks.get", { taskId: "T-mock-1" })).payload.result as unknown as { request: string; steps: Array<{ status: string }>; waiting: unknown[]; blockers: unknown[]; runs: string[]; amendments: string[] };
        assert.deepEqual(detail.steps.map((step) => step.status), ["done", "current", "open"], "full: checklist from the fixture");
        assert.ok(detail.request && detail.waiting.length === 1 && detail.blockers.length === 1 && detail.runs.length === 0 && detail.amendments.length === 1, "full: request, waits, blockers, amendments (no run log: the metrics tiles count it)");
        const proposal = (await call("tasks.get", { taskId: "T-mock-2" })).payload.result as unknown as { proposal: string };
        assert.match(proposal.proposal, /pending migrations/, "full: a task with a proposal and no plan");
        const rows = (await call("tasks.list")).payload.result!.rows as Array<{ id: string; section: string }>;
        assert.ok(rows.some((row) => row.id === "T-mock-1" && row.section === "mine"), "full: the owned task is mine");
        assert.ok(rows.some((row) => row.id === "PLAN-mock-dark" && row.section === "pending"), "full: the saved plan is pending");
        const mine = rows.find((row) => row.id === "T-mock-1") as unknown as { auto: boolean; progress: { done: number; total: number } };
        assert.equal(mine.auto, true, "full: auto mode from the fixture");
        assert.deepEqual(mine.progress, { done: 1, total: 3 }, "full: progress from the fixture");
      }
      assert.equal((await call("tasks.comment", { taskId: "T-mock-1", text: "hi" })).status, 200, `${name}: tasks.comment`);
      assert.equal((await call("tasks.archive", { taskId: "T-mock-1" })).status, 200, `${name}: tasks.archive`);
      assert.equal((await call("tasks.restore", { taskId: "T-mock-1" })).status, 200, `${name}: tasks.restore`);
      assert.equal((await call("tasks.delete", { taskId: "T-mock-1", where: "list" })).status, 200, `${name}: tasks.delete`);
      assert.equal((await call("tasks.message", { taskId: "T-mock-1", text: "hi" })).status, 200, `${name}: tasks.message`);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});
