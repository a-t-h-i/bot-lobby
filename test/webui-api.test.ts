/**
 * The API: `status.get`, the lobby calls and the prompt queue — shapes, the
 * 409 `question_withdrawn` on late answers, and first-answer-wins in both
 * orders (exactly one winner).
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
import { promptHub } from "../src/lobby/prompt-hub.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-api-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-api-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

interface Answer {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function send(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: { host: `127.0.0.1:${port}`, ...options.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers as Answer["headers"] }));
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function fakeService(feed = new LobbyFeed()) {
  return fakeWebService(feed);
}

const json = { "content-type": "application/json" };

async function signedIn(feed?: LobbyFeed) {
  const server = await startWebServer({ service: fakeService(feed), port: 0, secret: randomBytes(32), dist: DIST });
  const token = new URL(server.link).hash.replace("#token=", "");
  const login = await send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token }) });
  assert.equal(login.status, 200, login.body);
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const call = async (name: string, body: unknown = {}) => {
    const answer = await send(server.port, { method: "POST", path: `/api/${name}`, headers: { ...json, cookie }, body: JSON.stringify(body) });
    return { ...answer, json: JSON.parse(answer.body) as { ok: boolean; result?: Record<string, unknown>; error?: string; code?: string } };
  };
  return { server, call, close: () => server.close() };
}

test("status.get has the C5 shape: workspace, tabs, keys, windows", async () => {
  const { call, close } = await signedIn();
  try {
    const answer = await call("status.get");
    assert.equal(answer.status, 200, answer.body);
    const result = answer.json.result!;
    assert.equal((result.workspace as { name: string }).name, "bot-lobby");
    assert.equal(result.sessionId, "session-1");
    assert.equal(result.sessionName, "test session");
    assert.equal(result.busy, false);
    assert.equal(result.terminalDialog, false);
    assert.equal(result.issuesEnabled, false);
    assert.ok(typeof result.port === "number");
    const tabs = result.tabs as Array<{ id: string; label: string; key: string }>;
    assert.deepEqual(tabs.map((tab) => tab.id), ["lobby", "tasks", "plan", "quickfix", "metrics", "git", "knowledge", "excalidraw"]);
    assert.equal(tabs[0]?.label, "Lobby");
    assert.equal(tabs[0]?.key, "Alt+1");
    const keys = result.keys as Array<{ action: string; key: string; label: string; help: string }>;
    assert.ok(keys.some((entry) => entry.action === "hide" && entry.key === "alt+l"));
    assert.ok(keys.some((entry) => entry.action === "nextTab" && entry.key === "alt+]"), "web tab cycling defaults apply");
    assert.deepEqual(result.windows, []);
  } finally {
    await close();
  }
});

test("lobby.snapshot carries chat, reply, activity, thoughts and the older flag", async () => {
  const feed = new LobbyFeed();
  feed.say("you", "do the thing");
  feed.log("MASTER", "reading it", "info");
  feed.thought("MASTER", "a thought");
  feed.replyDelta("partial reply");
  const { call, close } = await signedIn(feed);
  try {
    const answer = await call("lobby.snapshot");
    assert.equal(answer.status, 200, answer.body);
    const result = answer.json.result!;
    assert.equal((result.chat as unknown[]).length, 1);
    assert.equal(result.reply, "partial reply");
    assert.equal((result.activity as unknown[]).length, 1);
    assert.equal((result.thoughts as unknown[]).length, 1);
    assert.equal(result.hasOlderChat, false);
    assert.deepEqual(result.runs, []);
  } finally {
    await close();
  }
});

test("lobby.send, lobby.history and lobby.abort", async () => {
  const feed = new LobbyFeed();
  const seen: string[] = [];
  const service = fakeService(feed);
  (service as unknown as { toOracle: (text: string) => string | undefined }).toOracle = (text) => {
    seen.push(text);
    return undefined;
  };
  let aborted = 0;
  (service as unknown as { abortMaster: () => void }).abortMaster = () => {
    aborted += 1;
  };
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  try {
    const token = new URL(server.link).hash.replace("#token=", "");
    const login = await send(server.port, { method: "POST", path: "/api/auth.login", headers: json, body: JSON.stringify({ token }) });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const call = async (name: string, body: unknown = {}) => {
      const answer = await send(server.port, { method: "POST", path: `/api/${name}`, headers: { ...json, cookie }, body: JSON.stringify(body) });
      return { ...answer, json: JSON.parse(answer.body) as { ok: boolean; result?: Record<string, unknown>; code?: string } };
    };
    assert.deepEqual((await call("lobby.send", { text: "  hello  " })).json, { ok: true, result: {} });
    assert.deepEqual(seen, ["  hello  "]);
    assert.equal((await call("lobby.send", { text: "   " })).json.result?.notice, "type something first");
    assert.deepEqual((await call("lobby.abort")).json, { ok: true, result: {} });
    assert.equal(aborted, 1);
    const history = await call("lobby.history", { before: 999 });
    assert.equal(history.status, 200);
    assert.deepEqual(history.json.result, { entries: [], hasOlder: false });
  } finally {
    await server.close();
  }
});

test("prompts.list answers and dismisses; a late answer is 409 question_withdrawn", async () => {
  const { server, call, close } = await signedIn();
  try {
    const prompt = promptHub.open("confirm", "test", { question: "sure?" });
    try {
      const list = await call("prompts.list");
      assert.equal(list.status, 200, list.body);
      const prompts = list.json.result!.prompts as Array<{ id: string; kind: string }>;
      assert.ok(prompts.some((entry) => entry.id === prompt.id && entry.kind === "confirm"));
      assert.deepEqual((await call("prompts.answer", { id: prompt.id, answer: true })).json, { ok: true, result: { notice: "answer sent" } });
      const late = await call("prompts.answer", { id: prompt.id, answer: false });
      assert.equal(late.status, 409);
      assert.equal(late.json.code, "question_withdrawn");
    } finally {
      promptHub.dismiss(prompt.id);
    }
    const second = promptHub.open("text", "test", { question: "name?" });
    try {
      assert.deepEqual((await call("prompts.dismiss", { id: second.id })).json, { ok: true, result: {} });
      const afterDismiss = await call("prompts.answer", { id: second.id, answer: "x" });
      assert.equal(afterDismiss.status, 409, "dismissed first, then answered: still 409");
    } finally {
      promptHub.dismiss(second.id);
    }
    assert.deepEqual((await call("prompts.dismiss", { id: "p0-never" })).json, { ok: true, result: {} }, "dismiss is idempotent");
    const unknown = await call("prompts.answer", { id: "p0-never", answer: false });
    assert.equal(unknown.status, 409);
  } finally {
    await close();
    void server;
  }
});

test("first answer wins in both orders: exactly one winner", async () => {
  const { call, close } = await signedIn();
  try {
    const prompt = promptHub.open("confirm", "test", { question: "race?" });
    try {
      const [first, second] = await Promise.all([call("prompts.answer", { id: prompt.id, answer: "a" }), call("prompts.answer", { id: prompt.id, answer: "b" })]);
      const codes = [first.status, second.status].sort();
      assert.deepEqual(codes, [200, 409], "one winner, one 409");
    } finally {
      promptHub.dismiss(prompt.id);
    }
    const terminal = promptHub.open("confirm", "test", { question: "terminal first" });
    try {
      assert.equal(promptHub.answer(terminal.id, "terminal"), true, "the terminal answers first");
      const late = await call("prompts.answer", { id: terminal.id, answer: "web" });
      assert.equal(late.status, 409);
      assert.equal(late.json.code, "question_withdrawn");
    } finally {
      promptHub.dismiss(terminal.id);
    }
  } finally {
    await close();
  }
});
