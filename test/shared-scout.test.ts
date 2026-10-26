import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runScouts, type ScoutRequest } from "../src/master/master.ts";
import { acquireScoutLock } from "../src/master/scout-lock.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

const evidence = (domain: string) => `## Scope\n${domain} code\n## Findings\n- ${domain} contract and caller verified\n## Relevant Files\n- \`src/${domain}.ts:1\` — implementation and callers\n## Risks\n- Test coverage uncertain\n## Confidence\nHigh`;
const shared = `# Domain: backend\n${evidence("backend")}\n# Domain: qa\n${evidence("qa")}`;
function reply(text = shared) {
  return { exitCode: 0, stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 7, output: 3, cost: { total: 0.25 } } } }), stderr: "", killed: false };
}
function request(root: string): ScoutRequest {
  return { taskId: "T", taskText: "Change contract", instruction: "Find contracts, callers and tests", domains: ["backend", "qa"], cwd: root, dataRoots: [join(root, ".pi")], taskDir: join(root, ".pi", "tasks", "T"), config: resolveConfig({ workflow: { reuseScouts: false, maxAgentRetries: 0 } }) };
}

test("shared preparation looks up files once and emits a single accounted execution", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "bl-shared-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const updates: AgentRun[] = [];
  let lookups = 0;
  let processes = 0;
  const outcomes = await runScouts({ ...request(root), onUpdate: (run) => updates.push(run), hints: {
    block: async (query: string) => { lookups++; assert.match(query, /backend:/); assert.match(query, /qa:/); return ""; },
    tools: () => [],
  } as ScoutRequest["hints"] }, async () => { processes++; return reply(); });
  assert.equal(lookups, 1);
  assert.equal(processes, 1);
  assert.equal(new Set(updates.map((run) => run.runId)).size, 1);
  const finished = updates.filter((run) => run.status === "success");
  assert.equal(finished.length, 1);
  assert.equal(finished[0]!.usage!.input, 7);
  assert.equal(finished[0]!.usage!.cost, 0.25);
  assert.strictEqual(outcomes[0]!.run, outcomes[1]!.run);
  assert.deepEqual(outcomes.map((outcome) => outcome.result.domain), ["backend", "qa"]);
  assert.deepEqual(outcomes.map((outcome) => outcome.result.relevantFiles[0]!.path), ["src/backend.ts", "src/qa.ts"]);
  assert.equal(existsSync(join(request(root).taskDir, "scout.lock")), false);
});

test("initial scout and targeted followup cannot overlap, but followup succeeds after release", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "bl-shared-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const runner: ProcessRunner = async () => { started(); await pending; return reply(); };
  const first = runScouts(request(root), runner);
  await running;
  try {
    await assert.rejects(runScouts({ ...request(root), instruction: "Verify one caller" }, runner), /Scout preparation is locked.*Wait for the active scout/);
  } finally { finish(); }
  await first;
  const next = await runScouts({ ...request(root), instruction: "Verify one caller" }, async () => reply());
  assert.equal(next.length, 2);
});

test("failure and aborted preparation release the task lock; interrupted locks fail actionably", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "bl-shared-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const failed = await runScouts(request(root), async () => { throw new Error("interrupted"); });
  assert.ok(failed.every((outcome) => !outcome.usable));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runScouts({ ...request(root), signal: controller.signal }, async () => reply()), /abort/i);
  const release = acquireScoutLock(request(root).taskDir);
  assert.throws(() => acquireScoutLock(request(root).taskDir), /confirm its process has stopped/);
  release();
  const next = await runScouts(request(root), async () => reply());
  assert.ok(next.every((outcome) => outcome.usable));
});

test("shared output never attributes another domain's evidence to a missing section", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "bl-shared-sections-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outcomes = await runScouts(request(root), async () => reply(`# Domain: backend\n${evidence("backend")}`));
  assert.equal(outcomes[0]!.usable, true);
  assert.equal(outcomes[1]!.usable, false);
  assert.match(outcomes[1]!.issues.join("; "), /missing shared scout section for qa/);
  assert.equal(outcomes[1]!.result.relevantFiles.length, 0);
});

test("a complete shared cached preparation skips execution; a partial cache reruns one shared scout", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "bl-shared-cache-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: 10_000 });
  writeFileSync(join(root, "source.ts"), "export {};\n");
  const input = { ...request(root), config: DEFAULT_CONFIG };
  let processes = 0;
  const runner: ProcessRunner = async () => { processes++; return reply(); };
  await runScouts(input, runner);
  const cached = await runScouts(input, runner);
  assert.equal(processes, 1);
  assert.ok(cached.every((outcome) => outcome.reused));
  const cache = join(root, ".pi", "cache", "scouts");
  const files = readdirSync(cache);
  assert.equal(files.length, 2);
  const path = join(cache, files[0]!);
  const mixed = JSON.parse(readFileSync(path, "utf8"));
  mixed.outcome.run.runId = "another-execution";
  writeFileSync(path, JSON.stringify(mixed));
  await runScouts(input, runner);
  assert.equal(processes, 2, "different execution identities are not combined");
  rmSync(path);
  const fresh = await runScouts(input, runner);
  assert.equal(processes, 3);
  assert.ok(fresh.every((outcome) => !outcome.reused));
  assert.strictEqual(fresh[0]!.run, fresh[1]!.run);
});
