import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { checkFingerprint, finalChecks, runVerification, staleVerification, verificationSummary, type VerifyCheck, type VerifyExec } from "../src/execution/verification.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { createTask, type Task, type TaskState } from "../src/schemas/task.ts";
import { createTaskDir, ensureProjectStructure, loadTask, saveTask } from "../src/state/persistence.ts";
import { transition } from "../src/state/task-state.ts";
import { runWorkflowAction, type OrchestrateParams, type WorkflowDeps } from "../src/workflow/workflow.ts";

let ambientConfig: string | undefined;
before(() => {
  ambientConfig = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bl-vf-cfg-"));
});
after(() => {
  if (ambientConfig === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
  else process.env.BOT_LOBBY_CONFIG_DIR = ambientConfig;
});

/** A repo folder with one source file, so fingerprints have real inputs. */
function fixtureRepo(): string {
  const top = mkdtempSync(join(tmpdir(), "vf-repo-"));
  mkdirSync(join(top, "src"), { recursive: true });
  writeFileSync(join(top, "package.json"), JSON.stringify({ name: "fixture", scripts: {} }, null, 2));
  writeFileSync(join(top, "src", "main.ts"), "export const one = 1;\n");
  return top;
}

function check(id: string): VerifyCheck {
  return { id, command: "node", args: ["-e", "0"], timeoutMs: 5_000, inputs: ["src", "package.json"] };
}

function countingExec(codes: number[]): VerifyExec & { calls: number } {
  const exec = async () => ({ code: codes[Math.min(exec.calls++, codes.length - 1)] ?? 0, output: `run ${exec.calls}`, timedOut: false });
  exec.calls = 0;
  return exec;
}

test("a passing check passes the report; a failing one fails it with an actionable summary", async () => {
  const top = fixtureRepo();
  const passing = await runVerification({ top, checks: [check("typecheck")], exec: countingExec([0]) });
  assert.equal(passing.state, "passing");
  assert.equal(passing.results[0]!.state, "pass");
  const failing = await runVerification({ top, checks: [check("typecheck")], exec: countingExec([1]) });
  assert.equal(failing.state, "failing");
  assert.match(failing.results[0]!.summary, /typecheck failed with exit 1/);
  assert.match(verificationSummary(failing), /typecheck failed with exit 1/);
});

test("a recorded pass is reused while its inputs are unchanged, and re-run once they change", async () => {
  const top = fixtureRepo();
  const exec = countingExec([0]);
  const first = await runVerification({ top, checks: [check("typecheck")], exec });
  assert.equal(exec.calls, 1);
  const second = await runVerification({ top, checks: [check("typecheck")], exec, previous: first });
  assert.equal(exec.calls, 1, "an unchanged pass is not re-run");
  assert.equal(second.results[0]!.reused, true);
  writeFileSync(join(top, "src", "main.ts"), "export const one = 2;\n");
  const third = await runVerification({ top, checks: [check("typecheck")], exec, previous: first });
  assert.equal(exec.calls, 2, "a changed input re-runs the check");
  assert.equal(third.results[0]!.reused, undefined);
  assert.equal(third.state, "passing");
});

test("a content edit that restores the original mtime still invalidates a recorded pass", async () => {
  const top = fixtureRepo();
  const exec = countingExec([0]);
  const first = await runVerification({ top, checks: [check("typecheck")], exec });
  const before = checkFingerprint(top, check("typecheck"));
  const stat = statSync(join(top, "src", "main.ts"));
  writeFileSync(join(top, "src", "main.ts"), "export const one = 2;\n");
  utimesSync(join(top, "src", "main.ts"), stat.atime, stat.mtime);
  assert.notEqual(checkFingerprint(top, check("typecheck")), before, "fingerprints follow content, not size and mtime");
  const second = await runVerification({ top, checks: [check("typecheck")], exec, previous: first });
  assert.equal(exec.calls, 2, "the tampered edit re-runs the check instead of reusing the pass");
});

test("edits made during verification invalidate an otherwise passing check", async () => {
  const top = fixtureRepo();
  const exec: VerifyExec = async () => {
    writeFileSync(join(top, "src", "main.ts"), "export const one = 3;\n");
    return { code: 0, output: "", timedOut: false };
  };
  const result = await runVerification({ top, checks: [check("typecheck")], exec });
  assert.equal(result.state, "failing");
  assert.match(result.results[0]!.summary, /inputs changed during verification/);
});

test("a cached dependent check cannot pass when its prerequisite fails", async () => {
  const top = fixtureRepo();
  const build = { ...check("web:build"), inputs: ["src"] };
  const browser = { ...check("web:check"), inputs: ["package.json"], dependsOn: ["web:build"] };
  const previous = await runVerification({ top, checks: [build, browser], exec: countingExec([0]) });
  writeFileSync(join(top, "src", "main.ts"), "export const one = 3;\n");
  const result = await runVerification({ top, checks: [build, browser], previous, exec: countingExec([1]) });
  assert.equal(result.state, "failing");
  assert.equal(result.results[1]!.state, "unavailable");
});

test("concurrent verification of the same check shares one execution", async () => {
  const top = fixtureRepo();
  const exec = countingExec([0]);
  const [a, b] = await Promise.all([
    runVerification({ top, checks: [check("typecheck")], exec }),
    runVerification({ top, checks: [check("typecheck")], exec }),
  ]);
  assert.equal(exec.calls, 1, "single-flight: one execution serves both callers");
  assert.equal(a.state, "passing");
  assert.equal(b.state, "passing");
});

test("one caller's cancellation never cancels another caller sharing the same check", async () => {
  const top = fixtureRepo();
  let calls = 0;
  let aborted = false;
  let finish!: () => void;
  const exec: VerifyExec = (_command, _args, options) => new Promise((resolve) => {
    calls += 1;
    options.signal?.addEventListener("abort", () => { aborted = true; resolve({ code: null, output: "", timedOut: false }); }, { once: true });
    finish = () => resolve({ code: 0, output: "", timedOut: false });
  });
  const chat = new AbortController();
  const task = new AbortController();
  const first = runVerification({ top, checks: [check("typecheck")], exec, signal: chat.signal });
  const second = runVerification({ top, checks: [check("typecheck")], exec, signal: task.signal });
  await delay(10);
  chat.abort();
  assert.equal((await first).results[0]!.state, "cancelled", "the caller that aborted sees its own cancellation");
  assert.equal(aborted, false, "the shared run keeps going while another caller still waits");
  finish();
  assert.equal((await second).state, "passing", "the other caller still gets the real result");
  assert.equal(calls, 1);
});

test("the shared run stops only once every waiting caller has aborted, and is never joined again", async () => {
  const top = fixtureRepo();
  let calls = 0;
  let aborts = 0;
  const exec: VerifyExec = (_command, _args, options) => new Promise((resolve) => {
    calls += 1;
    options.signal?.addEventListener("abort", () => { aborts += 1; resolve({ code: null, output: "", timedOut: false }); }, { once: true });
    if (calls > 1) resolve({ code: 0, output: "", timedOut: false });
  });
  const a = new AbortController();
  const b = new AbortController();
  const runs = [runVerification({ top, checks: [check("typecheck")], exec, signal: a.signal }), runVerification({ top, checks: [check("typecheck")], exec, signal: b.signal })];
  await delay(10);
  a.abort();
  b.abort();
  for (const report of await Promise.all(runs)) assert.equal(report.results[0]!.state, "cancelled");
  assert.equal(aborts, 1, "the last caller leaving stops the run");
  assert.equal((await runVerification({ top, checks: [check("typecheck")], exec })).state, "passing", "a later caller starts a fresh run");
  assert.equal(calls, 2);
});

test("typecheck evidence covers test files, and a pass goes stale once its inputs change", async () => {
  const top = fixtureRepo();
  writeFileSync(join(top, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }));
  const [typecheck] = finalChecks(top);
  assert.ok(typecheck!.inputs.includes("test"), "tsconfig includes test/**, so test files key the typecheck pass");
  mkdirSync(join(top, "test"), { recursive: true });
  writeFileSync(join(top, "test", "a.test.ts"), "export const a: number = 1;\n");
  const report = await runVerification({ top, checks: [typecheck!], exec: countingExec([0]) });
  assert.deepEqual(staleVerification(top, [typecheck!], report), [], "nothing changed since the run");
  writeFileSync(join(top, "test", "a.test.ts"), "export const a: number = 'x';\n");
  assert.deepEqual(staleVerification(top, [typecheck!], report), ["typecheck"], "an edit to a test file after the pass makes it stale");
});

test("a cancelled or unavailable check is never a pass, and a failed dependency makes the dependent unavailable", async () => {
  const top = fixtureRepo();
  const controller = new AbortController();
  const exec: VerifyExec = async () => {
    controller.abort();
    return { code: 0, output: "", timedOut: false };
  };
  const cancelled = await runVerification({ top, checks: [check("typecheck")], exec, signal: controller.signal });
  assert.equal(cancelled.state, "failing");
  assert.equal(cancelled.results[0]!.state, "cancelled");
  assert.match(cancelled.results[0]!.summary, /not a pass/);
  const unavailable = await runVerification({ top, checks: [check("typecheck")], exec: async () => ({ code: null, output: "spawn failed", timedOut: false }) });
  assert.equal(unavailable.results[0]!.state, "unavailable");
  assert.equal(unavailable.state, "failing");
  const chained = await runVerification({ top, checks: [{ ...check("web:build"), id: "web:build" }, { ...check("web:check"), id: "web:check", dependsOn: ["web:build"] }], exec: countingExec([1]) });
  assert.equal(chained.results.find((result) => result.id === "web:build")!.state, "fail");
  assert.equal(chained.results.find((result) => result.id === "web:check")!.state, "unavailable");
  assert.match(chained.results.find((result) => result.id === "web:check")!.summary, /web:build did not pass/);
});

test("final checks come from the project's own scripts, and none apply without them", async () => {
  const top = fixtureRepo();
  assert.deepEqual(finalChecks(top), [], "no scripts, no applicable checks");
  const report = await runVerification({ top, checks: finalChecks(top), exec: countingExec([0]) });
  assert.equal(report.state, "passing");
  assert.match(report.note!, /no applicable checks/);
  writeFileSync(join(top, "package.json"), JSON.stringify({ name: "fixture", scripts: { typecheck: "tsc --noEmit", "web:check": "playwright test" } }, null, 2));
  const checks = finalChecks(top);
  assert.deepEqual(checks.map((entry) => entry.id), ["typecheck", "web:check"], "present scripts in run order");
  assert.ok(checks.every((entry) => entry.inputs.includes("package-lock.json")), "dependency edits invalidate every check");
  assert.deepEqual(checks.find((entry) => entry.id === "web:check")!.dependsOn, ["web:build"], "browser fixtures depend on the build");
});

test("final build and browser passes track their source dependencies and reuse unchanged inputs", async () => {
  const cases = [
    { path: "src/lobby/prompts.ts", reused: [false, false] },
    { path: "src/webui/protocol.ts", reused: [false, false] },
    { path: "src/webui/server.ts", reused: [true, false] },
  ];
  for (const entry of cases) {
    const top = fixtureRepo();
    mkdirSync(join(top, "src/lobby"), { recursive: true });
    mkdirSync(join(top, "src/webui"), { recursive: true });
    writeFileSync(join(top, "package.json"), JSON.stringify({ scripts: { "web:build": "build", "web:check": "browser" } }));
    for (const source of cases) writeFileSync(join(top, source.path), "export const value = 1;\n");
    const checks = finalChecks(top);
    const exec = countingExec([0]);
    const first = await runVerification({ top, checks, exec });
    assert.equal(first.state, "passing");
    assert.equal(exec.calls, 2);
    const unchanged = await runVerification({ top, checks, exec, previous: first });
    assert.equal(exec.calls, 2, `${entry.path}: unchanged inputs reuse both passes`);
    assert.ok(unchanged.results.every((result) => result.reused));
    writeFileSync(join(top, entry.path), "export const value = 2;\n");
    const changed = await runVerification({ top, checks, exec, previous: unchanged });
    assert.equal(changed.state, "passing");
    assert.deepEqual(changed.results.map((result) => result.reused === true), entry.reused, entry.path);
    assert.equal(exec.calls, 2 + entry.reused.filter((reused) => !reused).length, entry.path);
    const repeated = await runVerification({ top, checks, exec, previous: changed });
    assert.equal(repeated.state, "passing");
    assert.ok(repeated.results.every((result) => result.reused), `${entry.path}: refreshed passes reuse`);
    assert.equal(exec.calls, 2 + entry.reused.filter((reused) => !reused).length);
  }
});

test("the fingerprint keys command, arguments and environment, not just files", () => {
  const top = fixtureRepo();
  const base = check("typecheck");
  const other = { ...base, args: ["-e", "1"] };
  assert.notEqual(checkFingerprint(top, base), checkFingerprint(top, other), "a changed command re-runs even with equal inputs");
});

test("a real check reruns and fails when only its effective environment changes", async () => {
  const top = fixtureRepo();
  const key = "BOT_LOBBY_VERIFY_ENV_REGRESSION";
  const original = process.env[key];
  const command = { ...check("environment"), command: process.execPath, args: ["-e", `process.exit(process.env.${key} === 'pass' ? 0 : 1)`] };
  try {
    process.env[key] = "pass";
    const first = await runVerification({ top, checks: [command] });
    assert.equal(first.state, "passing");
    process.env[key] = "fail";
    const second = await runVerification({ top, checks: [command], previous: first });
    assert.equal(second.state, "failing");
    assert.equal(second.results[0]!.reused, undefined);
    assert.match(second.results[0]!.summary, /failed with exit 1/);
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

function delayedScript(): { top: string; command: VerifyCheck } {
  const top = fixtureRepo();
  writeFileSync(join(top, "script.cjs"), "const fs = require('node:fs'); fs.writeFileSync('ready', 'ready'); setTimeout(() => fs.writeFileSync('marker', 'escaped'), 6000);");
  writeFileSync(join(top, "package.json"), JSON.stringify({ scripts: { test: "node script.cjs" } }));
  return { top, command: { ...finalChecks(top)[0]!, timeoutMs: 10_000 } };
}

async function waitForReady(top: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(join(top, "ready")) && Date.now() < deadline) await delay(20);
  assert.ok(existsSync(join(top, "ready")), "npm descendant started within deadline");
}

test("aborting real verification kills npm script descendants and skips later checks", async () => {
  const { top, command } = delayedScript();
  const controller = new AbortController();
  const later = { ...command, id: "later", args: ["exec", "--", "node", "-e", "require('node:fs').writeFileSync('later', '')"] };
  const run = runVerification({ top, checks: [command, later, { ...later, id: "dependent", dependsOn: ["test"] }], signal: controller.signal });
  try {
    await waitForReady(top);
    controller.abort();
    const report = await run;
    assert.deepEqual(report.results.map((result) => result.state), ["cancelled", "cancelled", "unavailable"]);
    await delay(6500);
    assert.equal(existsSync(join(top, "marker")), false, "cancelled descendants cannot write later");
    assert.equal(existsSync(join(top, "later")), false, "no later command launched");
  } finally {
    controller.abort(); await run;
    rmSync(top, { recursive: true, force: true });
  }
});

async function assertPreAborted(top: string, command: VerifyCheck): Promise<void> {
  const controller = new AbortController();
  controller.abort();
  const stopped = await runVerification({ top, checks: [command], signal: controller.signal });
  assert.equal(stopped.results[0]!.state, "cancelled");
  await delay(6500);
  assert.equal(existsSync(join(top, "ready")), false, "pre-abort never starts npm script");
}

test("real verification timeout kills descendants and pre-abort launches nothing", async () => {
  const { top, command } = delayedScript();
  try {
    await assertPreAborted(top, command);
    const run = runVerification({ top, checks: [{ ...command, timeoutMs: 5000 }] });
    await waitForReady(top);
    const report = await run;
    assert.equal(report.results[0]!.state, "fail");
    assert.match(report.results[0]!.summary, /timed out/);
    await delay(6500);
    assert.equal(existsSync(join(top, "marker")), false, "timed-out descendants cannot write later");
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});

function workflowDeps(cwd: string): WorkflowDeps {
  const root = mkdtempSync(join(tmpdir(), "vf-wf-"));
  return { root, configDir: ".pi", cwd, config: DEFAULT_CONFIG, ask: async () => undefined, choose: async () => undefined, notify: () => {} };
}

const FLOW: TaskState[] = ["clarifying", "scouting", "synthesizing", "awaiting_approval", "planning", "implementing", "reviewing"];

function reviewingTask(deps: WorkflowDeps): Task {
  ensureProjectStructure(deps.root, deps.configDir);
  const task = createTask("TASK-1", "Add pagination");
  createTaskDir(deps.root, deps.configDir, task);
  for (const step of FLOW) transition(task, step);
  task.domains = ["backend"];
  task.plan = "plan mentions files, sequence, dependencies, testing, acceptance, rollback, review";
  task.qaVerdict = "pass";
  saveTask(deps.root, deps.configDir, task);
  return task;
}

const act = (deps: WorkflowDeps, params: Partial<OrchestrateParams>) => runWorkflowAction({ action: "status", taskId: "TASK-1", ...params } as OrchestrateParams, deps);

test("completion requires the engine-run checks to pass, fast or slow, and reuses nothing on failure", async () => {
  const top = fixtureRepo();
  writeFileSync(join(top, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "node -e \"process.exit(1)\"" } }, null, 2));
  const deps = workflowDeps(top);
  reviewingTask(deps);
  const refused = await act(deps, { action: "complete", message: "should not pass" });
  assert.equal(refused.ok, false, refused.message);
  assert.match(refused.message, /final verification failed/);
  assert.match(refused.message, /test failed with exit 1/);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.state, "reviewing", "a refusal commits nothing and completes nothing");
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.verification!.state, "failing", "the failing report is recorded on the task");
  writeFileSync(join(top, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2));
  const done = await act(deps, { action: "complete", message: "verification passes now" });
  assert.equal(done.ok, true, done.message);
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.state, "completed");
  assert.equal(loadTask(deps.root, deps.configDir, "TASK-1")!.verification!.state, "passing");
});
