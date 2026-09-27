import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Classifier } from "../src/classifier/classifier.ts";
import type { FetchLike } from "../src/classifier/client.ts";
import { effortRouter, fellShort, planRoute, routeLabel, stepDown, type EffortRouter } from "../src/classifier/effort.ts";
import { DEFAULT_CONFIG, type ClassifierConfig } from "../src/schemas/configuration.ts";
import { runScouts, runWorker } from "../src/master/master.ts";
import { QuickFixQueue } from "../src/lobby/quickfix.ts";
import { PlanningSession } from "../src/lobby/planner.ts";
import { readMetrics, metricFromRun } from "../src/state/metrics.ts";
import { describeRun } from "../src/pi/run-summary.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";

const CONFIG = { thresholds: DEFAULT_CONFIG.classifier.thresholds, effort: { cheapModel: "p/cheap" } };

test("routes only go down: simple drops one thinking level (never below low), trivial moves to the cheaper model", () => {
  assert.deepEqual(["max", "high", "medium", "low", "minimal", "off", "bogus"].map(stepDown), ["xhigh", "medium", "low", "low", "minimal", "off", "bogus"]);
  const profile = { model: "p/big", thinking: "high" };
  assert.deepEqual(planRoute("simple", 0.75, profile, CONFIG), { model: "p/big", thinking: "medium", level: "simple", confidence: 0.75, from: profile });
  assert.equal(planRoute("simple", 0.6, profile, CONFIG), undefined, "not confident enough");
  assert.equal(planRoute("moderate", 0.99, profile, CONFIG), undefined);
  assert.equal(planRoute("complex", 0.99, profile, CONFIG), undefined);
  assert.deepEqual(planRoute("trivial", 0.85, profile, CONFIG), { model: "p/cheap", thinking: "low", level: "trivial", confidence: 0.85, from: profile });
  assert.deepEqual(planRoute("trivial", 0.85, { thinking: "minimal" }, CONFIG)?.thinking, "minimal", "never raised to low");
  assert.equal(planRoute("trivial", 0.85, profile, CONFIG, { clamp: (model, thinking) => (model === "p/cheap" ? "off" : thinking) })?.thinking, "off", "clamped to what the cheap model supports");
  assert.deepEqual(planRoute("trivial", 0.75, profile, CONFIG), { model: "p/big", thinking: "medium", level: "trivial", confidence: 0.75, from: profile }, "trivial below trivialAt still counts as simple");
  assert.deepEqual(planRoute("trivial", 0.85, profile, { ...CONFIG, effort: { cheapModel: "inherit" } })?.model, "p/big", "no cheap model: thinking drops instead");
  assert.equal(planRoute("simple", 0.9, { model: "p/big", thinking: "low" }, CONFIG), undefined, "nothing lower to go to");
  assert.equal(planRoute("simple", 0.9, profile, CONFIG, { thinkingFixed: true }), undefined, "scouts keep their thinking");
  assert.deepEqual(planRoute("trivial", 0.9, { model: "p/big", thinking: "low" }, CONFIG, { thinkingFixed: true }), { model: "p/cheap", thinking: "low", level: "trivial", confidence: 0.9, from: { model: "p/big", thinking: "low" } });
  assert.equal(planRoute("trivial", 0.9, { model: "p/cheap", thinking: "low" }, CONFIG, { thinkingFixed: true }), undefined, "already on the cheap model");
  assert.equal(routeLabel(planRoute("trivial", 0.85, profile, CONFIG)!), "trivial 0.85: p/big · high → p/cheap · low");
  assert.equal(fellShort({ status: "success" }), false);
  assert.equal(fellShort({ status: "success", wrappedUp: true }), true);
  assert.equal(fellShort({ status: "success" }, ["missing Completed section"]), true);
  assert.equal(fellShort({ status: "timeout" }), true);
  assert.equal(fellShort({ status: "cancelled" }), false, "a cancel is not a reason to run again");
});

/** A fake Jev scoring every step at `level` (0 trivial … 3 complex). */
function scoring(level: number, confidence: number, calls: string[] = []): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { state: { step: string } };
    calls.push(body.state.step);
    return new Response(JSON.stringify({ model: "jev-test", answers: { effort: { type: "score", score: level, confidence } } }), { status: 200 });
  };
}

function router(level: number, confidence: number, overrides: Partial<ClassifierConfig> = {}, calls: string[] = [], logged: string[] = []): EffortRouter {
  const jev = new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true, effort: { cheapModel: "p/cheap" }, ...overrides }), keys: async () => "ts_key", fetch: scoring(level, confidence, calls), sleep: async () => {} });
  return effortRouter(jev, { log: (text) => logged.push(text) });
}

test("the router scores once and plans each profile; it is silent when effort routing is off", async () => {
  const calls: string[] = [];
  const logged: string[] = [];
  const effort = router(0, 0.9, {}, calls, logged);
  const scored = await effort.score("rename getUser to fetchUser");
  assert.deepEqual(scored, { level: "trivial", confidence: 0.9 });
  assert.equal(effort.plan(scored!, { model: "p/a", thinking: "medium" })?.model, "p/cheap");
  assert.equal(effort.plan(scored!, { model: "p/b", thinking: "high" })?.model, "p/cheap");
  assert.equal(calls.length, 1);
  assert.deepEqual(logged, ["routed trivial 0.90: p/a · medium → p/cheap · low", "routed trivial 0.90: p/b · high → p/cheap · low"]);
  assert.equal(await router(0, 0.9, { features: { ...DEFAULT_CONFIG.classifier.features, effort: false } }).route("x", { thinking: "high" }), undefined);
  assert.equal(await router(2, 0.95).route("x", { thinking: "high" }), undefined, "moderate work keeps its profile");
});

function reply(text: string): string {
  return JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: "p/served", stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } });
}

const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

/** A fake pi: answers per model from `answers` (undefined = crash), recording model and thinking. */
function byModel(answers: Record<string, string | undefined>, seen: Array<{ model: string; thinking: string }>): ProcessRunner {
  return async (args) => {
    const model = arg(args, "--model") ?? "session";
    seen.push({ model, thinking: arg(args, "--thinking") ?? "" });
    const text = answers[model];
    if (text === undefined) return { exitCode: 1, stdout: "", stderr: `${model} crashed`, killed: false, timedOut: false };
    return { exitCode: 0, stdout: reply(text), stderr: "", killed: false, timedOut: false };
  };
}

const WORKER_OK = "## Completed\n- renamed\n## Files Changed\n- `src/a.ts` — rename\n## Verification\n- npm test — pass";
const config = { ...DEFAULT_CONFIG, agents: { ...DEFAULT_CONFIG.agents, backend: { ...DEFAULT_CONFIG.agents.backend, model: "p/big", thinking: "high" } }, scout: { ...DEFAULT_CONFIG.scout, model: "p/scout" } };

test("a routed worker runs on the cheaper profile, and runs again on the configured one when it falls short", async () => {
  const data = mkdtempSync(join(tmpdir(), "bl-effort-"));
  const request = { taskId: "T", domain: "backend" as const, instruction: "Step 1: rename getUser", taskText: "rename", scoutOutcomes: [], cwd: data, dataRoots: [data], config };
  const seen: Array<{ model: string; thinking: string }> = [];
  const ok = await runWorker({ ...request, effort: router(0, 0.9) }, byModel({ "p/cheap": WORKER_OK }, seen));
  assert.deepEqual(seen, [{ model: "p/cheap", thinking: "low" }]);
  assert.equal(ok.run.routedFrom, "p/big · high");
  assert.equal(ok.run.route, "trivial 0.90: p/big · high → p/cheap · low");
  assert.match(describeRun(ok.run), /routed trivial 0\.90: p\/big · high → p\/cheap · low/);
  assert.equal(metricFromRun(ok.run).routedFrom, "p/big · high");

  seen.length = 0;
  const crashed = await runWorker({ ...request, effort: router(0, 0.9) }, byModel({ "p/big": WORKER_OK }, seen));
  assert.deepEqual(seen, [{ model: "p/cheap", thinking: "low" }, { model: "p/big", thinking: "high" }], "no in-place retry on the cheap model: the fallback is the retry");
  assert.equal(crashed.run.status, "success");
  assert.equal(crashed.run.routedFrom, undefined);

  seen.length = 0;
  await runWorker({ ...request, effort: router(1, 0.8) }, byModel({ "p/big": "## Notes\nI could not do it" }, seen));
  assert.deepEqual(seen, [{ model: "p/big", thinking: "medium" }, { model: "p/big", thinking: "high" }], "an unusable report on the lower thinking runs again at the configured one");

  seen.length = 0;
  await runWorker({ ...request, effort: router(3, 0.9) }, byModel({ "p/big": WORKER_OK }, seen));
  assert.deepEqual(seen, [{ model: "p/big", thinking: "high" }], "complex work is never routed");
});

test("a routed scout moves to the cheaper model only, and an unusable one runs again on its own", async () => {
  const data = mkdtempSync(join(tmpdir(), "bl-effort-scout-"));
  const seen: Array<{ model: string; thinking: string }> = [];
  const usable = "## Scope\nx\n## Findings\n- found it in src/a.ts\n## Relevant Files\n- `src/a.ts` — here\n## Confidence\nHigh";
  const outcomes = await runScouts({ taskId: "T", taskText: "rename", instruction: "Where is getUser?", domains: ["backend"], cwd: data, dataRoots: [data], taskDir: mkdtempSync(join(tmpdir(), "bl-effort-td-")), config, effort: router(0, 0.95) }, byModel({ "p/cheap": "", "p/scout": usable }, seen));
  assert.deepEqual(seen, [{ model: "p/cheap", thinking: "low" }, { model: "p/scout", thinking: "low" }]);
  assert.equal(outcomes[0]!.usable, true);
});

async function drain(queue: QuickFixQueue): Promise<void> {
  for (let i = 0; i < 50 && queue.jobs.some((job) => job.status === "queued" || job.status === "running"); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("a routed quick fix records its routed attempt and re-runs on the configured profile when it falls short", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-effort-qf-"));
  const seen: Array<{ model: string; thinking: string }> = [];
  const queue = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ model: "p/big", thinking: "medium", timeoutMs: 60_000 }), runProcess: byModel({ "p/big": "## Done\nx" }, seen), effort: router(0, 0.9) });
  const job = queue.submit("fix the typo");
  await drain(queue);
  assert.deepEqual(seen, [{ model: "p/cheap", thinking: "low" }, { model: "p/big", thinking: "medium" }]);
  assert.equal(job.status, "success");
  assert.equal(job.route, undefined, "it finished on the configured profile");
  const metrics = readMetrics(root, ".pi").filter((record) => record.kind === "quickfix");
  assert.deepEqual(metrics.map((record) => [record.status, record.routedFrom]), [["failed", "p/big · medium"], ["success", undefined]]);

  const fine = new QuickFixQueue({ cwd: root, root, configDir: ".pi", profile: () => ({ model: "p/big", thinking: "medium", timeoutMs: 60_000 }), runProcess: byModel({ "p/cheap": "## Done\nx" }, []), effort: router(0, 0.9) });
  const cheap = fine.submit("fix another typo");
  await drain(fine);
  assert.equal(cheap.route, "trivial 0.90: p/big · medium → p/cheap · low");
  assert.equal(cheap.model, "p/served");
});

test("planning seats share one effort score per round; a routed seat that fails asks again, and the oracle is never routed", async () => {
  const root = mkdtempSync(join(tmpdir(), "bl-effort-plan-"));
  const seen: Array<{ who: string; model: string; thinking: string }> = [];
  const calls: string[] = [];
  const runner: ProcessRunner = async (args, options) => {
    const who = /You are (DEV|QA) on the planning panel/.exec(options.prompt ?? "")?.[1] ?? "ORACLE";
    const model = arg(args, "--model") ?? "";
    seen.push({ who, model, thinking: arg(args, "--thinking") ?? "" });
    if (who === "QA" && arg(args, "--thinking") === "low") return { exitCode: 1, stdout: "", stderr: "crash on the routed profile", killed: false, timedOut: false };
    return { exitCode: 0, stdout: reply(who === "ORACLE" ? "## Status\nREADY\n## Plan\n1. x" : "## Status\nREADY"), stderr: "", killed: false, timedOut: false };
  };
  const session = new PlanningSession({
    cwd: root, root, configDir: ".pi", panel: ["backend", "qa"],
    profile: () => ({ model: "p/oracle", thinking: "high", timeoutMs: 60_000 }),
    memberProfile: (member) => ({ model: member === "qa" ? "p/qa" : "p/dev", thinking: "medium", timeoutMs: 60_000 }),
    runProcess: runner,
    effort: router(1, 0.8, {}, calls),
  });
  await session.send("rename a label");
  assert.equal(calls.length, 1, "one score for the round");
  assert.deepEqual(seen.filter((call) => call.who !== "ORACLE").map((call) => `${call.who} ${call.model} ${call.thinking}`).sort(), ["DEV p/dev low", "QA p/qa low", "QA p/qa medium"]);
  assert.deepEqual(seen.filter((call) => call.who === "ORACLE").map((call) => `${call.model} ${call.thinking}`), ["p/oracle high"]);
  assert.equal(session.reply?.status, "ready");
  const panel = readMetrics(root, ".pi").filter((record) => record.kind === "panel");
  assert.deepEqual(panel.map((record) => record.routedFrom).sort(), ["p/dev · medium", "p/qa · medium", undefined]);
});
