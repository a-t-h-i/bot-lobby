/**
 * The Issues tab calls over HTTP: the open issues, one issue with its
 * comments, filing a new one, and the 404 when `lobby.issues` is off. They
 * run against a real `LobbyService` over the real `IssuesState` with a fake
 * `gh`; the last test sweeps every mock scenario.
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
import { IssuesState, type Exec, type ExecResult } from "../src/lobby/issues.ts";
import { createLobbyService } from "../src/lobby/service.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-issues-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-issues-dist-"));
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

const LIST = JSON.stringify([
  { number: 57, title: "Dark mode flashes white", author: { login: "ana" }, labels: [{ name: "bug" }], updatedAt: "2026-09-30T08:00:00Z", url: "https://gh/issues/57" },
  { number: 55, title: "Show the checklist", labels: [] },
  { title: "no number" },
]);

const VIEW = JSON.stringify({
  number: 57, title: "Dark mode flashes white", body: "The page paints white first.", state: "OPEN", author: { login: "ana" }, labels: [{ name: "bug" }], updatedAt: "2026-09-30T08:00:00Z", url: "https://gh/issues/57",
  comments: [{ author: { login: "bo" }, body: "Confirmed.", createdAt: "2026-09-30T09:00:00Z" }],
});

function fakeExec(responses: Record<string, Partial<ExecResult>>, calls: string[][] = []): Exec {
  return async (_command, args) => {
    calls.push(args);
    const response = responses[args.slice(0, 2).join(" ")] ?? { code: 1, stderr: "unexpected" };
    return { stdout: response.stdout ?? "", stderr: response.stderr ?? "", code: response.code ?? 0 };
  };
}

const GOOD = { "issue list": { stdout: LIST }, "issue view": { stdout: VIEW }, "issue create": { stdout: "https://github.com/x/y/issues/58\n" } };

async function setup(responses: Record<string, Partial<ExecResult>> = GOOD, enabled = true) {
  const root = mkdtempSync(join(tmpdir(), "bl-issues-root-"));
  ensureProjectStructure(root, ".pi");
  const calls: string[][] = [];
  const ctx = { cwd: root, ui: { notify() {} }, sessionManager: { getSessionId: () => "session-1", getBranch: () => [] }, isIdle: () => true, abort() {} } as unknown as ExtensionContext;
  const pi = { sendUserMessage() {}, getSessionName: () => "test window" } as unknown as ExtensionAPI;
  const state = { root, ctx, pi, configDir: ".pi", issues: new IssuesState(fakeExec(responses, calls), root) };
  const service = createLobbyService(state as unknown as Runtime);
  (service as unknown as { issuesEnabled: () => boolean }).issuesEnabled = () => enabled;
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { call, calls, close: () => server.close() };
}

test("issues.list lists the open issues; it reads gh once unless asked", async () => {
  const { call, calls, close } = await setup();
  try {
    const first = await call("issues.list");
    assert.equal(first.status, 200, first.body);
    assert.deepEqual(first.payload.result, {
      issues: [
        { number: 57, title: "Dark mode flashes white", labels: ["bug"], author: "ana", updatedAt: "2026-09-30T08:00:00Z", url: "https://gh/issues/57" },
        { number: 55, title: "Show the checklist", labels: [] },
      ],
      loading: false,
      loaded: true,
    });
    await call("issues.list");
    assert.equal(calls.filter((args) => args[1] === "list").length, 1);
    await call("issues.list", { refresh: true });
    assert.equal(calls.filter((args) => args[1] === "list").length, 2);
  } finally {
    await close();
  }
});

test("issues.list answers gh's one-line failure and does not retry it until asked", async () => {
  const { call, calls, close } = await setup({ "issue list": { code: 1, stderr: "none of the git remotes configured for this repository point to a known GitHub host" } });
  try {
    const first = await call("issues.list");
    assert.equal(first.status, 200, first.body);
    assert.deepEqual(first.payload.result, { issues: [], loading: false, loaded: false, error: "This project has no GitHub remote gh can use." });
    await call("issues.list");
    assert.equal(calls.length, 1);
  } finally {
    await close();
  }
});

test("issues.get reads the description and comments; unknown numbers are 404, other failures 500", async () => {
  const { call, close } = await setup();
  try {
    const got = await call("issues.get", { number: 57 });
    assert.equal(got.status, 200, got.body);
    assert.deepEqual(got.payload.result, {
      issue: { number: 57, title: "Dark mode flashes white", labels: ["bug"], author: "ana", updatedAt: "2026-09-30T08:00:00Z", url: "https://gh/issues/57", body: "The page paints white first.", state: "OPEN", comments: [{ author: "bo", body: "Confirmed.", createdAt: "2026-09-30T09:00:00Z" }] },
    });
  } finally {
    await close();
  }
  const missing = await setup({ "issue view": { code: 1, stderr: "GraphQL: Could not resolve to an issue with the number of 999." } });
  try {
    const answer = await missing.call("issues.get", { number: 999 });
    assert.equal(answer.status, 404, answer.body);
    assert.equal(answer.payload.code, "not_found");
  } finally {
    await missing.close();
  }
  const broken = await setup({ "issue view": { code: 127 } });
  try {
    const answer = await broken.call("issues.get", { number: 57 });
    assert.equal(answer.status, 500, answer.body);
    assert.equal(answer.payload.code, "failed");
  } finally {
    await broken.close();
  }
});

test("issues.create files the issue (first line the title) and answers the terminal's notice", async () => {
  const { call, calls, close } = await setup();
  try {
    const made = await call("issues.create", { text: "# Add a dark mode\n\nPlease." });
    assert.equal(made.status, 200, made.body);
    assert.equal(made.payload.result!.notice, "created #58 — https://github.com/x/y/issues/58");
    const create = calls.find((args) => args[1] === "create")!;
    assert.deepEqual([create[create.indexOf("--title") + 1], create[create.indexOf("--body") + 1]], ["Add a dark mode", "Please."]);
    assert.ok(calls.some((args) => args[1] === "list"), "the list is reloaded after filing");
    const blank = await call("issues.create", { text: "  \n " });
    assert.equal(blank.payload.result!.notice, "type something first");
  } finally {
    await close();
  }
  const failing = await setup({ "issue create": { code: 1, stderr: "HTTP 403: Resource not accessible" } });
  try {
    const answer = await failing.call("issues.create", { text: "A title" });
    assert.equal(answer.status, 500, answer.body);
    assert.equal(answer.payload.code, "failed");
    assert.equal(answer.payload.error, "HTTP 403: Resource not accessible");
  } finally {
    await failing.close();
  }
});

test("with lobby.issues off every issues call is a 404", async () => {
  const { call, calls, close } = await setup(GOOD, false);
  try {
    for (const [name, body] of [["issues.list", {}], ["issues.get", { number: 57 }], ["issues.create", { text: "A title" }]] as const) {
      const answer = await call(name, body);
      assert.equal(answer.status, 404, name);
      assert.equal(answer.payload.code, "not_found");
      assert.equal(answer.payload.error, "issues are off (lobby.issues)");
    }
    assert.equal(calls.length, 0, "gh is never run");
  } finally {
    await close();
  }
});

test("the issues calls refuse bad numbers, overlong text and unknown fields", async () => {
  const { call, close } = await setup();
  try {
    for (const [name, body] of [["issues.get", { number: 0 }], ["issues.get", { number: "57" }], ["issues.get", {}], ["issues.create", { text: "x".repeat(20_001) }], ["issues.create", {}], ["issues.create", { text: "a", extra: 1 }], ["issues.list", { refresh: 1 }], ["issues.list", { more: 1 }]] as const) {
      const answer = await call(name, body);
      assert.equal(answer.status, 400, `${name} ${JSON.stringify(body).slice(0, 40)}`);
      assert.equal(answer.payload.code, "bad_request");
    }
  } finally {
    await close();
  }
});

test("every scenario's mock answers the issues calls without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
      const on = name === "issues";
      const listed = await call("issues.list");
      assert.equal(listed.status, on ? 200 : 404, `${name}: issues.list`);
      assert.equal((await call("issues.get", { number: 57 })).status, on ? 200 : 404, `${name}: issues.get`);
      assert.equal((await call("issues.create", { text: "A title\n\nbody" })).status, on ? 200 : 404, `${name}: issues.create`);
      if (!on) continue;
      const after = (await call("issues.list")).payload.result as unknown as { issues: Array<{ number: number }> };
      assert.deepEqual(after.issues.map((issue) => issue.number), [61, 60, 59, 58, 57, 55, 51], `${name}: the new issue leads the list`);
      const detail = (await call("issues.get", { number: 57 })).payload.result as unknown as { issue: { comments: unknown[]; body: string } };
      assert.equal(detail.issue.comments.length, 1);
      assert.match(detail.issue.body, /paints white/);
      assert.equal((await call("issues.get", { number: 999 })).status, 404, `${name}: unknown number`);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});
