/**
 * The Excalidraw calls over HTTP: listing with masked links, adding, making,
 * removing, renaming, assigning, checking and revealing. Behaviour runs
 * against a real `ExcalidrawBook` over a temp dir (checks stubbed); the last
 * tests sweep every mock scenario and prove only `reveal` returns a full room
 * link.
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
import { createLobbyService } from "../src/lobby/service.ts";
import { ExcalidrawBook } from "../src/excalidraw/sessions.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-excalidraw-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-excalidraw-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const json = { "content-type": "application/json" };
const LINK = "https://whiteboard.example/#room=abc123,AAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "https://whiteboard.example/#room=def456,BBBBBBBBBBBBBBBBBBBBBB";

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

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "bl-excalidraw-root-"));
  ensureProjectStructure(root, ".pi");
  const ctx = {
    cwd: root,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => "session-1", getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  const pi = { sendUserMessage() {}, getSessionName: () => "test window" } as unknown as ExtensionAPI;
  const quickfix = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 60_000 }), runProcess: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", killed: false, timedOut: false }) });
  const excalidraw = new ExcalidrawBook({ root, dir: mkdtempSync(join(tmpdir(), "bl-xb-")) });
  const service = createLobbyService({ root, ctx, pi, quickfix, excalidraw, configDir: ".pi" } as unknown as Runtime);
  service.checkExcalidraw = async () => ({ ok: true, text: "mock check" });
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { server, call, close: () => server.close() };
}

test("excalidraw.list masks links; add/create/rename/toggles round-trip; reveal returns the link", async () => {
  const { call, close } = await setup();
  try {
    const empty = await call("excalidraw.list");
    assert.equal(empty.status, 200, empty.body);
    assert.deepEqual(empty.payload.result!.sessions, []);
    const bad = await call("excalidraw.add", { link: "not a link" });
    assert.equal(bad.status, 400);
    assert.equal(bad.payload.code, "bad_request");
    const added = await call("excalidraw.add", { link: LINK, name: "Board One" });
    assert.equal(added.status, 200, added.body);
    const id = String(added.payload.result!.id);
    // Sample list: { sessions: [{ id, name: "Board One", masked: "room abc123", agents: [], contribute: true }] }
    const listed = await call("excalidraw.list");
    const sessions = listed.payload.result!.sessions as Array<{ id: string; name: string; masked: string; agents: string[]; contribute: boolean }>;
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]!.masked, "room abc123");
    assert.ok(!("link" in sessions[0]!), "no full link in the list");
    assert.ok(!listed.body.includes("#room="), "no room fragment in the list");
    const duplicate = await call("excalidraw.add", { link: LINK });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.payload.code, "conflict");
    const made = await call("excalidraw.create", { name: "Second" });
    assert.equal(made.status, 200, made.body);
    const other = String(made.payload.result!.id);
    const renamed = await call("excalidraw.rename", { id: other, name: "Renamed" });
    assert.equal(renamed.status, 200, renamed.body);
    assert.match(String(renamed.payload.result!.notice), /Renamed/);
    const assigned = await call("excalidraw.toggleAgent", { id, agent: "backend" });
    assert.equal(assigned.status, 200, assigned.body);
    assert.match(String(assigned.payload.result!.notice), /has this session now/);
    const all = await call("excalidraw.toggleAll", { id });
    assert.equal(all.status, 200, all.body);
    const look = await call("excalidraw.toggleContribute", { id });
    assert.equal(look.status, 200, look.body);
    assert.match(String(look.payload.result!.notice), /only look/);
    const checked = await call("excalidraw.check", { id });
    assert.equal(checked.status, 200, checked.body);
    assert.equal(checked.payload.result!.ok, true);
    const missing = await call("excalidraw.check", { id: "nope" });
    assert.equal(missing.status, 404);
    const revealed = await call("excalidraw.reveal", { id });
    assert.equal(revealed.status, 200, revealed.body);
    assert.equal(revealed.payload.result!.link, LINK);
    const gone = await call("excalidraw.remove", { id: other });
    assert.equal(gone.status, 200, gone.body);
    const unknown = await call("excalidraw.remove", { id: other });
    assert.equal(unknown.status, 404);
    // OTHER is only used to prove the second room parses; add it and drop it again.
    const second = await call("excalidraw.add", { link: OTHER });
    assert.equal(second.status, 200, second.body);
    assert.equal((await call("excalidraw.remove", { id: String(second.payload.result!.id) })).status, 200);
  } finally {
    await close();
  }
});

test("every scenario's mock answers the excalidraw calls without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
      const listed = await call("excalidraw.list");
      assert.equal(listed.status, 200, `${name}: excalidraw.list`);
      const sessions = listed.payload.result!.sessions as Array<{ id: string; masked: string }>;
      assert.ok(!listed.body.includes("#room="), `${name}: the list masks links`);
      assert.ok(sessions.every((session) => !("link" in session)), `${name}: no link field`);
      if (name === "full") {
        assert.equal(sessions.length, 1, "full: one session");
        assert.equal(sessions[0]!.masked, "room abc123", "full: masked");
        const revealed = await call("excalidraw.reveal", { id: sessions[0]!.id });
        assert.equal(revealed.status, 200, "full: reveal");
        assert.ok(String(revealed.payload.result!.link).includes("#room="), "full: reveal returns the link");
        assert.equal((await call("excalidraw.reveal", { id: "nope" })).status, 404, "full: unknown reveal is 404");
      } else {
        assert.deepEqual(sessions, [], `${name}: no sessions`);
        assert.equal((await call("excalidraw.reveal", { id: "x1" })).status, 404, `${name}: unknown reveal is 404`);
      }
      assert.equal((await call("excalidraw.add", { link: "nope" })).status, 400, `${name}: bad link is 400`);
      const added = await call("excalidraw.add", { link: LINK });
      assert.equal(added.status, 200, `${name}: add`);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});

test("no response but excalidraw.reveal carries a full room link", async () => {
  const seen: string[] = [];
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
      const bodies: string[] = [];
      bodies.push((await call("metrics.get", { groupBy: "model" })).body);
      bodies.push((await call("knowledge.files")).body);
      bodies.push((await call("knowledge.open", { agent: "master", file: "knowledge.md" })).body);
      bodies.push((await call("excalidraw.list")).body);
      bodies.push((await call("excalidraw.add", { link: LINK })).body);
      bodies.push((await call("excalidraw.create", { name: "scan" })).body);
      const listed = await call("excalidraw.list");
      const first = (listed.payload.result!.sessions as Array<{ id: string }>)[0];
      if (first) {
        const id = first.id;
        bodies.push((await call("excalidraw.remove", { id: "nope" })).body);
        bodies.push((await call("excalidraw.rename", { id, name: "scan" })).body);
        bodies.push((await call("excalidraw.toggleAgent", { id, agent: "backend" })).body);
        bodies.push((await call("excalidraw.toggleAll", { id })).body);
        bodies.push((await call("excalidraw.toggleContribute", { id })).body);
        bodies.push((await call("excalidraw.check", { id })).body);
      }
      for (const body of bodies) assert.ok(!body.includes("#room="), `${name}: a masked call leaked a room link`);
      seen.push(name);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
  assert.deepEqual(seen, [...SCENARIOS]);
});
