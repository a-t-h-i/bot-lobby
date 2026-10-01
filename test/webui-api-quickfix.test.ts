/**
 * The Quick fix calls over HTTP: listing jobs newest first, submitting,
 * cancelling, running a held job anyway, and moving a held job to a task.
 * Behaviour runs against a real `LobbyService` over a temp project with a
 * stubbed pi runner; the last test sweeps every mock scenario.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureProjectStructure } from "../src/state/persistence.ts";
import { createLobbyService, setSessionLauncher } from "../src/lobby/service.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import { FakeSessionProcess } from "./fake-session.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-quickfix-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-quickfix-dist-"));
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

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 10, output: 5, cost: { total: 0.01 } } } });
}

/** A pi runner that answers at once, or hangs until the job is cancelled. */
function runner(hang: boolean): ProcessRunner {
  return (_args, options) => {
    if (!hang) return Promise.resolve({ exitCode: 0, stdout: reply("## Done\nDid it."), stderr: "", killed: false, timedOut: false });
    return new Promise((resolve) => {
      options.signal?.addEventListener("abort", () => resolve({ exitCode: 1, stdout: "", stderr: "", killed: true, timedOut: false }), { once: true });
    });
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

function fakeState(hang: boolean) {
  const root = mkdtempSync(join(tmpdir(), "bl-quickfix-root-"));
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
  const quickfix = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 60_000 }), runProcess: runner(hang) });
  return { root, ctx, pi, quickfix };
}

async function setup(hang: boolean) {
  const state = fakeState(hang);
  setSessionLauncher(() => new FakeSessionProcess());
  const service = createLobbyService({ ...state, configDir: ".pi" } as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { server, call, service, close: () => server.close() };
}

test("quickfix.list starts empty; quickfix.submit runs a job and lists newest first", async () => {
  const { call, close } = await setup(false);
  try {
    const empty = await call("quickfix.list");
    assert.equal(empty.status, 200, empty.body);
    assert.deepEqual(empty.payload.result!.jobs, []);
    const blank = await call("quickfix.submit", { text: "   " });
    assert.equal(blank.status, 400);
    assert.equal(blank.payload.code, "bad_request");
    const first = await call("quickfix.submit", { text: "rename foo to bar" });
    assert.equal(first.status, 200, first.body);
    assert.equal(first.payload.result!.id, "QF-1");
    assert.match(String(first.payload.result!.notice), /QF-1 (started|queued)/);
    const second = await call("quickfix.submit", { text: "fix the typo" });
    assert.equal(second.payload.result!.id, "QF-2");
    await settle();
    const listed = await call("quickfix.list");
    const jobs = listed.payload.result!.jobs as Array<{ id: string; status: string }>;
    assert.deepEqual(jobs.map((job) => job.id), ["QF-2", "QF-1"], "newest first");
    assert.ok(jobs.every((job) => job.status === "success"), "the stubbed runner finishes both");
  } finally {
    setSessionLauncher(undefined);
    await close();
  }
});

test("quickfix.cancel drops a queued job; finished and unknown jobs are refused", async () => {
  const { call, close } = await setup(true);
  try {
    await call("quickfix.submit", { text: "slow one" });
    await call("quickfix.submit", { text: "next one" });
    const cancelled = await call("quickfix.cancel", { id: "QF-2" });
    assert.equal(cancelled.status, 200, cancelled.body);
    assert.equal(cancelled.payload.result!.notice, "cancelling QF-2");
    const again = await call("quickfix.cancel", { id: "QF-2" });
    assert.equal(again.status, 409);
    assert.equal(again.payload.code, "conflict");
    const unknown = await call("quickfix.cancel", { id: "QF-9" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.code, "not_found");
    const listed = await call("quickfix.list");
    const jobs = listed.payload.result!.jobs as Array<{ id: string; status: string }>;
    assert.equal(jobs.find((job) => job.id === "QF-2")?.status, "cancelled");
  } finally {
    setSessionLauncher(undefined);
    await close();
  }
});

test("quickfix.runAnyway reruns a held job; anything else is refused", async () => {
  const { call, service, close } = await setup(false);
  try {
    await call("quickfix.submit", { text: "a big ask" });
    await settle();
    const settled = await call("quickfix.runAnyway", { id: "QF-1" });
    assert.equal(settled.status, 409, settled.body);
    assert.equal(settled.payload.code, "conflict");
    const unknown = await call("quickfix.runAnyway", { id: "QF-9" });
    assert.equal(unknown.status, 404);
    service.quickfix.jobs.find((job) => job.id === "QF-1")!.status = "held";
    const rerun = await call("quickfix.runAnyway", { id: "QF-1" });
    assert.equal(rerun.status, 200, rerun.body);
    assert.equal(rerun.payload.result!.notice, "running QF-1 anyway");
    await settle();
    const listed = await call("quickfix.list");
    const jobs = listed.payload.result!.jobs as Array<{ id: string; status: string }>;
    assert.equal(jobs.find((job) => job.id === "QF-1")?.status, "success", "the held job ran again");
  } finally {
    setSessionLauncher(undefined);
    await close();
  }
});

test("quickfix.movedToTask starts a held job as a task; anything else is refused", async () => {
  const { call, service, close } = await setup(false);
  try {
    await call("quickfix.submit", { text: "a big ask" });
    await settle();
    const settled = await call("quickfix.movedToTask", { id: "QF-1" });
    assert.equal(settled.status, 409, settled.body);
    const unknown = await call("quickfix.movedToTask", { id: "QF-9" });
    assert.equal(unknown.status, 404);
    service.quickfix.jobs.find((job) => job.id === "QF-1")!.status = "held";
    const moved = await call("quickfix.movedToTask", { id: "QF-1" });
    assert.equal(moved.status, 200, moved.body);
    assert.match(moved.payload.result!.key as string, /^S\d+$/);
    assert.match(String(moved.payload.result!.notice), /new session/);
    const listed = await call("quickfix.list");
    const jobs = listed.payload.result!.jobs as Array<{ id: string; status: string; note?: string }>;
    assert.equal(jobs.find((job) => job.id === "QF-1")?.status, "cancelled");
    assert.match(String(jobs.find((job) => job.id === "QF-1")?.note), /new session/);
  } finally {
    setSessionLauncher(undefined);
    await close();
  }
});

test("every scenario's mock answers the quickfix calls without throwing", async () => {
  setSessionLauncher(() => new FakeSessionProcess());
  try {
    for (const name of SCENARIOS) {
      const service = createFixtureService(name);
      const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
      try {
        const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
        const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
        const listed = await call("quickfix.list");
        assert.equal(listed.status, 200, `${name}: quickfix.list`);
        assert.ok(Array.isArray(listed.payload.result!.jobs), `${name}: jobs is a list`);
        if (name === "full") {
          const jobs = listed.payload.result!.jobs as Array<{ id: string; status: string }>;
          assert.deepEqual(jobs.map((job) => job.id), ["QF-2", "QF-1"], "full: newest first");
          const rerun = await call("quickfix.runAnyway", { id: "QF-1" });
          assert.equal(rerun.status, 200, "full: runAnyway reruns the held job");
          assert.equal(rerun.payload.result!.notice, "running QF-1 anyway");
          const moved = await call("quickfix.movedToTask", { id: "QF-1" });
          assert.equal(moved.status, 409, "full: rerun jobs no longer move to a task");
          const dropped = await call("quickfix.cancel", { id: "QF-1" });
          assert.equal(dropped.status, 200, "full: the rerun job cancels");
        } else {
          assert.deepEqual(listed.payload.result!.jobs, [], `${name}: no jobs`);
          assert.equal((await call("quickfix.cancel", { id: "QF-1" })).status, 404, `${name}: unknown cancel is 404`);
          assert.equal((await call("quickfix.runAnyway", { id: "QF-1" })).status, 404, `${name}: unknown runAnyway is 404`);
          assert.equal((await call("quickfix.movedToTask", { id: "QF-1" })).status, 404, `${name}: unknown movedToTask is 404`);
        }
        assert.equal((await call("quickfix.submit", { text: "   " })).status, 400, `${name}: blank submit is 400`);
        const submitted = await call("quickfix.submit", { text: "mock follow-up" });
        assert.equal(submitted.status, 200, `${name}: quickfix.submit`);
        assert.match(submitted.payload.result!.id as string, /^QF-\d+$/, `${name}: submitted jobs are keyed`);
      } finally {
        disposeFixtureService(service);
        await server.close();
      }
    }
  } finally {
    setSessionLauncher(undefined);
  }
});
