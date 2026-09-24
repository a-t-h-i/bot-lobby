import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPiArgs,
  isPiLauncher,
  parsePiStream,
  runPiAgent,
  type ProcessOutcome,
  type ProcessRunner,
} from "../src/execution/pi-runner.ts";

function assistantEvent(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      model: "test-model",
      stopReason: "stop",
      usage: { input: 10, output: 5, cost: { total: 0.01 } },
      ...extra,
    },
  });
}

function outcome(stdout: string, overrides: Partial<ProcessOutcome> = {}): ProcessOutcome {
  return { exitCode: 0, stdout, stderr: "", killed: false, timedOut: false, ...overrides };
}

const fake = (result: ProcessOutcome): ProcessRunner => async () => result;

test("only real pi launchers are treated as pi", () => {
  assert.ok(isPiLauncher("/usr/local/sbin/pi"));
  assert.ok(isPiLauncher("/x/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"));
  assert.ok(!isPiLauncher("/tmp/spawn-probe.ts"));
  assert.ok(!isPiLauncher("/root/proj/test/e2e.test.ts"));
});

test("buildPiArgs contains isolation flags, role tools, and the task", () => {
  const args = buildPiArgs({
    cwd: "/proj",
    task: "Do the thing",
    tools: ["read", "grep"],
    model: "provider/model",
    thinking: "high",
    timeoutMs: 1000,
    systemPromptFile: "/tmp/system.md",
  });
  assert.deepEqual(args.slice(0, 4), ["--mode", "json", "-p", "--no-session"]);
  assert.ok(args.includes("--tools"));
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep");
  assert.equal(args[args.indexOf("--model") + 1], "provider/model");
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "/tmp/system.md");
  assert.equal(args.at(-1), "Task: Do the thing");
});

test("buildPiArgs omits --model when inheriting", () => {
  const args = buildPiArgs({ cwd: "/p", task: "t", model: "inherit", timeoutMs: 1 });
  assert.ok(!args.includes("--model"));
});

test("parsePiStream collects the final assistant text, usage, and model", () => {
  const stdout = [JSON.stringify({ type: "agent_start" }), assistantEvent("first"), assistantEvent("final")].join("\n");
  const parsed = parsePiStream(stdout);
  assert.equal(parsed.text, "final");
  assert.equal(parsed.model, "test-model");
  assert.equal(parsed.usage.turns, 2);
  assert.equal(parsed.usage.input, 20);
  assert.equal(parsed.usage.output, 10);
  assert.equal(parsed.usage.cost, 0.02);
});

test("parsePiStream survives malformed lines and non-assistant messages", () => {
  const stdout = ["not json", "{", JSON.stringify({ type: "message_end", message: { role: "user" } }), assistantEvent("ok")].join("\n");
  assert.equal(parsePiStream(stdout).text, "ok");
  assert.equal(parsePiStream("").text, "");
});

test("runPiAgent returns success with parsed output", async () => {
  const result = await runPiAgent({ cwd: "/p", task: "t", timeoutMs: 1000 }, fake(outcome(assistantEvent("done"))));
  assert.equal(result.status, "success");
  assert.equal(result.output, "done");
  assert.equal(result.usage.turns, 1);
});

test("runPiAgent fails on non-zero exit and surfaces stderr", async () => {
  const result = await runPiAgent(
    { cwd: "/p", task: "t", timeoutMs: 1000 },
    fake(outcome("", { exitCode: 1, stderr: "Error: model not found" })),
  );
  assert.equal(result.status, "failed");
  assert.match(result.error!, /model not found/);
});

test("runPiAgent fails when the agent produced no usable output", async () => {
  const result = await runPiAgent({ cwd: "/p", task: "t", timeoutMs: 1000 }, fake(outcome("")));
  assert.equal(result.status, "failed");
  assert.match(result.error!, /no usable output/);
});

test("runPiAgent fails on a reported agent error", async () => {
  const stdout = assistantEvent("partial", { stopReason: "error", errorMessage: "tool exploded" });
  const result = await runPiAgent({ cwd: "/p", task: "t", timeoutMs: 1000 }, fake(outcome(stdout)));
  assert.equal(result.status, "failed");
  assert.equal(result.error, "tool exploded");
});

test("runPiAgent reports timeouts", async () => {
  const result = await runPiAgent({ cwd: "/p", task: "t", timeoutMs: 1000 }, fake(outcome("", { killed: true, timedOut: true })));
  assert.equal(result.status, "timeout");
});

test("runPiAgent reports cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runPiAgent(
    { cwd: "/p", task: "t", timeoutMs: 1000, signal: controller.signal },
    fake(outcome("", { killed: true })),
  );
  assert.equal(result.status, "cancelled");
});

test("runPiAgent writes and cleans up the system prompt file", async () => {
  let passedArgs: string[] = [];
  const capture: ProcessRunner = async (args) => {
    passedArgs = args;
    const file = args[args.indexOf("--append-system-prompt") + 1]!;
    const { readFileSync, existsSync } = await import("node:fs");
    assert.ok(existsSync(file), "prompt file should exist during the run");
    assert.match(readFileSync(file, "utf8"), /Global Engineering Agent/);
    return outcome(assistantEvent("ok"));
  };
  await runPiAgent({ cwd: "/p", task: "t", timeoutMs: 1000, systemPrompt: "Global Engineering Agent" }, capture);
  const file = passedArgs[passedArgs.indexOf("--append-system-prompt") + 1]!;
  const { existsSync } = await import("node:fs");
  assert.ok(!existsSync(file), "prompt file should be removed after the run");
});
