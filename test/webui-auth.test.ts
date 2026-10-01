/**
 * The loopback server's fences: the link token, the session cookie, Host and
 * Origin checks, the login lockout, the secret file, and a stdout/stderr spy
 * that stays empty through every refusal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { fakeWebService } from "./webui-fake.ts";
import { loadOrCreateSecret, resetSecret, webSecretPath } from "../src/webui/auth.ts";
import { startWebServer, type WebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-auth-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-auth-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");
writeFileSync(join(DIST, "app.js"), "console.log(1)");

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw request, so the test controls Host, Origin and the rest exactly. */
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

async function withServer(run: (server: WebServer, cookie: () => Promise<string>) => Promise<void>): Promise<void> {
  const service = fakeService();
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST, heartbeatMs: 50 });
  const token = new URL(server.link).hash.replace("#token=", "");
  const cookie = async () => {
    const answer = await send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token }) });
    assert.equal(answer.status, 200, answer.body);
    return String(answer.headers["set-cookie"]).split(";")[0]!;
  };
  try {
    await run(server, cookie);
  } finally {
    await server.close();
  }
}

test("the link carries its token in the fragment, and the server listens on loopback only", async () => {
  await withServer(async (server) => {
    const link = new URL(server.link);
    assert.equal(link.hostname, "127.0.0.1");
    assert.match(link.hash, /^#token=[\w-]{43}$/);
    assert.equal(link.search, "");
  });
});

test("the API and the stream refuse anyone without the cookie", async () => {
  await withServer(async (server) => {
    const snapshot = await send(server.port, { method: "POST", path: "/api/status.get", headers: json, body: "{}" });
    assert.equal(snapshot.status, 401);
    assert.deepEqual(JSON.parse(snapshot.body), { ok: false, error: "open the link Pi printed", code: "unauthorized" });
    assert.equal((await send(server.port, { path: "/api/events" })).status, 401);
    const wrong = await send(server.port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie: "bl_session=guess" }, body: "{}" });
    assert.equal(wrong.status, 401);
  });
});

test("a wrong link is refused, and ten wrong tries in a minute lock the door", async () => {
  await withServer(async (server) => {
    const wrong = () => send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token: "nope" }) });
    for (let i = 0; i < 10; i++) {
      const answer = await wrong();
      assert.equal(answer.status, 401);
      assert.equal((JSON.parse(answer.body) as { code: string }).code, "unauthorized");
    }
    const locked = await wrong();
    assert.equal(locked.status, 429);
    assert.equal((JSON.parse(locked.body) as { code: string }).code, "rate_limited");
  });
});

test("the session cookie is HttpOnly, SameSite=Strict, Path=/ and a month long", async () => {
  await withServer(async (server) => {
    const token = new URL(server.link).hash.replace("#token=", "");
    const answer = await send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token }) });
    const setCookie = String(answer.headers["set-cookie"]);
    assert.match(setCookie, /^bl_session=[\w-]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
  });
});

test("a request naming another host is refused, even with the cookie (DNS rebinding)", async () => {
  await withServer(async (server, cookie) => {
    const value = await cookie();
    assert.equal((await send(server.port, { path: "/", headers: { host: "evil.example" } })).status, 403);
    const api = await send(server.port, { method: "POST", path: "/api/status.get", headers: { ...json, host: `evil.example:${server.port}`, cookie: value }, body: "{}" });
    assert.equal(api.status, 403);
    assert.equal((JSON.parse(api.body) as { code: string }).code, "forbidden");
    assert.equal((await send(server.port, { path: "/", headers: { host: `localhost:${server.port}` } })).status, 200);
  });
});

test("another site cannot call it: a foreign Origin, a cross-site fetch or a form post is refused", async () => {
  await withServer(async (server, cookie) => {
    const value = await cookie();
    const call = (headers: Record<string, string>) =>
      send(server.port, { method: "POST", path: "/api/lobby.send", headers: { cookie: value, ...headers }, body: JSON.stringify({ text: "hi" }) });
    assert.equal((await call({ ...json, origin: "https://evil.example" })).status, 403);
    assert.equal((await call({ ...json, "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await call({ ...json, "sec-fetch-site": "same-site" })).status, 403);
    assert.equal((await call({ "content-type": "text/plain" })).status, 415, "a form or simple request cannot send JSON");
    assert.equal((await call({ ...json, origin: `http://127.0.0.1:${server.port}`, "sec-fetch-site": "same-origin" })).status, 200);
    const page = await send(server.port, { path: "/" });
    assert.equal(page.headers["access-control-allow-origin"], undefined, "no CORS headers, ever");
  });
});

test("no response carries the token or the secret", async () => {
  await withServer(async (server, cookie) => {
    const token = new URL(server.link).hash.replace("#token=", "");
    const value = await cookie();
    const bodies = [
      (await send(server.port, { path: "/" })).body,
      (await send(server.port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie: value }, body: "{}" })).body,
      (await send(server.port, { method: "POST", path: "/api/prompts.list", headers: { ...json, cookie: value }, body: "{}" })).body,
    ];
    for (const body of bodies) assert.ok(!body.includes(token), "the link token never leaves the fragment");
  });
});

test("reset signs everyone out: the old cookie stops working", async () => {
  await withServer(async (server, cookie) => {
    const value = await cookie();
    const before = await send(server.port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie: value }, body: "{}" });
    assert.equal(before.status, 200);
    server.reset();
    const after = await send(server.port, { method: "POST", path: "/api/status.get", headers: { ...json, cookie: value }, body: "{}" });
    assert.equal(after.status, 401);
  });
});

test("the secret file is 0600, and a corrupt web.json is replaced with a notice", async () => {
  const first = loadOrCreateSecret();
  assert.equal(first.secret.length, 32);
  assert.equal((statSync(webSecretPath()).mode & 0o777) & 0o077, 0);
  writeFileSync(webSecretPath(), "{not json");
  const replaced = loadOrCreateSecret();
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.secret.length, 32);
  const again = resetSecret();
  assert.equal(again.length, 32);
  assert.notDeepEqual(again, replaced.secret);
});

test("nothing reaches stdout or stderr, even on refusals", async () => {
  // A child process, so the runner's own batched output can never mix in:
  const probe = new URL("./webui-silence-probe.ts", import.meta.url);
  const configDir = mkdtempSync(join(tmpdir(), "bl-silence-config-"));
  const child = spawn(process.execPath, [fileURLToPath(probe)], { env: { ...process.env, BOT_LOBBY_CONFIG_DIR: configDir } });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => {
    out += String(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    err += String(chunk);
  });
  const code = await new Promise<unknown>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(code, 0);
  assert.equal(out, "");
  assert.equal(err, "");
});
