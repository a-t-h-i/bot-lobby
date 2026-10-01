/**
 * The mock server (`npm run web:dev`): every scenario loads, every call the
 * router knows is backed by a fixture, sends stream the scripted reply, the
 * question sets gain a questionnaire after a send, and no fixture carries a
 * link, an address or a secret.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promptHub } from "../src/lobby/prompt-hub.ts";
import { startWebServer } from "../src/webui/server.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS, fixturePath, loadScenario, resolveScenario, type ScenarioFixture, type ScenarioName } from "../src/webui/dev/fixtures.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-mock-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-mock-dist-"));
writeFileSync(join(DIST, "index.html"), "<!doctype html><title>t</title>");

const KINDS = ["questionnaire", "choose", "confirm", "text", "sessionDialog"];
const jsonHeaders = { "content-type": "application/json" };

interface Answer {
  status: number;
  body: string;
  cookie?: string;
  payload: { ok: boolean; result?: Record<string, unknown>; code?: string };
}

function send(port: number, path: string, headers: Record<string, string>, body: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, body: text, cookie: String(res.headers["set-cookie"] ?? "").split(";")[0], payload: JSON.parse(text) as Answer["payload"] });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function clearPrompts(): void {
  for (const prompt of promptHub.pending()) promptHub.dismiss(prompt.id);
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= end) return false;
    await new Promise((done) => setTimeout(done, 50));
  }
}

type Call = (api: string, body?: unknown) => Promise<Answer>;

test("all ten scenario files exist and unknown names default to full", () => {
  assert.deepEqual([...SCENARIOS], ["full", "empty", "loading", "error", "reconnecting", "question", "questions3", "answered-in-terminal", "terminal-dialog", "issues"]);
  for (const name of SCENARIOS) assert.equal(existsSync(fixturePath(name)), true, name);
  assert.equal(resolveScenario("nope"), "full");
  assert.equal(resolveScenario(undefined), "full");
  assert.equal(resolveScenario("empty"), "empty");
});

test("no fixture contains a link, an address or a secret", () => {
  const forbidden = [/#token=/, /bl_session/, /excalidraw\.com/i, /private key/i, /\bsecret\b/i, /\bpassword\b/i, /Bearer /];
  for (const name of SCENARIOS) {
    const text = readFileSync(fixturePath(name), "utf8");
    for (const pattern of forbidden) assert.equal(pattern.test(text), false, `${name} matches ${pattern}`);
  }
});

test("every scenario loads and backs every router call", async () => {
  for (const name of SCENARIOS) await checkScenario(name);
});

test("every scenario's snapshot, status and prompts answer 200 with domains always an array", async () => {
  for (const name of SCENARIOS) {
    clearPrompts();
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const token = new URL(server.link).hash.replace("#token=", "");
      const login = await send(server.port, "/api/auth.login", jsonHeaders, JSON.stringify({ token }));
      assert.equal(login.status, 200, `${name}: login`);
      const cookie = login.cookie ?? "";
      const call: Call = (api, body = {}) => send(server.port, `/api/${api}`, { ...jsonHeaders, cookie }, JSON.stringify(body));
      for (const api of ["status.get", "lobby.snapshot", "prompts.list"] as const) {
        const answer = await call(api);
        assert.equal(answer.status, 200, `${name}: ${api}`);
        assert.equal(answer.payload.ok, true, `${name}: ${api} ok`);
      }
      const task = (await call("lobby.snapshot")).payload.result?.task as Record<string, unknown> | undefined;
      if (task) assert.ok(Array.isArray(task.domains), `${name}: task.domains is an array`);
      if (name === "full") {
        assert.deepEqual(task?.domains, ["dev", "qa"], "full: domains");
        assert.deepEqual(task?.track, { path: "full", size: "large" }, "full: track");
        assert.deepEqual(task?.git, { branch: "mock/offline-fixtures", from: "main" }, "full: git");
        const progress = task?.progress as { done: number; total: number } | undefined;
        assert.ok(progress && typeof progress.done === "number" && typeof progress.total === "number", "full: progress");
        assert.equal(typeof task?.currentStep, "string", "full: currentStep");
      }
    } finally {
      disposeFixtureService(service);
      clearPrompts();
      await server.close();
    }
  }
});

async function checkScenario(name: ScenarioName): Promise<void> {
  const fixture = loadScenario(name);
  assert.ok(fixture.status.workspace.name, `${name}: status.workspace`);
  assert.ok(Array.isArray(fixture.zen.runs), `${name}: zen.runs`);
  assert.ok(Array.isArray(fixture.feed.chat), `${name}: feed.chat`);
  assert.ok(Array.isArray(fixture.history), `${name}: history`);
  assert.ok(Array.isArray(fixture.prompts), `${name}: prompts`);
  assert.equal(typeof fixture.oracleReply, "string", `${name}: oracleReply`);
  clearPrompts();
  const service = createFixtureService(name);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  try {
    const token = new URL(server.link).hash.replace("#token=", "");
    const login = await send(server.port, "/api/auth.login", jsonHeaders, JSON.stringify({ token }));
    assert.equal(login.status, 200, `${name}: login`);
    const cookie = login.cookie ?? "";
    const call: Call = (api, body = {}) => send(server.port, `/api/${api}`, { ...jsonHeaders, cookie }, JSON.stringify(body));
    await checkStatus(name, fixture, call);
    await checkSnapshot(name, fixture, call);
    const history = await call("lobby.history", { before: 999 });
    assert.equal(history.status, 200, `${name}: lobby.history`);
    assert.ok(Array.isArray(history.payload.result?.entries), `${name}: history entries`);
    const aborted = await call("lobby.abort");
    assert.equal(aborted.status, 200, `${name}: lobby.abort`);
    assert.deepEqual(aborted.payload, { ok: true, result: {} }, `${name}: lobby.abort shape`);
    await checkSend(name, fixture, call);
    await checkPrompts(name, fixture, call);
  } finally {
    disposeFixtureService(service);
    clearPrompts();
    await server.close();
  }
}

async function checkStatus(name: string, fixture: ScenarioFixture, call: Call): Promise<void> {
  const answer = await call("status.get");
  assert.equal(answer.status, 200, `${name}: status.get`);
  const result = answer.payload.result ?? {};
  assert.equal((result.workspace as { name: string }).name, fixture.status.workspace.name, `${name}: workspace`);
  assert.equal(result.sessionId, fixture.status.sessionId, `${name}: sessionId`);
  assert.equal(result.busy, fixture.status.busy, `${name}: busy`);
  assert.equal(result.terminalDialog, fixture.status.terminalDialog, `${name}: terminalDialog`);
  assert.equal(result.issuesEnabled, fixture.status.issuesEnabled, `${name}: issuesEnabled`);
  const tabs = result.tabs as Array<{ id: string; label: string; key: string }>;
  assert.equal(tabs.length, fixture.status.issuesEnabled ? 9 : 8, `${name}: tab count`);
  assert.ok(tabs.every((tab) => tab.id && tab.label && tab.key), `${name}: tab shape`);
  assert.ok(Array.isArray(result.keys) && (result.keys as unknown[]).length > 0, `${name}: keys`);
  assert.deepEqual(result.windows, [], `${name}: windows`);
}

async function checkSnapshot(name: string, fixture: ScenarioFixture, call: Call): Promise<void> {
  const answer = await call("lobby.snapshot");
  assert.equal(answer.status, 200, `${name}: lobby.snapshot`);
  const result = answer.payload.result ?? {};
  assert.equal((result.chat as unknown[]).length, fixture.feed.chat.length, `${name}: chat`);
  assert.equal((result.activity as unknown[]).length, fixture.feed.activity.length, `${name}: activity`);
  assert.equal((result.thoughts as unknown[]).length, fixture.feed.thoughts.length, `${name}: thoughts`);
  assert.equal(result.hasOlderChat, fixture.feed.chatOlder, `${name}: hasOlderChat`);
  assert.equal(result.reply ?? "", fixture.feed.reply, `${name}: reply`);
}

async function checkSend(name: string, fixture: ScenarioFixture, call: Call): Promise<void> {
  const sent = await call("lobby.send", { text: "hello mock" });
  assert.equal(sent.status, 200, `${name}: lobby.send`);
  const marker = fixture.oracleReply.slice(0, 24);
  const streamed = await waitFor(async () => {
    const snapshot = await call("lobby.snapshot");
    const result = snapshot.payload.result ?? {};
    return (result.reply as string ?? "").includes(marker) || chatHas(result, marker);
  });
  assert.equal(streamed, true, `${name}: the scripted oracle streams back`);
  const empty = await call("lobby.send", { text: "   " });
  assert.equal(empty.payload.result?.notice, "type something first", `${name}: blank send`);
}

function chatHas(result: Record<string, unknown>, marker: string): boolean {
  const chat = result.chat as Array<{ text: string }>;
  return chat.some((entry) => entry.text.includes(marker));
}

async function checkPrompts(name: string, fixture: ScenarioFixture, call: Call): Promise<void> {
  const listed = await call("prompts.list");
  assert.equal(listed.status, 200, `${name}: prompts.list`);
  const prompts = (listed.payload.result?.prompts ?? []) as Array<{ id: string; kind: string; createdAt: number; from: string; payload: unknown }>;
  assert.ok(prompts.length >= fixture.prompts.length, `${name}: prompt count`);
  for (const prompt of prompts) {
    assert.ok(KINDS.includes(prompt.kind), `${name}: prompt kind`);
    assert.equal(typeof prompt.createdAt, "number", `${name}: createdAt`);
  }
  if (prompts.length > 0) {
    const first = prompts[0]!;
    const won = await call("prompts.answer", { id: first.id, answer: "mock answer" });
    assert.deepEqual(won.payload, { ok: true, result: { notice: "answer sent" } }, `${name}: prompts.answer`);
    const late = await call("prompts.answer", { id: first.id, answer: "late" });
    assert.equal(late.status, 409, `${name}: late answer is 409`);
    assert.equal(late.payload.code, "question_withdrawn", `${name}: late code`);
  } else {
    const unknown = await call("prompts.answer", { id: "p0-never", answer: false });
    assert.equal(unknown.status, 409, `${name}: unknown answer is 409`);
    assert.equal(unknown.payload.code, "question_withdrawn", `${name}: unknown code`);
  }
  assert.deepEqual((await call("prompts.dismiss", { id: "p0-never" })).payload, { ok: true, result: {} }, `${name}: prompts.dismiss`);
  if (fixture.questionAfterSend) {
    const marker = JSON.stringify(fixture.questionAfterSend.payload).slice(0, 40);
    const arrived = await waitFor(async () => {
      const relisted = await call("prompts.list");
      const current = (relisted.payload.result?.prompts ?? []) as Array<{ payload: unknown }>;
      return current.some((entry) => JSON.stringify(entry.payload).includes(marker));
    });
    assert.equal(arrived, true, `${name}: the scripted questionnaire arrives after a send`);
  }
}
