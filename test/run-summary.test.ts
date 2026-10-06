import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentRun } from "../src/schemas/findings.ts";
import { activityDetail } from "../src/pi/activity.ts";
import { describeRun, runFromLog, runLogEntry, tokens } from "../src/pi/run-summary.ts";
import { runsReport } from "../src/pi/commands.ts";
import { createTask } from "../src/schemas/task.ts";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: "r1",
    taskId: "TASK-1",
    domain: "backend",
    role: "worker",
    status: "success",
    output: "",
    attempts: 1,
    startedAt: new Date(T0).toISOString(),
    finishedAt: new Date(T0 + 192_000).toISOString(),
    ...overrides,
  };
}

test("activityDetail names the file, command, pattern or query a tool touches", () => {
  assert.equal(activityDetail("read", { path: "src/pi/zen.ts" }), "zen.ts");
  assert.equal(activityDetail("edit", { file_path: "C:\\app\\main.ts" }), "main.ts");
  assert.equal(activityDetail("bash", { command: "npm test -- --run src/very/long/path/to/file.test.ts" }), "npm test -- --run src/very/…");
  assert.equal(activityDetail("grep", { pattern: "TODO" }), '"TODO"');
  assert.equal(activityDetail("web_search", { query: "pi rpc mode" }), "pi rpc mode");
  assert.equal(activityDetail("read", undefined), undefined);
  assert.equal(activityDetail("bash", { command: "   " }), undefined);
});

test("describeRun reads like a receipt: agent, role, time, turns, tools, tokens, cost, model", () => {
  const line = describeRun(run({ turns: 9, tools: 23, model: "p/fast", usage: { input: 41_200, output: 6_100, cost: 0.123, turns: 9 } }));
  assert.equal(line, "✓ DEV worker · 3m 12s · 9 turns · 23 tools · 41k↑ 6k↓ · $0.12 · p/fast");
});

test("describeRun flags stalls, time limits, early wrap-ups and retries", () => {
  assert.match(describeRun(run({ status: "timeout", stalled: true, error: "stalled: no output for 3m while running npm test", attempts: 2 })), /✗ DEV worker · 3m 12s · stalled · 2 attempts — stalled: no output for 3m while running npm test/);
  assert.match(describeRun(run({ status: "timeout", error: "hit the 15m time limit" })), /hit its time limit — hit the 15m time limit/);
  assert.match(describeRun(run({ wrappedUp: true })), /wrapped up early — report may be partial/);
  assert.match(describeRun(run({ domain: "designer", role: "researcher" })), /RESEARCH researcher/);
});

test("tokens are compact", () => {
  assert.deepEqual([tokens(950), tokens(41_200), tokens(1_250_000), tokens(Number.NaN)], ["950", "41k", "1.3M", "0"]);
});

test("the run log round-trips through its persisted form", () => {
  const original = run({ turns: 4, tools: 7, model: "p/m", usage: { input: 10, output: 5, cost: 0.01, turns: 4 }, wrappedUp: true, output: "big report" });
  const entry = runLogEntry(original);
  assert.equal(entry.output, 5, "output is the token count, never the report text");
  assert.equal(describeRun(runFromLog(entry, "TASK-1")), describeRun(original));
});

test("runsReport lists the task's recent runs", () => {
  const task = createTask("TASK-1", "t", "request");
  assert.match(runsReport(task), /no finished subagent runs yet/);
  task.runLog = [runLogEntry(run({ turns: 3 }))];
  assert.match(runsReport(task), /TASK-1 — last 1 run:\n✓ DEV worker · 3m 12s · 3 turns/);
  assert.equal(runsReport(undefined), "No bot-lobby task found.");
});
