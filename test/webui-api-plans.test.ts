/**
 * The saved-plan calls over HTTP: starting one here or in a new background
 * session, and discarding one. Disk effects run against a real
 * `LobbyService` over a temp project; the session start uses a fake process
 * launcher, and the last test sweeps every mock scenario.
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
import { fakeWebService } from "./webui-fake.ts";
import { FakeSessionProcess } from "./fake-session.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-plans-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-plans-dist-"));
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
  const root = mkdtempSync(join(tmpdir(), "bl-plans-root-"));
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
  const plan = savePlannedTask(state.root, ".pi", { title: "A saved plan", brief: "## Agreed plan\n\nDo it well." });
  const service = createLobbyService({ ...state, configDir: ".pi" } as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { server, call, plan, close: () => server.close() };
}

after(() => {
  setSessionLauncher(undefined);
});

test("plans.discard removes the plan; unknown ids are 404", async () => {
  const { call, plan, close } = await setup();
  try {
    const listed = (await call("tasks.list")).payload.result!.rows as Array<{ id: string }>;
    assert.ok(listed.some((row) => row.id === plan.id), "the saved plan lists as pending");
    const discarded = await call("plans.discard", { planId: plan.id });
    assert.equal(discarded.status, 200, discarded.body);
    assert.equal(discarded.payload.result!.notice, `discarded ${plan.id}`);
    const relisted = (await call("tasks.list")).payload.result!.rows as Array<{ id: string }>;
    assert.ok(!relisted.some((row) => row.id === plan.id), "discarded plans leave the list");
    const unknown = await call("plans.discard", { planId: "PLAN-nope" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
  } finally {
    await close();
  }
});

test("plans.start answers 404 for unknown plans and 400 without a target", async () => {
  const { call, close } = await setup();
  try {
    const unknown = await call("plans.start", { planId: "PLAN-nope", where: "here" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
    const badWhere = await call("plans.start", { planId: "PLAN-nope", where: "elsewhere" });
    assert.equal(badWhere.status, 400);
    assert.equal(badWhere.payload.code, "bad_request");
  } finally {
    await close();
  }
});

test("plans.start here answers the terminal's notice", async () => {
  const service = fakeWebService();
  const plans = [{ id: "PLAN-x", title: "X", brief: "Do X.", status: "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  (service as unknown as { plans: () => unknown[] }).plans = () => [...plans];
  (service as unknown as { startPlanned: (plan: unknown) => string }).startPlanned = (plan) => `starting ${(plan as { id: string }).id} here — its agreed plan needs no approval…`;
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  try {
    const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
    const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
    const started = await call("plans.start", { planId: "PLAN-x", where: "here" });
    assert.equal(started.status, 200, started.body);
    assert.equal(started.payload.result!.notice, "starting PLAN-x here — its agreed plan needs no approval…");
  } finally {
    await server.close();
  }
});

test("plans.start in a session starts a background session and keys it", async () => {
  const procs: FakeSessionProcess[] = [];
  setSessionLauncher(() => {
    const proc = new FakeSessionProcess();
    procs.push(proc);
    return proc;
  });
  const { call, plan, close } = await setup();
  try {
    const started = await call("plans.start", { planId: plan.id, where: "session", auto: true });
    assert.equal(started.status, 200, started.body);
    assert.match(String(started.payload.result!.notice), /new session/);
    const key = started.payload.result!.key as string;
    assert.match(key, /^S\d+$/);
    const listed = await call("sessions.list", {});
    const background = listed.payload.result!.background as Array<{ key: string; planId: string }>;
    assert.ok(background.some((session) => session.key === key && session.planId === plan.id));
    const stopped = await call("sessions.stop", { key });
    assert.match(String(stopped.payload.result!.notice), /stopping/);
  } finally {
    await close();
    setSessionLauncher(undefined);
  }
});

test("plans.get reads a saved plan; unknown ids are 404 and the body is strict", async () => {
  const { call, plan, close } = await setup();
  try {
    const got = await call("plans.get", { planId: plan.id });
    assert.equal(got.status, 200, got.body);
    assert.deepEqual(got.payload.result, { id: plan.id, title: "A saved plan", status: "pending", createdAt: plan.createdAt, brief: "## Agreed plan\n\nDo it well." });
    const unknown = await call("plans.get", { planId: "PLAN-nope" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
    assert.equal((await call("plans.get", { planId: plan.id, extra: true })).status, 400);
    assert.equal((await call("plans.get", {})).status, 400);
  } finally {
    await close();
  }
});

test("plans.get carries issue and split info", async () => {
  const state = fakeState();
  const split = { group: "g1", part: 2, of: 3, titles: ["Server", "Page", "Docs"], after: [1] };
  const saved = savePlannedTask(state.root, ".pi", { title: "Page", brief: "Build the page.", issue: { number: 7, title: "Web UI", url: "https://github.com/x/y/issues/7" }, split });
  const service = createLobbyService({ ...state, configDir: ".pi" } as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  try {
    const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
    const got = await send(server.port, "/api/plans.get", { ...json, cookie }, JSON.stringify({ planId: saved.id }));
    assert.equal(got.status, 200, got.body);
    const result = got.payload.result as Record<string, unknown>;
    assert.deepEqual(result.issue, { number: 7, title: "Web UI", url: "https://github.com/x/y/issues/7" });
    assert.deepEqual(result.split, { part: 2, of: 3, titles: ["Server", "Page", "Docs"], after: [1] }, "the shared group id stays server-side");
  } finally {
    await server.close();
  }
});

test("every scenario's mock answers the plans calls without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
      const detail = await call("plans.get", { planId: "PLAN-mock-dark" });
      assert.equal(detail.status, name === "full" ? 200 : 404, `${name}: plans.get`);
      if (name === "full") assert.match(String(detail.payload.result!.brief), /Agreed plan/);
      const start = await call("plans.start", { planId: "PLAN-mock-dark", where: "here" });
      assert.equal(start.status, name === "full" ? 200 : 404, `${name}: plans.start`);
      if (name === "full") assert.match(String(start.payload.result!.notice), /starting PLAN-mock-dark here/);
      assert.equal((await call("plans.discard", { planId: "PLAN-mock-dark" })).status, name === "full" ? 200 : 404, `${name}: plans.discard`);
      const unknown = await call("plans.discard", { planId: "PLAN-nope" });
      assert.equal(unknown.status, 404, `${name}: unknown discard is 404`);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});
