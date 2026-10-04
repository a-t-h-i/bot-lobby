import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { startWebServer } from "../src/webui/server.ts";
import { sessionValue } from "../src/webui/auth.ts";
import { ProjectRegistry, projectInfo } from "../src/webui/projects.ts";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { fakeWebService } from "./webui-fake.ts";

const temp = () => mkdtempSync(join(tmpdir(), "bl-gateway-"));

async function setup() {
  const registryDir = temp(); const secret = randomBytes(32); const cookie = `bl_session=${sessionValue(secret)}`;
  let registry: ProjectRegistry; let seen: IncomingHttpHeaders = {}; let mode = "normal"; let disconnected = false;
  const remote = createServer((req, res) => {
    req.resume();
    if (req.headers.cookie !== cookie) { res.writeHead(401).end(); return; }
    if (req.url === "/api/projects.self") {
      if (mode === "probe-timeout") return;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, result: { project: { ...projectInfo(registry.record), ...(mode === "mismatch" ? { cwd: "/wrong" } : {}) } } })); return;
    }
    seen = req.headers;
    if (req.url === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write("data: hello\n\n");
      res.on("close", () => { disconnected = true; }); return;
    }
    if (req.url === "/api/slow") return;
    res.writeHead(req.url === "/api/unauthorized" ? 401 : 200, { "Content-Type": "application/json", "Set-Cookie": "stolen=1", Location: "https://evil.test", "X-Private": "secret" });
    res.end(JSON.stringify({ remote: true, path: req.url }));
  });
  await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
  registry = new ProjectRegistry(registryDir, temp(), (remote.address() as AddressInfo).port);
  const entry = await startWebServer({ service: { ...fakeWebService(new LobbyFeed()), projectRoot: () => tempRoot }, secret, port: 0, registryDir });
  const base = `http://127.0.0.1:${entry.port}`; const prefix = `/projects/${registry.record.id}`;
  const call = (path: string, headers: Record<string, string> = {}, body = "{}") => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie, ...headers }, body });
  const closeRemote = () => new Promise<void>((resolve) => { remote.close(() => resolve()); remote.closeAllConnections(); });
  return { entry, remote, registry, call, cookie, prefix, base, seen: () => seen, mode: (value: string) => { mode = value; }, disconnected: () => disconnected,
    closeRemote, close: async () => { await entry.close(); registry.close(); await closeRemote(); } };
}
const tempRoot = temp();

async function independentServer(root: string, dir: string, secret: Buffer) {
  const script = `import { startWebServer } from './src/webui/server.ts';
    import { fakeWebService } from './test/webui-fake.ts'; import { LobbyFeed } from './src/lobby/feed.ts';
    const server = await startWebServer({ service: { ...fakeWebService(new LobbyFeed()), projectRoot: () => process.env.TEST_PROJECT_ROOT },
      port: 0, registryDir: process.env.TEST_REGISTRY, secret: Buffer.from(process.env.TEST_SECRET, 'hex') });
    console.log(server.port); process.on('SIGTERM', async () => { await server.close(); process.exit(0); });`;
  const env: NodeJS.ProcessEnv = { ...process.env, TEST_PROJECT_ROOT: root, TEST_REGISTRY: dir, TEST_SECRET: secret.toString("hex") };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", (chunk) => { errors += chunk; });
  const timer = setTimeout(() => child.kill(), 30000);
  const output = await Promise.race([once(child.stdout, "data"), once(child, "exit").then(() => { throw new Error(`project child exited before listening: ${errors}`); })]);
  clearTimeout(timer);
  return { port: Number(String(output[0]).trim()), close: async () => { const exited = once(child, "exit"); child.kill(); await exited; } };
}

test("two independent project services share one browser origin without sharing uploads or runtime", async () => {
  const dir = temp(); const a = temp(); const b = temp(); const secret = randomBytes(32);
  const remote = await independentServer(b, dir, secret);
  const entry = await startWebServer({ service: { ...fakeWebService(new LobbyFeed()), projectRoot: () => a }, secret, port: 0, registryDir: dir });
  const cookie = `bl_session=${sessionValue(secret)}`; const base = `http://127.0.0.1:${entry.port}`;
  const call = (path: string, body = "{}") => fetch(base + path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body });
  try {
    const list = await (await call("/api/projects.list")).json() as { result: { projects: { id: string; cwd: string; port: number }[] } };
    const selected = list.result.projects.find((p) => p.cwd === b)!;
    assert.equal(selected.port, remote.port); assert.equal(list.result.projects.length, 2);
    const prefix = `/projects/${selected.id}`;
    const upload = await fetch(base + prefix + "/api/files.upload?name=one.png", { method: "POST", headers: { cookie }, body: "project-b-only" });
    const stored = await upload.json() as { result: { id: string; url: string } };
    assert.equal((await fetch(base + prefix + stored.result.url, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(base + stored.result.url, { headers: { cookie } })).status, 404);
    const message = JSON.stringify({ text: "hello", attachments: [stored.result.id] });
    assert.equal((await call("/api/lobby.send", message)).status, 400);
    assert.equal((await call(prefix + "/api/lobby.send", message)).status, 200);
  } finally { await entry.close(); await remote.close(); }
});

test("gateway proxies only registered authorized identity, strips headers, preserves 401 and keeps root APIs", async () => {
  const s = await setup();
  try {
    const list = await (await s.call("/api/projects.list")).json() as { result: { projects: unknown[]; currentId: string } }; assert.equal(list.result.projects.length, 2);
    const localId = list.result.currentId;
    assert.equal((await s.call(`/projects/${localId}/api/status.get`)).status, 200);
    const answer = await s.call(s.prefix + "/api/example", { cookie: s.cookie + "; private=secret", authorization: "Bearer nope", "x-forwarded-host": "evil", "x-private": "secret" });
    assert.equal(answer.status, 200); assert.equal((await answer.json() as { remote: boolean }).remote, true);
    for (const header of ["set-cookie", "location", "x-private"]) assert.equal(answer.headers.get(header), null);
    assert.equal(s.seen().cookie, s.cookie); assert.equal(s.seen().authorization, undefined); assert.equal(s.seen()["x-forwarded-host"], undefined);
    assert.equal(s.seen().origin, `http://127.0.0.1:${s.registry.record.port}`);
    assert.equal((await s.call(s.prefix + "/api/example", { cookie: "" })).status, 401);
    assert.equal((await s.call(s.prefix + "/api/example", { origin: "https://evil.test" })).status, 403);
    assert.equal((await s.call(s.prefix + "/api/example", { "sec-fetch-site": "cross-site" })).status, 403);
    const foreignHost = await new Promise<number>((resolve, reject) => {
      const req = request(s.base + s.prefix + "/api/example", { method: "POST", headers: { host: "evil.test", cookie: s.cookie } }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on("error", reject); req.end("{}");
    });
    assert.equal(foreignHost, 403);
    assert.equal((await s.call(`/projects/${"0".repeat(32)}/api/example`)).status, 404);
    assert.equal((await s.call(s.prefix + "/api/auth.login")).status, 403);
    assert.equal((await s.call(s.prefix + "/api/projects.list")).status, 403);
    assert.equal((await s.call(s.prefix + "/not-an-api")).status, 404);
    assert.equal((await s.call(s.prefix + "/api/unauthorized")).status, 401);
    s.mode("mismatch"); assert.equal((await s.call(s.prefix + "/api/example")).status, 503);
    assert.equal((await (await s.call("/api/projects.list")).json() as { result: { projects: unknown[] } }).result.projects.length, 1);
    s.mode("probe-timeout"); assert.equal((await s.call(s.prefix + "/api/example")).status, 503);
    s.mode("normal"); assert.equal((await s.call(s.prefix + "/api/slow")).status, 503);
    await s.closeRemote(); assert.equal((await s.call(s.prefix + "/api/example")).status, 503);
  } finally { await s.close(); }
});

test("SSE stays streaming after five seconds and browser disconnect closes upstream", async () => {
  const s = await setup();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = request(s.base + s.prefix + "/api/events", { headers: { cookie: s.cookie } }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once("data", () => setTimeout(() => { assert.equal(res.destroyed, false); req.destroy(); resolve(); }, 5200));
      });
      req.on("error", reject); req.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(s.disconnected(), true);
  } finally { await s.close(); }
});

test("a different remote secret remains unauthorized and is omitted from discovery", async () => {
  const s = await setup();
  try {
    // Registered endpoint is alive but refuses this browser's credential.
    const original = s.registry.record.port;
    const rejecting = createServer((_req, res) => res.writeHead(401).end());
    await new Promise<void>((resolve) => rejecting.listen(0, "127.0.0.1", resolve));
    s.registry.close(); s.registry.record.port = (rejecting.address() as AddressInfo).port;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(s.registry.dir, `${s.registry.record.id}.json`), JSON.stringify(s.registry.record));
    try {
      assert.equal((await s.call(s.prefix + "/api/example")).status, 401);
      assert.equal((await (await s.call("/api/projects.list")).json() as { result: { projects: unknown[] } }).result.projects.length, 1);
    } finally { await new Promise<void>((resolve) => rejecting.close(() => resolve())); s.registry.record.port = original; }
  } finally { await s.close(); }
});
