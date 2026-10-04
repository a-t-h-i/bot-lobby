/**
 * Attachments: `files.upload` takes the raw file, the send calls name it in
 * the message by path, and images come back through the preview route.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LobbyFeed } from "../src/lobby/feed.ts";
import { ATTACHMENTS_MARK } from "../src/lobby/prompts.ts";
import { fakeWebService } from "./webui-fake.ts";
import { startWebServer } from "../src/webui/server.ts";
import { withAttachments } from "../src/webui/uploads.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-up-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-up-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

interface Answer {
  status: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

function send(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: Buffer | string }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: { host: `127.0.0.1:${port}`, ...options.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers as Answer["headers"] }));
    });
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const json = { "content-type": "application/json" };
// A real 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function setup() {
  const sent: string[] = [];
  const service = { ...fakeWebService(new LobbyFeed()), toOracle: (text: string) => { sent.push(text); return undefined; } };
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const token = new URL(server.link).hash.replace("#token=", "");
  const login = await send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token }) });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const upload = (name: string, type: string, body: Buffer, headers: Record<string, string> = {}) =>
    send(server.port, { method: "POST", path: `/api/files.upload?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, headers: { "content-type": "application/octet-stream", cookie, ...headers }, body });
  const call = async (name: string, body: unknown) => {
    const answer = await send(server.port, { method: "POST", path: `/api/${name}`, headers: { ...json, cookie }, body: JSON.stringify(body) });
    return { status: answer.status, json: JSON.parse(answer.body.toString("utf8")) as { ok: boolean; result?: Record<string, unknown>; error?: string } };
  };
  return { server, cookie, sent, upload, call, close: () => server.close() };
}

test("an uploaded image is saved, named by path in the message to the oracle and served back", async () => {
  const { server, cookie, sent, upload, call, close } = await setup();
  try {
    const stored = await upload("Mock up.png", "image/png", PNG);
    assert.equal(stored.status, 200, stored.body.toString());
    const file = JSON.parse(stored.body.toString("utf8")).result as { id: string; kind: string; mime: string; url?: string; size: number };
    assert.equal(file.kind, "image");
    assert.equal(file.mime, "image/png");
    assert.equal(file.size, PNG.length);
    assert.match(file.id, /^[\w.-]+-Mock_up\.png$/);
    assert.equal(file.url, `/files/preview/attachments/${file.id}`);

    const reply = await call("lobby.send", { text: "look at this", attachments: [file.id] });
    assert.equal(reply.json.ok, true);
    assert.match(sent[0]!, new RegExp(`^look at this\\n\\n${ATTACHMENTS_MARK}\\n- .*bot-lobby-previews.[a-f0-9]{64}.attachments.*${file.id.replace(/[.]/g, "\\.")} \\(image/png\\)$`));

    const served = await send(server.port, { path: file.url!, headers: { cookie } });
    assert.equal(served.status, 200);
    assert.equal(served.headers["content-type"], "image/png");
    assert.deepEqual(served.body, PNG);
  } finally {
    await close();
  }
});

test("a PDF is kept as a file the agents read by path; an attachment alone is a message", async () => {
  const { upload, call, sent, close } = await setup();
  try {
    const stored = await upload("spec.pdf", "", Buffer.from("%PDF-1.4 tiny"));
    const file = JSON.parse(stored.body.toString("utf8")).result as { id: string; kind: string; mime: string; url?: string };
    assert.deepEqual([file.kind, file.mime, file.url], ["pdf", "application/pdf", undefined]);
    const reply = await call("lobby.send", { text: "", attachments: [file.id] });
    assert.equal(reply.json.ok, true);
    assert.match(sent[0]!, new RegExp(`^${ATTACHMENTS_MARK}\\n- .*${file.id.replace(/[.]/g, "\\.")} \\(application/pdf\\)$`));
    assert.equal((await call("lobby.send", { text: "  " })).json.result?.notice, "type something first");
  } finally {
    await close();
  }
});

test("uploads are refused without the session, empty, nameless, too large or unknown on send", async () => {
  const { server, upload, call, close } = await setup();
  try {
    const anonymous = await send(server.port, { method: "POST", path: "/api/files.upload?name=a.png", headers: { "content-type": "application/octet-stream" }, body: PNG });
    assert.equal(anonymous.status, 401);
    assert.equal((await upload("a.png", "image/png", Buffer.alloc(0))).status, 400);
    assert.equal((await send(server.port, { method: "POST", path: "/api/files.upload", headers: { "content-type": "application/octet-stream" }, body: PNG })).status, 401);
    const huge = await upload("big.bin", "", Buffer.alloc(21 * 1024 * 1024));
    assert.equal(huge.status, 413);
    const unknown = await call("lobby.send", { text: "x", attachments: ["nope-1.png"] });
    assert.equal(unknown.status, 400);
    assert.match(unknown.json.error ?? "", /not there/);
    const traversal = await call("lobby.send", { text: "x", attachments: ["../../etc/passwd"] });
    assert.equal(traversal.status, 400);
  } finally {
    await close();
  }
});

test("withAttachments leaves a message without files as it is", () => {
  assert.equal(withAttachments("hello", undefined), "hello");
  assert.equal(withAttachments("hello", []), "hello");
});
