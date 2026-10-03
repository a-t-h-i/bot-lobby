/**
 * The Settings calls over HTTP: the effective config (never a secret) and the
 * models Pi offers, a patch merged and normalised through `resolveConfig` and
 * saved where the terminal reads it, and the terminal's wording for bad input.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/state/project.ts";
import { stripSecrets } from "../src/webui/api/settings.ts";
import { fakeWebService } from "./webui-fake.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-settings-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-settings-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const json = { "content-type": "application/json" };

interface Answer {
  status: number;
  body: string;
  payload: { ok: boolean; result?: Record<string, unknown>; error?: string; code?: string };
}

function send(port: number, path: string, headers: Record<string, string>, body: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, body: text, payload: JSON.parse(text) as Answer["payload"] });
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

async function setup() {
  const server = await startWebServer({ service: fakeWebService(), port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { server, call, close: () => server.close() };
}

test("settings.get answers the effective config and the models Pi offers", async () => {
  const { call, close } = await setup();
  try {
    const answer = await call("settings.get");
    assert.equal(answer.status, 200, answer.body);
    const result = answer.payload.result!;
    const config = result.config as Record<string, unknown>;
    assert.ok(config.master && config.lobby && config.workflow, "the config has its sections");
    assert.equal(typeof (config.lobby as Record<string, unknown>).web, "object", "lobby.web is there");
    const models = result.models as Array<{ id: string; label: string; thinkingLevels: string[] }>;
    assert.deepEqual(models, [{ id: "mock/model", label: "Mock Model", thinkingLevels: ["low", "medium", "high"] }]);
  } finally {
    await close();
  }
});

test("settings.set merges, normalises and saves the patch; the terminal rereads it", async () => {
  const { call, close } = await setup();
  try {
    const set = await call("settings.set", { patch: { master: { thinking: "low" }, agents: { backend: { timeoutMs: 300_000 } } } });
    assert.equal(set.status, 200, set.body);
    const saved = set.payload.result!.config as Record<string, unknown>;
    assert.equal((saved.master as Record<string, unknown>).thinking, "low");
    assert.equal(((saved.agents as Record<string, unknown>).backend as Record<string, unknown>).timeoutMs, 300_000);
    // Other entries are untouched by the patch.
    assert.equal((saved.master as Record<string, unknown>).model, "inherit");
    assert.deepEqual((saved.lobby as Record<string, unknown>).web, { port: 7347, openBrowser: true });
    // The file the terminal reads holds it.
    assert.equal(loadConfig().master.thinking, "low");
    assert.equal(loadConfig().agents.backend.timeoutMs, 300_000);
    const again = await call("settings.get");
    assert.equal(((again.payload.result!.config as Record<string, unknown>).master as Record<string, unknown>).thinking, "low");
  } finally {
    await close();
  }
});

test("unknown patch fields are dropped, never stored", async () => {
  const { call, close } = await setup();
  try {
    const set = await call("settings.set", { patch: { apiKey: "leak", topSecret: "leak", master: { model: "mock/model" } } });
    assert.equal(set.status, 200, set.body);
    const saved = set.payload.result!.config as Record<string, unknown>;
    assert.equal(saved.apiKey, undefined);
    assert.equal(saved.topSecret, undefined);
    assert.equal((saved.master as Record<string, unknown>).model, "mock/model");
    assert.equal(JSON.stringify(saved).includes("leak"), false);
    assert.equal(JSON.stringify(loadConfig()).includes("leak"), false);
  } finally {
    await close();
  }
});

test("invalid input is refused with the terminal's message", async () => {
  const { call, close } = await setup();
  try {
    const port = await call("settings.set", { patch: { lobby: { web: { port: 99999 } } } });
    assert.equal(port.status, 400, port.body);
    assert.deepEqual(port.payload, { ok: false, error: '"99999" is not a port (0, or 1-65535).', code: "bad_request" });
    const timeout = await call("settings.set", { patch: { agents: { qa: { timeoutMs: 0 } } } });
    assert.equal(timeout.status, 400, timeout.body);
    assert.deepEqual(timeout.payload, { ok: false, error: '"0" is not a positive number of minutes.', code: "bad_request" });
    const shape = await call("settings.set", { patch: 5 });
    assert.equal(shape.status, 400, shape.body);
    assert.equal(shape.payload.code, "bad_request");
    const unknown = await call("settings.set", { patch: {}, extra: true });
    assert.equal(unknown.status, 400, unknown.body);
  } finally {
    await close();
  }
});

test("stripSecrets removes secret fields at every depth but keeps the key bindings", () => {
  const config = {
    master: { model: "mock/model", apiKey: "sk-leak" },
    lobby: { keys: { hide: "alt+l" } },
    token: "leak",
    nested: { password: "leak", secret: "leak", authorization: "leak", list: [{ accessToken: "leak", keep: 1 }] },
  };
  const clean = stripSecrets(config) as Record<string, unknown>;
  assert.equal((clean.master as Record<string, unknown>).apiKey, undefined);
  assert.equal(clean.token, undefined);
  const nested = clean.nested as Record<string, unknown>;
  assert.equal(nested.password, undefined);
  assert.equal(nested.secret, undefined);
  assert.equal(nested.authorization, undefined);
  assert.deepEqual((nested.list as Array<Record<string, unknown>>)[0], { keep: 1 });
  assert.deepEqual((clean.lobby as Record<string, unknown>).keys, { hide: "alt+l" });
});
