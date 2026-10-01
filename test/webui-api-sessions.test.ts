/**
 * The background-session calls over HTTP: listing what this window started
 * (plus live sessions elsewhere), reading a session's conversation, starting,
 * stopping, messaging, switching to, and answering a session's question.
 * Session behaviour runs against a real `LobbyService` over a temp project
 * with a fake process launcher; the last test sweeps every mock scenario.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureProjectStructure } from "../src/state/persistence.ts";
import { savePlannedTask } from "../src/state/backlog.ts";
import { createLobbyService, setSessionLauncher } from "../src/lobby/service.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { FakeSessionProcess } from "./fake-session.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-sessions-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-sessions-dist-"));
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

function fakeState() {
  const root = mkdtempSync(join(tmpdir(), "bl-sessions-root-"));
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

async function setup() {
  const state = fakeState();
  const procs: FakeSessionProcess[] = [];
  setSessionLauncher(() => {
    const proc = new FakeSessionProcess();
    procs.push(proc);
    return proc;
  });
  const service = createLobbyService({ ...state, configDir: ".pi" } as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return {
    server,
    call,
    service,
    procs,
    state,
    close: () => server.close(),
  };
}

after(() => {
  setSessionLauncher(undefined);
});

test("sessions.list starts empty, then shows the background sessions this window started", async () => {
  const { call, close } = await setup();
  try {
    const empty = await call("sessions.list");
    assert.equal(empty.status, 200, empty.body);
    assert.deepEqual(empty.payload.result!.background, []);
    assert.deepEqual(empty.payload.result!.live, []);
    const started = await call("sessions.start", { request: "draft the mock api" });
    assert.equal(started.status, 200, started.body);
    const key = started.payload.result!.key as string;
    assert.match(key, /^S\d+$/);
    assert.match(String(started.payload.result!.notice), /new session/);
    const listed = await call("sessions.list");
    const background = listed.payload.result!.background as Array<Record<string, unknown>>;
    assert.equal(background.length, 1);
    assert.equal(background[0]!.key, key);
    assert.equal(background[0]!.waiting, 0);
    assert.deepEqual(background[0]!.dialogs, []);
    assert.equal(background[0]!.alive, true);
  } finally {
    await close();
  }
});

test("sessions.chat pages a background session's conversation, oldest first", async () => {
  const { call, service, close } = await setup();
  try {
    const key = (await call("sessions.start", { request: "tell me a long story" })).payload.result!.key as string;
    const session = service.sessions().find((entry) => entry.key === key)!;
    for (let index = 1; index <= 60; index += 1) session.feed.say("oracle", `line ${index}`);
    const page = await call("sessions.chat", { key });
    assert.equal(page.status, 200, page.body);
    const entries = page.payload.result!.entries as Array<{ id: number; text: string }>;
    assert.equal(entries.length, 50, "newest 50");
    assert.equal(entries[0]!.text, "line 11");
    assert.equal(entries.at(-1)!.text, "line 60");
    assert.equal(page.payload.result!.hasOlder, true);
    const older = await call("sessions.chat", { key, before: entries[0]!.id });
    const rest = older.payload.result!.entries as Array<{ text: string }>;
    assert.equal(rest.length, 10);
    assert.equal(rest[0]!.text, "line 1");
    assert.equal(older.payload.result!.hasOlder, false);
    const unknown = await call("sessions.chat", { key: "S9999" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
    const missing = await call("sessions.chat", {});
    assert.equal(missing.status, 404);
    assert.equal(missing.payload.code, "not_found");
  } finally {
    await close();
  }
});

test("sessions.chat also finds a background session by its pi session id", async () => {
  const { call, procs, close } = await setup();
  try {
    const key = (await call("sessions.start", { request: "report your id" })).payload.result!.key as string;
    procs[0]!.emit({ type: "response", command: "get_state", data: { sessionId: "session-1", sessionFile: "/tmp/session-1.json" } });
    const answer = await call("sessions.chat", { sessionId: "session-1" });
    assert.equal(answer.status, 200, answer.body);
    assert.deepEqual(answer.payload.result!.entries, []);
    const listed = await call("sessions.list");
    const background = listed.payload.result!.background as Array<{ key: string; sessionId?: string }>;
    assert.equal(background.find((entry) => entry.key === key)?.sessionId, "session-1");
  } finally {
    await close();
  }
});

test("sessions.start needs a request or a plan, never both", async () => {
  const { call, state, close } = await setup();
  try {
    const missing = await call("sessions.start", {});
    assert.equal(missing.status, 400);
    assert.equal(missing.payload.code, "bad_request");
    const blank = await call("sessions.start", { request: "   " });
    assert.equal(blank.status, 400);
    assert.equal(blank.payload.code, "bad_request");
    const plan = savePlannedTask(state.root, ".pi", { title: "A saved plan", brief: "## Agreed plan\n\nDo it well." });
    const both = await call("sessions.start", { request: "do it", planId: plan.id });
    assert.equal(both.status, 400);
    assert.equal(both.payload.code, "bad_request");
    const unknown = await call("sessions.start", { planId: "PLAN-nope" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
    const fromPlan = await call("sessions.start", { planId: plan.id, auto: true });
    assert.equal(fromPlan.status, 200, fromPlan.body);
    assert.match(fromPlan.payload.result!.key as string, /^S\d+$/);
    const listed = await call("sessions.list");
    const background = listed.payload.result!.background as Array<{ key: string; planId?: string }>;
    assert.ok(background.some((session) => session.key === fromPlan.payload.result!.key && session.planId === plan.id));
  } finally {
    await close();
  }
});

test("sessions.stop ends a background session; unknown keys are 404", async () => {
  const { call, close } = await setup();
  try {
    const key = (await call("sessions.start", { request: "a short-lived task" })).payload.result!.key as string;
    const stopped = await call("sessions.stop", { key });
    assert.equal(stopped.status, 200, stopped.body);
    assert.match(String(stopped.payload.result!.notice), /stopping/);
    const listed = await call("sessions.list");
    const background = listed.payload.result!.background as Array<{ key: string; alive: boolean }>;
    assert.equal(background.find((session) => session.key === key)?.alive, false);
    const unknown = await call("sessions.stop", { key: "S9999" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
  } finally {
    await close();
  }
});

test("sessions.message reaches a background session and refuses blanks and ended ones", async () => {
  const { call, procs, close } = await setup();
  try {
    const key = (await call("sessions.start", { request: "listen closely" })).payload.result!.key as string;
    const sent = await call("sessions.message", { key, text: "the spec changed — reread it" });
    assert.equal(sent.status, 200, sent.body);
    assert.deepEqual(procs[0]!.commands("prompt").length, 2, "the start prompt plus the message");
    const blank = await call("sessions.message", { key, text: "   " });
    assert.equal(blank.payload.result!.notice, "type something first");
    procs[0]!.exit(0);
    const ended = await call("sessions.message", { key, text: "too late" });
    assert.equal(ended.status, 409);
    assert.equal(ended.payload.code, "conflict");
    const other = await call("sessions.message", { sessionId: "session-other", text: "hello over there" });
    assert.equal(other.status, 200, other.body);
    assert.equal(typeof other.payload.result!.notice, "string");
  } finally {
    await close();
  }
});

test("sessions.switch runs a background session here and refuses other-terminal sessions", async () => {
  const { call, close } = await setup();
  try {
    const key = (await call("sessions.start", { request: "come here" })).payload.result!.key as string;
    const switched = await call("sessions.switch", { key });
    assert.equal(switched.status, 200, switched.body);
    assert.match(String(switched.payload.result!.notice), /switching|could not find/);
    const other = await call("sessions.switch", { sessionId: "session-other" });
    assert.equal(other.status, 200, other.body);
    assert.match(String(other.payload.result!.notice), /another terminal/);
    const missing = await call("sessions.switch", {});
    assert.equal(missing.status, 400);
    assert.equal(missing.payload.code, "bad_request");
    const unknownTask = await call("sessions.switch", { claimTaskId: "TASK-nope" });
    assert.equal(unknownTask.status, 404);
    assert.equal(unknownTask.payload.code, "not_found");
  } finally {
    await close();
  }
});

test("sessions.answer delivers an answer; unknown sessions and questions are 404", async () => {
  const { call, procs, close } = await setup();
  try {
    const key = (await call("sessions.start", { request: "ask me first" })).payload.result!.key as string;
    procs[0]!.emit({ type: "extension_ui_request", id: "q1", method: "confirm", title: "Approve the plan?", message: "The draft is ready." });
    const waiting = (await call("sessions.list")).payload.result!.background as Array<{ key: string; waiting: number }>;
    assert.equal(waiting.find((session) => session.key === key)?.waiting, 1);
    const answered = await call("sessions.answer", { key, dialogId: "q1", answer: { confirmed: true } });
    assert.equal(answered.status, 200, answered.body);
    assert.equal(answered.payload.result!.notice, "answer sent");
    const responses = procs[0]!.written.filter((command) => command.type === "extension_ui_response");
    assert.equal(responses.length, 1);
    assert.equal(responses[0]!.id, "q1");
    const settled = (await call("sessions.list")).payload.result!.background as Array<{ key: string; waiting: number }>;
    assert.equal(settled.find((session) => session.key === key)?.waiting, 0);
    const unknownDialog = await call("sessions.answer", { key, dialogId: "q9", answer: { confirmed: true } });
    assert.equal(unknownDialog.status, 404);
    assert.equal(unknownDialog.payload.code, "not_found");
    const unknownSession = await call("sessions.answer", { key: "S9999", dialogId: "q1", answer: { confirmed: true } });
    assert.equal(unknownSession.status, 404);
    assert.equal(unknownSession.payload.code, "not_found");
  } finally {
    await close();
  }
});

test("every scenario's mock answers the sessions calls without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
      const listed = await call("sessions.list");
      assert.equal(listed.status, 200, `${name}: sessions.list`);
      const background = listed.payload.result!.background as Array<{ key: string; waiting: number }>;
      assert.ok(Array.isArray(background), `${name}: background is a list`);
      if (name === "full") {
        assert.ok(background.some((session) => session.key === "S1" && session.waiting === 1), "full: the waiting background session");
        const live = listed.payload.result!.live as Array<{ sessionId: string }>;
        assert.ok(live.some((session) => session.sessionId === "session-other"), "full: the other terminal");
        assert.equal((await call("sessions.chat", { key: "S1" })).status, 200, "full: sessions.chat by key");
        assert.equal((await call("sessions.chat", { sessionId: "session-bg-1" })).status, 200, "full: sessions.chat by session id");
        assert.equal((await call("sessions.answer", { key: "S1", dialogId: "q1", answer: { confirmed: true } })).status, 200, "full: sessions.answer");
        assert.equal((await call("sessions.stop", { key: "S1" })).status, 200, "full: sessions.stop");
      } else {
        assert.equal((await call("sessions.chat", { key: "S1" })).status, 404, `${name}: unknown chat key is 404`);
        assert.equal((await call("sessions.answer", { key: "S1", dialogId: "q1", answer: { confirmed: true } })).status, 404, `${name}: unknown answer key is 404`);
        assert.equal((await call("sessions.stop", { key: "S1" })).status, 404, `${name}: unknown stop key is 404`);
      }
      assert.equal((await call("sessions.chat", {})).status, 404, `${name}: sessions.chat without a target is 404`);
      assert.equal((await call("sessions.start", {})).status, 400, `${name}: sessions.start without a task is 400`);
      const started = await call("sessions.start", { request: "mock follow-up" });
      assert.equal(started.status, 200, `${name}: sessions.start`);
      assert.match(started.payload.result!.key as string, /^S\d+$/, `${name}: sessions.start keys the session`);
      assert.equal((await call("sessions.message", { key: started.payload.result!.key, text: "hi" })).status, 200, `${name}: sessions.message`);
      assert.equal((await call("sessions.message", { sessionId: "session-other", text: "hi" })).status, 200, `${name}: sessions.message to another terminal`);
      assert.equal((await call("sessions.message", { key: started.payload.result!.key, text: "   " })).payload.result!.notice, "type something first", `${name}: blank message`);
      const other = await call("sessions.switch", { sessionId: "session-other" });
      assert.equal(other.status, 200, `${name}: sessions.switch to another terminal`);
      assert.match(String(other.payload.result!.notice), /another terminal|oracle is working/, `${name}: the other-terminal or busy-oracle refusal`);
      assert.equal((await call("sessions.switch", {})).status, 400, `${name}: sessions.switch without a target is 400`);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});
