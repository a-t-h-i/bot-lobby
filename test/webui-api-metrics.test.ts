/**
 * The Metrics calls over HTTP: grouped figures, search narrowing, and the
 * classifier summary. Behaviour runs against a real `LobbyService` over a
 * temp project with an appended metrics log; the last test sweeps every mock
 * scenario.
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
import { appendMetrics } from "../src/state/metrics.ts";
import { createLobbyService } from "../src/lobby/service.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-metrics-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-metrics-dist-"));
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

const RECORDS = [
  { id: "m1", kind: "master", agent: "MASTER", model: "provider/alpha", thinking: "low", status: "success", startedAt: "2026-10-01T00:00:00.000Z", durationMs: 120_000, turns: 4, tools: 9, input: 8000, output: 2000, cost: 0.05, taskId: "T-1" },
  { id: "m2", kind: "worker", agent: "DEV", model: "provider/alpha", thinking: "low", status: "success", startedAt: "2026-10-01T00:10:00.000Z", durationMs: 60_000, turns: 2, tools: 5, input: 4000, output: 1000, cost: 0.02, taskId: "T-1" },
  { id: "m3", kind: "quickfix", agent: "QUICK FIX", model: "provider/beta", thinking: "minimal", status: "failed", startedAt: "2026-10-01T00:20:00.000Z", durationMs: 30_000, turns: 1, tools: 2, input: 1000, output: 200, cost: 0.01 },
  { id: "c1", kind: "classifier", agent: "JEV", status: "success", startedAt: "2026-10-01T00:00:00.000Z", durationMs: 400, purpose: "triage", saved: 1 },
] as Parameters<typeof appendMetrics>[2];

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "bl-metrics-root-"));
  ensureProjectStructure(root, ".pi");
  appendMetrics(root, ".pi", RECORDS);
  const ctx = {
    cwd: root,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => "session-1", getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  const pi = { sendUserMessage() {}, getSessionName: () => "test window" } as unknown as ExtensionAPI;
  const quickfix = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 60_000 }), runProcess: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", killed: false, timedOut: false }) });
  const service = createLobbyService({ root, ctx, pi, quickfix, configDir: ".pi" } as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { server, call, close: () => server.close() };
}

test("metrics.get groups runs by model with tiles, time share and the classifier", async () => {
  const { call, close } = await setup();
  try {
    const answer = await call("metrics.get", { groupBy: "model" });
    assert.equal(answer.status, 200, answer.body);
    const result = answer.payload.result!;
    const tiles = result.tiles as Record<string, number>;
    // Sample: { runs: 3, successes: 2, stalls: 0, avgMs: 70000, cost: 0.08, completed: 0, active: 0 }
    assert.equal(tiles.runs, 3);
    assert.equal(tiles.successes, 2);
    assert.equal(tiles.stalls, 0);
    assert.equal(tiles.avgMs, 70_000);
    assert.equal(tiles.p90Ms, 120_000);
    const groups = result.groups as Array<{ model: string; thinking: string; runs: number }>;
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((group) => [group.model, group.thinking, group.runs]), [["alpha", "low", 2], ["beta", "minimal", 1]]);
    const share = result.timeShare as { byAgent: Array<{ agent: string; share: number }>; taskTimes: unknown[] };
    assert.deepEqual(share.byAgent.map((entry) => entry.agent), ["MASTER", "DEV", "QUICK FIX"]);
    assert.ok(Math.abs(share.byAgent.reduce((sum, entry) => sum + entry.share, 0) - 1) < 1e-9);
    assert.deepEqual(share.taskTimes, []);
    const classifier = result.classifier as { calls: number; quickFixesHeld: number };
    assert.equal(classifier.calls, 1);
    assert.equal(classifier.quickFixesHeld, 1);
  } finally {
    await close();
  }
});

test("metrics.get splits by model-kind and narrows with the query", async () => {
  const { call, close } = await setup();
  try {
    const bad = await call("metrics.get", { groupBy: "everything" });
    assert.equal(bad.status, 400);
    assert.equal(bad.payload.code, "bad_request");
    const split = await call("metrics.get", { groupBy: "model-kind" });
    assert.equal(split.status, 200, split.body);
    assert.equal((split.payload.result!.groups as unknown[]).length, 3);
    const narrowed = await call("metrics.get", { groupBy: "model", query: "dev" });
    assert.equal(narrowed.status, 200, narrowed.body);
    assert.equal((narrowed.payload.result!.tiles as { runs: number }).runs, 1);
    assert.equal((narrowed.payload.result!.groups as Array<{ model: string }>)[0]!.model, "alpha");
  } finally {
    await close();
  }
});

test("every scenario's mock answers metrics.get without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (body: unknown = {}) => send(server.port, "/api/metrics.get", { ...json, cookie }, JSON.stringify(body));
      const answer = await call({ groupBy: "model" });
      assert.equal(answer.status, 200, `${name}: metrics.get`);
      const result = answer.payload.result!;
      if (name === "full") {
        assert.equal((result.tiles as { runs: number }).runs, 3, "full: three runs");
        assert.equal((result.groups as unknown[]).length, 2, "full: two models");
        assert.ok(result.classifier, "full: classifier ran");
      } else {
        assert.equal((result.tiles as { runs: number }).runs, 0, `${name}: no runs`);
        assert.deepEqual(result.groups, [], `${name}: no groups`);
        assert.equal(result.classifier, undefined, `${name}: no classifier`);
      }
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});
