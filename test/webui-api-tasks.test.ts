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
import { savePlannedTask } from "../src/state/backlog.ts";
import { createTask } from "../src/schemas/task.ts";
import { createLobbyService } from "../src/lobby/service.ts";
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
  return { server, call, close: () => server.close() };
}

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
      if (name === "full") {
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
