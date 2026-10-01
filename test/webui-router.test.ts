/**
 * The router: `POST /api/<group>.<action>` with strict schemas, the error
 * envelope and its codes, the body cap, and inherited names that are never
 * callable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { fakeWebService } from "./webui-fake.ts";
import { MAX_BODY_BYTES } from "../src/webui/auth.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-router-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-router-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: { host: `127.0.0.1:${port}`, ...options.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Answer["headers"], body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function fakeService() {
  return fakeWebService(new LobbyFeed());
}

const json = { "content-type": "application/json" };

async function signedIn(): Promise<{ port: number; cookie: string; close: () => Promise<void> }> {
  const server = await startWebServer({ service: fakeService(), port: 0, secret: randomBytes(32), dist: DIST });
  const token = new URL(server.link).hash.replace("#token=", "");
  const answer = await send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token }) });
  assert.equal(answer.status, 200, answer.body);
  return { port: server.port, cookie: String(answer.headers["set-cookie"]).split(";")[0]!, close: () => server.close() };
}

test("unknown calls and inherited names are 404 not_found", async () => {
  const { port, cookie, close } = await signedIn();
  try {
    for (const path of ["/api/nope.nope", "/api/toString", "/api/constructor.pollute", "/api/__proto__", "/api/lobby", "/api/"]) {
      const answer = await send(port, { method: "POST", path, headers: { ...json, cookie }, body: "{}" });
      assert.equal(answer.status, 404, path);
      assert.equal((JSON.parse(answer.body) as { code: string }).code, "not_found");
    }
  } finally {
    await close();
  }
});

test("only POST with application/json reaches the router", async () => {
  const { port, cookie, close } = await signedIn();
  try {
    const get = await send(port, { method: "GET", path: "/api/status.get", headers: { cookie } });
    assert.equal(get.status, 405);
    assert.equal((JSON.parse(get.body) as { code: string }).code, "unsupported");
    const form = await send(port, { method: "POST", path: "/api/status.get", headers: { cookie, "content-type": "text/plain" }, body: "{}" });
    assert.equal(form.status, 415);
    assert.equal((JSON.parse(form.body) as { code: string }).code, "unsupported");
  } finally {
    await close();
  }
});

test("bodies over a megabyte, bad JSON and non-object bodies are refused with their reason", async () => {
  const { port, cookie, close } = await signedIn();
  try {
    const big = await send(port, { method: "POST", path: "/api/lobby.send", headers: { ...json, cookie }, body: JSON.stringify({ text: "x".repeat(MAX_BODY_BYTES) }) });
    assert.equal(big.status, 413);
    assert.equal((JSON.parse(big.body) as { code: string }).code, "too_large");
    const broken = await send(port, { method: "POST", path: "/api/lobby.send", headers: { ...json, cookie }, body: "{not json" });
    assert.equal(broken.status, 400);
    assert.equal((JSON.parse(broken.body) as { code: string }).code, "bad_request");
    for (const body of ["[1,2]", '"hi"', "null"]) {
      const answer = await send(port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie }, body });
      assert.equal(answer.status, 400, body);
      assert.equal((JSON.parse(answer.body) as { code: string }).code, "bad_request");
    }
  } finally {
    await close();
  }
});

test("schemas are strict: wrong types and unknown fields are 400 bad_request", async () => {
  const { port, cookie, close } = await signedIn();
  try {
    const wrongType = await send(port, { method: "POST", path: "/api/lobby.send", headers: { ...json, cookie }, body: JSON.stringify({ text: 5 }) });
    assert.equal(wrongType.status, 400);
    assert.equal((JSON.parse(wrongType.body) as { code: string }).code, "bad_request");
    const extra = await send(port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie }, body: JSON.stringify({ extra: 1 }) });
    assert.equal(extra.status, 400, "unknown fields are rejected, not mass-assigned");
    const missing = await send(port, { method: "POST", path: "/api/lobby.send", headers: { ...json, cookie }, body: "{}" });
    assert.equal(missing.status, 400);
  } finally {
    await close();
  }
});

test("every refusal is the {ok:false,error,code} envelope, never cached, never CORS", async () => {
  const { port, cookie, close } = await signedIn();
  try {
    const answer = await send(port, { method: "POST", path: "/api/nope.nope", headers: { ...json, cookie }, body: "{}" });
    assert.deepEqual(Object.keys(JSON.parse(answer.body)).sort(), ["code", "error", "ok"]);
    assert.equal(answer.headers["cache-control"], "no-store");
    assert.equal(answer.headers["access-control-allow-origin"], undefined);
    const ok = await send(port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie }, body: "{}" });
    assert.equal(ok.status, 200);
    assert.equal((JSON.parse(ok.body) as { ok: boolean }).ok, true);
    assert.equal(ok.headers["cache-control"], "no-store");
  } finally {
    await close();
  }
});
