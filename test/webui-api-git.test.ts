/**
 * The Git tab calls over HTTP: the pull request list with checks, size and
 * stale marks, one pull request with our review and Jev's read, starting and
 * stopping a review. They run against a real `LobbyService` over the real
 * `PullsState`/`PullReviews` with a fake `gh` and a fake agent process; the
 * last test sweeps every mock scenario.
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
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import { IssuesState, type Exec, type ExecResult } from "../src/lobby/issues.ts";
import { PullsState } from "../src/lobby/pulls.ts";
import { PullReviews, saveReview } from "../src/lobby/pr-review.ts";
import { createLobbyService } from "../src/lobby/service.ts";
import type { Runtime } from "../src/lobby/runtime.ts";
import { createFixtureService, disposeFixtureService } from "../src/webui/dev/fake-service.ts";
import { SCENARIOS } from "../src/webui/dev/fixtures.ts";
import { startWebServer } from "../src/webui/server.ts";

process.env.BOT_LOBBY_CONFIG_DIR ??= mkdtempSync(join(tmpdir(), "bl-git-"));

const DIST = mkdtempSync(join(tmpdir(), "bl-git-dist-"));
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
  { number: 12, title: "Fix the table font", author: { login: "ana" }, headRefName: "fix/table-font", baseRefName: "main", isDraft: false, updatedAt: "2026-09-28T10:00:00Z", url: "https://gh/12", additions: 12, deletions: 3, changedFiles: 2, reviewDecision: "APPROVED", statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }], labels: [{ name: "ui" }], headRefOid: "abc123" },
  { number: 13, title: "Draft: rework auth", author: { login: "bo" }, headRefName: "auth", baseRefName: "main", isDraft: true, additions: 400, deletions: 90, changedFiles: 14, reviewDecision: "", statusCheckRollup: [{ conclusion: "FAILURE" }], labels: [], headRefOid: "def456" },
]);

const VIEW = JSON.stringify({
  number: 12, title: "Fix the table font", body: "Uses Inter.", state: "OPEN", mergeable: "MERGEABLE", author: { login: "ana" }, headRefName: "fix/table-font", baseRefName: "main", isDraft: false, additions: 12, deletions: 3, changedFiles: 2, headRefOid: "abc123",
  statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }], labels: [],
  files: [{ path: "src/table.css", additions: 10, deletions: 2 }, { path: "src/table.ts", additions: 2, deletions: 1 }],
  reviews: [{ author: { login: "bo" }, state: "CHANGES_REQUESTED", body: "Please add a test.", submittedAt: "2026-09-28T11:00:00Z" }],
  comments: [{ author: { login: "ana" }, body: "Added.", createdAt: "2026-09-28T11:30:00Z" }],
});

const REVIEW = "## Verdict\nREQUEST CHANGES\n\n## Summary\nSwaps the font.\n\n## Findings\n- **major** `src/table.css:1` — the fallback stack is gone.";

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 900, output: 300, cost: { total: 0.05 } } } });
}

function fakeExec(responses: Record<string, Partial<ExecResult>>, calls: string[][] = []): Exec {
  return async (_command, args) => {
    calls.push(args);
    const response = responses[args.slice(0, 2).join(" ")] ?? { code: 1, stderr: "unexpected" };
    return { stdout: response.stdout ?? "", stderr: response.stderr ?? "", code: response.code ?? 0 };
  };
}

const GOOD = { "pr list": { stdout: LIST }, "pr view": { stdout: VIEW }, "pr diff": { stdout: "diff --git a/x b/x\n" } };

const answered: ProcessRunner = async () => ({ exitCode: 0, stdout: reply(REVIEW), stderr: "", killed: false, timedOut: false });
const hanging: ProcessRunner = (_args, options) => new Promise((resolve) => options.signal?.addEventListener("abort", () => resolve({ exitCode: 1, stdout: "", stderr: "", killed: true, timedOut: false }), { once: true }));

async function setup(responses: Record<string, Partial<ExecResult>> = GOOD, runProcess: ProcessRunner = answered) {
  const root = mkdtempSync(join(tmpdir(), "bl-git-root-"));
  ensureProjectStructure(root, ".pi");
  const calls: string[][] = [];
  const exec = fakeExec(responses, calls);
  const ctx = { cwd: root, ui: { notify() {} }, sessionManager: { getSessionId: () => "session-1", getBranch: () => [] }, isIdle: () => true, abort() {} } as unknown as ExtensionContext;
  const pi = { sendUserMessage() {}, getSessionName: () => "test window" } as unknown as ExtensionAPI;
  const reviews = new PullReviews({ cwd: root, root, configDir: ".pi", exec, profile: () => ({ model: "p/qa", thinking: "medium", timeoutMs: 60_000 }), runProcess });
  const state = { root, ctx, pi, configDir: ".pi", pulls: new PullsState(exec, root), issues: new IssuesState(exec, root), reviews };
  const service = createLobbyService(state as unknown as Runtime);
  const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
  const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
  const call = async (name: string, body: unknown = {}) => send(server.port, `/api/${name}`, { ...json, cookie }, JSON.stringify(body));
  return { call, root, calls, reviews, close: async () => { reviews.cancelAll(); await server.close(); } };
}

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("timed out waiting");
}

test("git.pulls lists the open pull requests with checks, size and a stale mark; it reads gh once unless asked", async () => {
  const { call, root, calls, close } = await setup();
  try {
    saveReview(root, ".pi", { number: 12, status: "done", verdict: "changes", text: REVIEW, startedAt: 1, finishedAt: 2, steps: [], headSha: "old000" });
    const first = await call("git.pulls");
    assert.equal(first.status, 200, first.body);
    const result = first.payload.result as unknown as { pulls: Array<Record<string, unknown>>; loading: boolean; loaded: boolean; error?: string };
    assert.deepEqual([result.loaded, result.loading, result.error], [true, false, undefined]);
    assert.deepEqual(result.pulls[0], { number: 12, title: "Fix the table font", author: "ana", headRef: "fix/table-font", baseRef: "main", draft: false, updatedAt: "2026-09-28T10:00:00Z", url: "https://gh/12", additions: 12, deletions: 3, changedFiles: 2, decision: "APPROVED", checks: "passing", checkCount: 1, labels: ["ui"], review: { status: "done", verdict: "changes", stale: true } });
    assert.deepEqual([result.pulls[1]!.draft, result.pulls[1]!.checks, result.pulls[1]!.review], [true, "failing", undefined]);
    assert.ok(!("headSha" in result.pulls[0]!), "the head commit stays server-side");
    await call("git.pulls");
    assert.equal(calls.filter((args) => args[1] === "list").length, 1, "cached after the first read");
    await call("git.pulls", { refresh: true });
    assert.equal(calls.filter((args) => args[1] === "list").length, 2, "refresh asks gh again");
  } finally {
    await close();
  }
});

test("git.pulls answers gh's one-line failure and does not retry it until asked", async () => {
  const { call, calls, close } = await setup({ "pr list": { code: 127 } });
  try {
    const first = await call("git.pulls");
    assert.equal(first.status, 200, first.body);
    assert.deepEqual(first.payload.result, { pulls: [], loading: false, loaded: false, error: "GitHub CLI (gh) is not installed — install it from https://cli.github.com and run `gh auth login`." });
    await call("git.pulls");
    assert.equal(calls.length, 1, "a change event refetching must not loop on a failure");
    await call("git.pulls", { refresh: true });
    assert.equal(calls.length, 2);
  } finally {
    await close();
  }
});

test("git.pull reads the files, description and discussion", async () => {
  const { call, close } = await setup();
  try {
    const bare = await call("git.pull", { number: 12 });
    assert.equal(bare.status, 200, bare.body);
    const bareResult = bare.payload.result as unknown as { pull: Record<string, unknown>; review?: unknown; read?: unknown };
    assert.equal(bareResult.review, undefined);
    assert.equal(bareResult.read, undefined);
    assert.equal(bareResult.pull.body, "Uses Inter.");
    assert.deepEqual([bareResult.pull.state, bareResult.pull.mergeable, bareResult.pull.number, bareResult.pull.checks], ["OPEN", "MERGEABLE", 12, "passing"]);
    assert.deepEqual(bareResult.pull.files, [{ path: "src/table.css", additions: 10, deletions: 2 }, { path: "src/table.ts", additions: 2, deletions: 1 }]);
    assert.deepEqual((bareResult.pull.notes as Array<{ author: string; state?: string }>).map((note) => [note.author, note.state ?? "comment"]), [["bo", "CHANGES_REQUESTED"], ["ana", "comment"]]);
    assert.ok(!("headSha" in bareResult.pull));
  } finally {
    await close();
  }
});

test("git.pull carries a kept review (stale once the head moves) and Jev's read", async () => {
  const { call, root, reviews, close } = await setup();
  try {
    saveReview(root, ".pi", { number: 12, status: "done", verdict: "approve", text: "## Verdict\nAPPROVE", startedAt: 1, finishedAt: 2, steps: [], headSha: "abc123", model: "p/qa" });
    reviews.reads.set(12, { number: 12, status: "done", line: "small · low risk", read: { size: "small", sizeConfidence: 0.9, risky: 0.1, breaking: 0, security: 0, testsMissing: 0.2, model: "m", ms: 5 } });
    const result = (await call("git.pull", { number: 12 })).payload.result as unknown as { review: Record<string, unknown>; read: Record<string, unknown> };
    assert.deepEqual([result.review.status, result.review.verdict, result.review.saved, result.review.stale], ["done", "approve", true, false]);
    assert.equal(result.read.line, "small · low risk");
    saveReview(root, ".pi", { number: 13, status: "done", verdict: "changes", text: "x", startedAt: 1, steps: [], headSha: "moved" });
    const stale = (await call("git.pull", { number: 13 })).payload.result as unknown as { review: { stale: boolean } };
    assert.equal(stale.review.stale, true, "the pull request's head is abc123 now, the review saw `moved`");
  } finally {
    await close();
  }
});

test("git.pull answers 404 for a number gh cannot find and 500 with gh's line for other failures", async () => {
  const missing = await setup({ "pr view": { code: 1, stderr: "GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)" } });
  try {
    const answer = await missing.call("git.pull", { number: 999 });
    assert.equal(answer.status, 404, answer.body);
    assert.equal(answer.payload.code, "not_found");
  } finally {
    await missing.close();
  }
  const noGh = await setup({ "pr view": { code: 127 } });
  try {
    const answer = await noGh.call("git.pull", { number: 12 });
    assert.equal(answer.status, 500, answer.body);
    assert.equal(answer.payload.code, "failed");
    assert.match(String(answer.payload.error), /GitHub CLI \(gh\) is not installed/);
  } finally {
    await noGh.close();
  }
});

test("git.review runs a read-only agent and the finished review shows with git.pull; nothing is posted", async () => {
  const { call, calls, close } = await setup();
  try {
    const started = await call("git.review", { number: 12, focus: "  is the fallback stack gone?  " });
    assert.equal(started.status, 200, started.body);
    assert.equal(started.payload.result!.notice, "reviewing #12 — looking at: is the fallback stack gone? — it streams into the activity log");
    await until(async () => ((await call("git.pull", { number: 12 })).payload.result as { review?: { status: string } }).review?.status === "done");
    const done = (await call("git.pull", { number: 12 })).payload.result as unknown as { review: Record<string, unknown> };
    assert.deepEqual([done.review.verdict, done.review.focus, done.review.model, done.review.stale], ["changes", "is the fallback stack gone?", "p/served", false]);
    assert.equal(done.review.text, REVIEW);
    assert.ok(!("headSha" in done.review));
    const listed = (await call("git.pulls")).payload.result as unknown as { pulls: Array<{ number: number; review?: unknown }> };
    assert.deepEqual(listed.pulls.find((pull) => pull.number === 12)!.review, { status: "done", verdict: "changes", stale: false });
    assert.ok(calls.every((args) => !["comment", "review", "merge", "close"].includes(args[1] ?? "")), "gh is only read from");
  } finally {
    await close();
  }
});

test("git.review twice says it is running; git.cancelReview stops it, then says none runs", async () => {
  const { call, close } = await setup(GOOD, hanging);
  try {
    await call("git.review", { number: 12 });
    const again = await call("git.review", { number: 12 });
    assert.equal(again.payload.result!.notice, "already reviewing #12");
    const stopped = await call("git.cancelReview", { number: 12 });
    assert.equal(stopped.payload.result!.notice, "stopping the review of #12");
    await until(async () => ((await call("git.pull", { number: 12 })).payload.result as { review?: { status: string } }).review?.status === "cancelled");
    const none = await call("git.cancelReview", { number: 12 });
    assert.equal(none.payload.result!.notice, "no review of #12 is running");
  } finally {
    await close();
  }
});

test("git.jev asks for a quick read; with Jev off the read says so", async () => {
  const { call, close } = await setup();
  try {
    const asked = await call("git.jev", { number: 12 });
    assert.equal(asked.status, 200, asked.body);
    assert.equal(asked.payload.result!.notice, "asking Jev to read #12…");
    await until(async () => ((await call("git.pull", { number: 12 })).payload.result as { read?: { status: string } }).read?.status === "failed");
    const read = ((await call("git.pull", { number: 12 })).payload.result as unknown as { read: { error: string } }).read;
    assert.match(read.error, /^Jev is off/);
  } finally {
    await close();
  }
});

test("the git calls refuse bad numbers and unknown fields", async () => {
  const { call, close } = await setup();
  try {
    for (const [name, body] of [["git.pull", { number: 0 }], ["git.pull", { number: "12" }], ["git.pull", { number: 1.5 }], ["git.pull", {}], ["git.review", { number: 12, focus: "x".repeat(2001) }], ["git.review", { number: 12, extra: 1 }], ["git.cancelReview", { number: -1 }], ["git.jev", { number: 12, extra: 1 }], ["git.pulls", { refresh: "yes" }], ["git.pulls", { more: 1 }]] as const) {
      const answer = await call(name, body);
      assert.equal(answer.status, 400, `${name} ${JSON.stringify(body)}`);
      assert.equal(answer.payload.code, "bad_request");
    }
  } finally {
    await close();
  }
});

test("every scenario's mock answers the git calls without throwing", async () => {
  for (const name of SCENARIOS) {
    const service = createFixtureService(name);
    const server = await startWebServer({ service, port: 0, secret: randomBytes(32), dist: DIST });
    try {
      const cookie = await login(server.port, new URL(server.link).hash.replace("#token=", ""));
      const call = async (api: string, body: unknown = {}) => send(server.port, `/api/${api}`, { ...json, cookie }, JSON.stringify(body));
      const listed = await call("git.pulls");
      assert.equal(listed.status, 200, `${name}: git.pulls`);
      const pulls = listed.payload.result!.pulls as Array<{ number: number; review?: { stale: boolean } }>;
      if (name === "full" || name === "issues") {
        assert.deepEqual(pulls.map((pull) => pull.number), [42, 41, 39], `${name}: pulls from the fixture`);
        assert.equal(pulls[0]!.review?.stale, true, `${name}: #42's review is stale`);
        assert.equal(pulls[1]!.review?.stale, false, `${name}: #41's review is current`);
        const detail = await call("git.pull", { number: 42 });
        assert.equal(detail.status, 200, `${name}: git.pull`);
        const result = detail.payload.result as unknown as { pull: { files: unknown[]; notes: unknown[] }; review: { verdict: string } };
        assert.deepEqual([result.pull.files.length, result.pull.notes.length, result.review.verdict], [3, 2, "changes"]);
        const read = (await call("git.pull", { number: 41 })).payload.result as unknown as { read: { status: string } };
        assert.equal(read.read.status, "done", `${name}: Jev's read from the fixture`);
      } else {
        assert.equal(pulls.length, 0, `${name}: no pulls`);
      }
      assert.equal((await call("git.pull", { number: 999 })).status, 404, `${name}: unknown number`);
      assert.equal((await call("git.review", { number: 41, focus: "tests" })).status, 200, `${name}: git.review`);
      assert.equal((await call("git.cancelReview", { number: 41 })).status, 200, `${name}: git.cancelReview`);
      assert.equal((await call("git.jev", { number: 41 })).status, 200, `${name}: git.jev`);
    } finally {
      disposeFixtureService(service);
      await server.close();
    }
  }
});
