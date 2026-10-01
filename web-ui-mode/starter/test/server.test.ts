/**
 * The server's fences, each tried from outside the way an attacker or a
 * confused browser would: no cookie, a wrong link, another host, another
 * site, a form post, a huge body, a path out of the page's folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_BODY_BYTES, startLobbyServer, type LobbyServer } from "../server/server.ts";
import { FakeService } from "../server/service.ts";

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw request, so the test controls Host, Origin and the rest exactly. */
function send(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: { host: `127.0.0.1:${port}`, ...options.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

async function withServer(run: (server: LobbyServer, cookie: () => Promise<string>, service: FakeService) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bot-lobby-web-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>t</title>");
  await writeFile(join(dir, "app.js"), "console.log(1)");
  const service = new FakeService({ stepMs: 5 });
  const server = await startLobbyServer({ service, secret: randomBytes(32), staticDir: dir, heartbeatMs: 50, frameMs: 10 });
  const token = new URL(server.link).hash.replace("#token=", "");
  const cookie = async () => {
    const answer = await send(server.port, { method: "POST", path: "/api/auth.login", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    assert.equal(answer.status, 200, answer.body);
    return String(answer.headers["set-cookie"]).split(";")[0]!;
  };
  try {
    await run(server, cookie, service);
  } finally {
    await server.close();
  }
}

const json = { "content-type": "application/json" };

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
    assert.equal((await send(server.port, { method: "POST", path: "/api/lobby.snapshot", headers: json, body: "{}" })).status, 401);
    assert.equal((await send(server.port, { path: "/api/events" })).status, 401);
    assert.equal((await send(server.port, { method: "POST", path: "/api/lobby.snapshot", headers: { ...json, cookie: "bot_lobby=guess" }, body: "{}" })).status, 401);
  });
});

test("a wrong link is refused, and ten wrong tries in a minute lock the door", async () => {
  await withServer(async (server) => {
    const wrong = () => send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token: "nope" }) });
    for (let i = 0; i < 10; i++) assert.equal((await wrong()).status, 401);
    assert.equal((await wrong()).status, 429);
  });
});

test("with the cookie, calls work and answer as JSON that is never cached", async () => {
  await withServer(async (server, cookie) => {
    const answer = await send(server.port, { method: "POST", path: "/api/lobby.snapshot", headers: { ...json, cookie: await cookie() }, body: "{}" });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers["cache-control"], "no-store");
    const body = JSON.parse(answer.body) as { ok: boolean; result: { workspace: { name: string } } };
    assert.equal(body.ok, true);
    assert.equal(body.result.workspace.name, "bot-lobby");
  });
});

test("the session cookie is HttpOnly and SameSite=Strict", async () => {
  await withServer(async (server) => {
    const token = new URL(server.link).hash.replace("#token=", "");
    const answer = await send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token }) });
    assert.match(String(answer.headers["set-cookie"]), /HttpOnly/);
    assert.match(String(answer.headers["set-cookie"]), /SameSite=Strict/);
  });
});

test("a request naming another host is refused, even with the cookie (DNS rebinding)", async () => {
  await withServer(async (server, cookie) => {
    const value = await cookie();
    assert.equal((await send(server.port, { path: "/", headers: { host: "evil.example" } })).status, 403);
    assert.equal((await send(server.port, { method: "POST", path: "/api/lobby.snapshot", headers: { ...json, host: `evil.example:${server.port}`, cookie: value }, body: "{}" })).status, 403);
    assert.equal((await send(server.port, { path: "/", headers: { host: `localhost:${server.port}` } })).status, 200);
  });
});

test("another site cannot call it: a foreign Origin, a cross-site fetch or a form post is refused", async () => {
  await withServer(async (server, cookie) => {
    const value = await cookie();
    const call = (headers: Record<string, string>) => send(server.port, { method: "POST", path: "/api/lobby.send", headers: { cookie: value, ...headers }, body: JSON.stringify({ text: "hi" }) });
    assert.equal((await call({ ...json, origin: "https://evil.example" })).status, 403);
    assert.equal((await call({ ...json, "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await call({ "content-type": "text/plain" })).status, 415, "a form or simple request cannot send JSON");
    assert.equal((await call({ ...json, origin: `http://127.0.0.1:${server.port}`, "sec-fetch-site": "same-origin" })).status, 200);
    const page = await send(server.port, { path: "/" });
    assert.equal(page.headers["access-control-allow-origin"], undefined);
  });
});

test("bodies over a megabyte, bad JSON and unknown calls are refused with their reason", async () => {
  await withServer(async (server, cookie) => {
    const value = await cookie();
    const big = await send(server.port, { method: "POST", path: "/api/lobby.send", headers: { ...json, cookie: value }, body: JSON.stringify({ text: "x".repeat(MAX_BODY_BYTES) }) });
    assert.equal(big.status, 413);
    assert.equal((await send(server.port, { method: "POST", path: "/api/lobby.send", headers: { ...json, cookie: value }, body: "{not json" })).status, 400);
    assert.equal((await send(server.port, { method: "POST", path: "/api/lobby.send", headers: { ...json, cookie: value }, body: JSON.stringify({ text: 5 }) })).status, 400);
    assert.equal((await send(server.port, { method: "POST", path: "/api/toString", headers: { ...json, cookie: value }, body: "{}" })).status, 404, "inherited names are not calls");
  });
});

test("the page is served with a strict CSP, and nothing outside its folder is", async () => {
  await withServer(async (server) => {
    const page = await send(server.port, { path: "/" });
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-security-policy"]), /default-src 'self'.*frame-ancestors 'none'/);
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    for (const path of ["/../server/server.ts", "/%2e%2e/%2e%2e/etc/passwd", "/..%2fpackage.json", "/missing.js", "/server.ts"]) {
      assert.equal((await send(server.port, { path })).status, 404, path);
    }
  });
});

test("the stream says hello, reports changes, and sends a streaming reply in frames", async () => {
  await withServer(async (server, cookie, service) => {
    const value = await cookie();
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: server.port, path: "/api/events", headers: { host: `127.0.0.1:${server.port}`, cookie: value } }, (res) => {
        assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
        res.on("data", (chunk: Buffer) => {
          for (const line of chunk.toString("utf8").split("\n")) if (line.startsWith("data: ")) events.push(line.slice(6));
          if (events.some((event) => event.includes('"changed"')) && events.some((event) => event.includes('"reply"')) && events.filter((event) => event.includes('"changed"')).length >= 2) {
            req.destroy();
            resolve();
          }
        });
      });
      req.on("error", (error) => (events.length ? resolve() : reject(error)));
      req.end();
      setTimeout(() => service.send("dark mode please"), 50);
      setTimeout(() => reject(new Error(`timed out; got ${events.join(" | ")}`)), 5000);
    });
    assert.match(events[0]!, /"type":"hello"/);
    const replies = events.filter((event) => event.includes('"reply"')).length;
    assert.ok(replies > 0 && replies < 120, `${replies} reply frames for about 120 words: they are coalesced`);
  });
});
