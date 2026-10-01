/**
 * The Knowledge calls over HTTP: listing files, opening one, editing, adding,
 * removing, replacing, commenting and unncommenting. Behaviour runs against a
 * real `KnowledgeBook` over a temp project; the last test sweeps every mock
 * scenario.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureProjectStructure } from "../src/state/persistence.ts";
import { dataRoot } from "../src/state/project.ts";
import { knowledgeDir } from "../src/knowledge/paths.ts";
import { createLobbyService } from "../src/lobby/service.ts";
import { KnowledgeBook } from "../src/lobby/knowledge.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-knowledge-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-knowledge-dist-"));
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

const SEED = "- First entry.\n\n- Second entry.\n";

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "bl-knowledge-root-"));
  ensureProjectStructure(root, ".pi");
  const dir = knowledgeDir(dataRoot(root, ".pi"), "master");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "knowledge.md"), SEED);
  const ctx = {
    cwd: root,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => "session-1", getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  const pi = { sendUserMessage() {}, getSessionName: () => "test window" } as unknown as ExtensionAPI;
  const quickfix = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ thinking: "low", timeoutMs: 60_000 }), runProcess: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", killed: false, timedOut: false }) });
  const knowledge = new KnowledgeBook({ root, configDir: ".pi", threshold: () => 20_000, backups: () => 3, sessionId: () => "session-1" });
  const service = createLobbyService({ root, ctx, pi, quickfix, knowledge, configDir: ".pi" } as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { server, call, close: () => server.close() };
}

test("knowledge.files lists every agent's files; knowledge.open reads entries with refs and notes", async () => {
  const { call, close } = await setup();
  try {
    const files = await call("knowledge.files");
    assert.equal(files.status, 200, files.body);
    const listed = files.payload.result!.files as Array<{ agent: string; file: string }>;
    assert.ok(listed.some((file) => file.agent === "master" && file.file === "knowledge.md"));
    // Sample open: { view: { agent: "master", entries: [{ text, kind: "bullet", occurrence: 0 }], attached: [], detached: [] } }
    const opened = await call("knowledge.open", { agent: "master", file: "knowledge.md" });
    assert.equal(opened.status, 200, opened.body);
    const view = opened.payload.result!.view as { entries: Array<{ text: string; kind: string; occurrence: number }>; attached: unknown[]; content: string };
    assert.deepEqual(view.entries.map((entry) => entry.text), ["- First entry.", "- Second entry."]);
    assert.equal(view.content, SEED);
    const bad = await call("knowledge.open", { agent: "scout", file: "knowledge.md" });
    assert.equal(bad.status, 400);
    assert.equal(bad.payload.code, "bad_request");
  } finally {
    await close();
  }
});

test("knowledge.edit/add/remove/comment/unnote round-trip; stale refs are 409", async () => {
  const { call, close } = await setup();
  try {
    const ref = { text: "- First entry.", occurrence: 0 };
    const edited = await call("knowledge.edit", { agent: "master", file: "knowledge.md", ref, text: "- First entry, revised." });
    assert.equal(edited.status, 200, edited.body);
    assert.match(String(edited.payload.result!.notice), /^saved master\/knowledge\.md/);
    const stale = await call("knowledge.edit", { agent: "master", file: "knowledge.md", ref, text: "- Late edit." });
    assert.equal(stale.status, 409, stale.body);
    assert.equal(stale.payload.code, "conflict");
    assert.match(String(stale.payload.error), /changed on disk/);
    const added = await call("knowledge.add", { agent: "master", file: "knowledge.md", ref: { text: "- First entry, revised.", occurrence: 0 }, text: "- Inserted after the first." });
    assert.equal(added.status, 200, added.body);
    const commented = await call("knowledge.comment", { agent: "master", file: "knowledge.md", ref: { text: "- Second entry.", occurrence: 0 }, text: "Still true." });
    assert.equal(commented.status, 200, commented.body);
    assert.equal(commented.payload.result!.notice, "note saved — every agent reads it under this entry");
    const reopened = await call("knowledge.open", { agent: "master", file: "knowledge.md" });
    const view = reopened.payload.result!.view as { entries: Array<{ text: string }>; attached: Array<{ id: string; text: string }> };
    assert.equal(view.entries.length, 3);
    assert.equal(view.attached.length, 1);
    const unnoted = await call("knowledge.unnote", { id: view.attached[0]!.id });
    assert.equal(unnoted.status, 200, unnoted.body);
    assert.equal(unnoted.payload.result!.notice, "note removed");
    const removed = await call("knowledge.remove", { agent: "master", file: "knowledge.md", ref: { text: "- Inserted after the first.", occurrence: 0 } });
    assert.equal(removed.status, 200, removed.body);
    const replaced = await call("knowledge.replaceFile", { agent: "master", file: "knowledge.md", text: "- A fresh start.\n" });
    assert.equal(replaced.status, 200, replaced.body);
    const done = await call("knowledge.open", { agent: "master", file: "knowledge.md" });
    assert.deepEqual((done.payload.result!.view as { entries: Array<{ text: string }> }).entries.map((entry) => entry.text), ["- A fresh start."]);
  } finally {
    await close();
  }
});

test("every scenario's mock answers the knowledge calls without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
      const files = await call("knowledge.files");
      assert.equal(files.status, 200, `${name}: knowledge.files`);
      if (name === "full") {
        const listed = files.payload.result!.files as Array<{ agent: string; file: string }>;
        assert.ok(listed.some((file) => file.agent === "master" && file.file === "knowledge.md"), "full: master knowledge");
        const opened = await call("knowledge.open", { agent: "master", file: "knowledge.md" });
        assert.equal(opened.status, 200, "full: knowledge.open");
        const view = opened.payload.result!.view as { entries: unknown[]; attached: Array<{ id: string }> };
        assert.equal(view.entries.length, 1, "full: one entry");
        assert.equal(view.attached.length, 1, "full: one note");
        assert.equal((await call("knowledge.unnote", { id: view.attached[0]!.id })).status, 200, "full: unnote");
      } else {
        assert.deepEqual(files.payload.result!.files, [], `${name}: no files`);
        const opened = await call("knowledge.open", { agent: "master", file: "knowledge.md" });
        assert.equal(opened.status, 200, `${name}: empty open`);
        assert.deepEqual((opened.payload.result!.view as { entries: unknown[] }).entries, [], `${name}: no entries`);
      }
      assert.equal((await call("knowledge.open", { agent: "scout", file: "knowledge.md" })).status, 400, `${name}: bad agent is 400`);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});
