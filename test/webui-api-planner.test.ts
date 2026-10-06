/**
 * The Plan-tab calls over HTTP: reading the planning session, starting over,
 * messaging the panel, seating members, retrying, commenting on a draft line,
 * answering the questions and saving the draft. Behaviour runs against a
 * real `LobbyService` over a temp project; agent-backed calls (send, answer,
 * save with a split) run against the mock instead. The last test sweeps
 * every mock scenario.
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
import type { Runtime } from "../src/lobby/runtime.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { PlanningSession } from "../src/lobby/planner.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import { plannerEditMessage, plannerGet } from "../src/webui/api/planner.ts";
import type { ApiContext } from "../src/webui/api/index.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-planner-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-planner-dist-"));
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

function fakeState() {
  const root = mkdtempSync(join(tmpdir(), "bl-planner-root-"));
  ensureProjectStructure(root, ".pi");
  const ctx = {
    cwd: root,
    ui: { notify() {} },
    sessionManager: { getSessionId: () => "session-1", getBranch: () => [] },
    isIdle: () => true,
    abort() {},
  } as unknown as ExtensionContext;
  const pi = {
    sendUserMessage() {},
    getSessionName: () => "test window",
  } as unknown as ExtensionAPI;
  return { root, ctx, pi };
}

async function setup() {
  const state = fakeState();
  const service = createLobbyService({ ...state, configDir: ".pi" } as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { server, call, service, state, close: () => server.close() };
}

test("planner edits rerun corrected history without duplicating a user turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-edit-plan-"));
  const prompts: string[] = [];
  const runProcess: ProcessRunner = async (_args, options) => {
    prompts.push(options.prompt ?? "");
    const text = "## Status\nREADY\n## Title\nCorrected\n## Plan\n1. Corrected plan";
    return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } }), stderr: "", killed: false, timedOut: false };
  };
  let rounds = 0;
  const session = new PlanningSession({ cwd: root, root, configDir: ".pi", panel: [], profile: () => ({ model: "p/model", thinking: "low", timeoutMs: 1000, instructions: "" }), runProcess, onRound: () => { rounds++; } });
  session.messages = [{ role: "you", text: "old idea", at: 1 }, { role: "planner", text: "prior reply", at: 2 }, { role: "you", text: "later answer", at: 3, settled: [{ from: "QA", question: "which?", answer: "yes" }] }];
  session.reply = { status: "ready", questions: [], plan: "stale draft" };
  const pending = session.editMessage(0, 1, " corrected idea ");
  assert.equal(session.messages[0]!.text, "corrected idea");
  assert.equal(session.messages[0]!.at, 1);
  assert.ok(session.messages[0]!.editedAt);
  assert.equal(session.reply, undefined);
  assert.equal(session.messages.length, 3);
  await pending;
  assert.equal(rounds, 1);
  assert.equal(session.messages.filter((message) => message.role === "you").length, 2);
  assert.equal(session.settled[0]!.answer, "yes");
  assert.match(prompts[0]!, /corrected idea/);
  assert.doesNotMatch(prompts[0]!, /old idea|stale draft/);
  await assert.rejects(session.editMessage(0, 999, "stale"), /has changed/);
  await assert.rejects(session.editMessage(1, 2, "panel"), /ordinary user/);
  await assert.rejects(session.editMessage(2, 3, "answered"), /ordinary user/);
  await assert.rejects(session.editMessage(0, 1, "  "), /needs some text/);
  session.status = "thinking";
  await assert.rejects(session.editMessage(0, 1, "busy"), /still thinking/);
});

test("planner.editMessage HTTP validates missing, stale, busy, panel, answered and blank inputs", async () => {
  const { call, service, close } = await setup();
  try {
    assert.equal((await call("planner.editMessage", { messageIndex: 0, at: 1, text: "ok" })).status, 404);
    await call("planner.new", {});
    const session = service.planner()!;
    session.messages = [{ role: "you", text: "idea", at: 1 }, { role: "planner", text: "reply", at: 2 }, { role: "you", text: "answer", at: 3, settled: [{ from: "QA", question: "q" }] }];
    const edit = (messageIndex: number, at: number, text = "ok") => call("planner.editMessage", { messageIndex, at, text });
    assert.equal((await edit(9, 1)).status, 409);
    assert.equal((await edit(0, 2)).status, 409);
    assert.equal((await edit(1, 2)).status, 403);
    assert.equal((await edit(2, 3)).status, 403);
    assert.equal((await edit(0, 1, "  ")).status, 400);
    assert.equal((await edit(-1, 1)).status, 400);
    assert.equal((await call("planner.editMessage", { messageIndex: 0, at: 1, text: "ok", extra: true })).status, 400);
    session.status = "thinking";
    assert.equal((await edit(0, 1)).status, 409);
  } finally { await close(); }
});

test("planner.editMessage returns a cloned updated message before its background round finishes", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-edit-response-"));
  const session = new PlanningSession({ cwd: root, root, configDir: ".pi", panel: [], profile: () => ({ model: "p/model", thinking: "low", timeoutMs: 1000, instructions: "" }), runProcess: async () => ({ exitCode: 1, stdout: "", stderr: "fake failure", killed: false, timedOut: false }) });
  session.messages = [{ role: "you", text: "old", at: 1 }];
  const ctx = { service: { planner: () => session } } as unknown as ApiContext;
  const result = plannerEditMessage({ messageIndex: 0, at: 1, text: "new" }, ctx);
  assert.equal(result.message.text, "new");
  assert.equal(result.message.at, 1);
  assert.ok(result.message.editedAt);
  assert.notEqual(result.message, session.messages[0]);
  assert.equal(plannerGet(ctx).messages[0]!.editedAt, result.message.editedAt);
  assert.equal(result.notice, "message edited — the panel revises the plan");
  while (session.busy) await new Promise((resolve) => setTimeout(resolve, 5));
});

test("planner.get starts empty; planner.new seats the panel from a seed or nothing", async () => {
  const { call, close } = await setup();
  try {
    const empty = await call("planner.get");
    assert.equal(empty.status, 200, empty.body);
    assert.deepEqual(empty.payload.result!.seats, ["backend", "designer", "qa", "researcher"]);
    assert.deepEqual(empty.payload.result!.messages, []);
    assert.deepEqual(empty.payload.result!.questions, []);
    assert.equal(empty.payload.result!.round, 0);
    assert.equal(empty.payload.result!.limit, 5);
    assert.equal(empty.payload.result!.retryable, false);
    assert.equal(empty.payload.result!.busy, false);
    assert.ok(!("draft" in empty.payload.result!), "no draft yet");
    const bad = await call("planner.new", { seats: ["oops"] });
    assert.equal(bad.status, 400);
    assert.equal(bad.payload.code, "bad_request");
    const seeded = await call("planner.new", { seed: { issue: { number: 7, title: "Dark mode" }, body: "dark mode #7" }, seats: ["backend", "qa"] });
    assert.equal(seeded.status, 200, seeded.body);
    assert.match(String(seeded.payload.result!.notice), /new planning session/);
    const started = await call("planner.get");
    assert.deepEqual(started.payload.result!.seats, ["backend", "qa"]);
    const plain = await call("planner.new", {});
    assert.equal(plain.status, 200, plain.body);
    assert.deepEqual((await call("planner.get")).payload.result!.seats, ["backend", "designer", "qa", "researcher"]);
  } finally {
    await close();
  }
});

test("planner.toggleSeat seats and unseats a member with the terminal's notice", async () => {
  const { call, close } = await setup();
  try {
    await call("planner.new", {});
    const out = await call("planner.toggleSeat", { member: "qa" });
    assert.equal(out.status, 200, out.body);
    assert.equal(out.payload.result!.seated, false);
    assert.equal(out.payload.result!.notice, "QA leaves the panel from the next round");
    const back = await call("planner.toggleSeat", { member: "qa" });
    assert.equal(back.payload.result!.seated, true);
    assert.equal(back.payload.result!.notice, "QA joins the panel from the next round and sits every round");
    const seats = (await call("planner.get")).payload.result!.seats as string[];
    assert.deepEqual([...seats].sort(), ["backend", "designer", "qa", "researcher"], "qa is seated again");
    const bad = await call("planner.toggleSeat", { member: "oops" });
    assert.equal(bad.status, 400);
    assert.equal(bad.payload.code, "bad_request");
  } finally {
    await close();
  }
});

test("planner.retry has nothing to redo on a quiet session and needs one first", async () => {
  const { call, close } = await setup();
  try {
    const missing = await call("planner.retry");
    assert.equal(missing.status, 404);
    assert.equal(missing.payload.code, "not_found");
    await call("planner.new", {});
    const quiet = await call("planner.retry");
    assert.equal(quiet.status, 200, quiet.body);
    assert.equal(quiet.payload.result!.notice, "nothing to retry");
  } finally {
    await close();
  }
});

test("planner.commentLine needs a draft and keeps the comment with the session", async () => {
  const { call, service, close } = await setup();
  try {
    await call("planner.new", {});
    const missing = await call("planner.commentLine", { line: "1. Do it", text: "why?" });
    assert.equal(missing.status, 409);
    assert.equal(missing.payload.code, "conflict", "no draft yet");
    const blank = await call("planner.commentLine", { line: "   ", text: "why?" });
    assert.equal(blank.status, 400);
    service.planner()!.reply = { status: "ready", questions: [], plan: "## Plan\n\n1. Do it" };
    service.planner()!.questions = [{ from: "ORACLE", text: "Why first?", options: [] }];
    const kept = await call("planner.commentLine", { line: "1. Do it", text: "why this way?" });
    assert.equal(kept.status, 200, kept.body);
    assert.equal(kept.payload.result!.notice, "comment kept — it goes with your answers (a answers the questions)");
    assert.equal(service.planner()!.lineComments.length, 1);
    const draft = await call("planner.get");
    assert.equal(draft.payload.result!.draft, "## Plan\n\n1. Do it");
  } finally {
    await close();
  }
});

test("planner.answer says when no questions wait; planner.save needs a draft", async () => {
  const { call, service, close } = await setup();
  try {
    const missing = await call("planner.answer");
    assert.equal(missing.status, 404);
    await call("planner.new", {});
    const none = await call("planner.answer");
    assert.equal(none.status, 200, none.body);
    assert.equal(none.payload.result!.notice, "no open questions");
    const unsaved = await call("planner.save");
    assert.equal(unsaved.status, 409);
    assert.equal(unsaved.payload.code, "conflict", "no draft yet");
    service.planner()!.reply = { status: "ready", questions: [], plan: "## Plan\n\n1. Do it" };
    const saved = await call("planner.save");
    assert.equal(saved.status, 200, saved.body);
    assert.match(String(saved.payload.result!.notice), /saved PLAN-.* to the pending tasks/);
    assert.ok(service.plans().some((plan) => plan.title !== ""), "the draft landed in the pending tasks");
  } finally {
    await close();
  }
});

test("planner.send refuses blanks without starting a round", async () => {
  const { call, close } = await setup();
  try {
    const blank = await call("planner.send", { text: "   " });
    assert.equal(blank.status, 400);
    assert.equal(blank.payload.code, "bad_request");
  } finally {
    await close();
  }
});

test("every scenario's mock answers the planner calls without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
      const got = await call("planner.get");
      assert.equal(got.status, 200, `${name}: planner.get`);
      const snapshot = got.payload.result!;
      for (const field of ["seats", "members", "messages", "questions", "notes", "round", "limit", "retryable", "busy"]) {
        assert.ok(field in snapshot, `${name}: planner.get carries ${field}`);
      }
      if (name === "full") {
        assert.deepEqual(snapshot.seats, ["backend", "designer", "qa", "researcher"], "full: the whole panel");
        assert.match(String(snapshot.draft), /^## Agreed plan\n\n1\. Read the theme\n2\. Add the toggle\n/, "full: the draft");
        assert.equal((snapshot.questions as unknown[]).length, 1, "full: one open question");
        const kept = await call("planner.commentLine", { line: "1. Read the theme", text: "why first?" });
        assert.equal(kept.status, 200, "full: planner.commentLine");
        const answered = await call("planner.answer");
        assert.equal(answered.status, 200, "full: planner.answer opens the questions");
        assert.equal(answered.payload.result!.notice, "answers sent — the panel is on the next round");
        const saved = await call("planner.save");
        assert.equal(saved.status, 200, "full: planner.save");
        assert.match(String(saved.payload.result!.notice), /saved PLAN-mock-1 to the pending tasks/);
      } else {
        assert.ok(!("draft" in snapshot), `${name}: no draft`);
        assert.equal((await call("planner.commentLine", { line: "1. x", text: "why?" })).status, 409, `${name}: comment without a draft is 409`);
        assert.equal((await call("planner.answer", {})).payload.result!.notice, "no open questions", `${name}: nothing to answer`);
        assert.equal((await call("planner.save", {})).status, 409, `${name}: nothing to save`);
      }
      assert.equal((await call("planner.send", { text: "   " })).status, 400, `${name}: blank send is 400`);
      const sent = await call("planner.send", { text: "plan the mock" });
      assert.equal(sent.status, 200, `${name}: planner.send`);
      const heard = await call("planner.get");
      assert.ok((heard.payload.result!.messages as unknown[]).length >= 1, `${name}: the message landed`);
      const seated = await call("planner.toggleSeat", { member: "qa" });
      assert.equal(seated.status, 200, `${name}: planner.toggleSeat`);
      assert.equal(typeof seated.payload.result!.seated, "boolean", `${name}: toggle says which way it went`);
      assert.equal((await call("planner.toggleSeat", { member: "oops" })).status, 400, `${name}: unknown seats are 400`);
      assert.equal((await call("planner.retry", {})).payload.result!.notice, "nothing to retry", `${name}: a quiet panel retries nothing`);
      const fresh = await call("planner.new", {});
      assert.equal(fresh.status, 200, `${name}: planner.new`);
      assert.equal((await call("planner.new", { seats: ["oops"] })).status, 400, `${name}: bad seats are 400`);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});
