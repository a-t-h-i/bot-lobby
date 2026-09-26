import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent, runParallel, runSequential, cancelAllRuns, type AgentRequest } from "../src/execution/agent-runner.ts";
import type { ProcessOutcome, ProcessRunner } from "../src/execution/pi-runner.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

function reply(text: string): string {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 1, output: 1 } },
  });
}

function ok(stdout: string): ProcessOutcome {
  return { exitCode: 0, stdout, stderr: "", killed: false, timedOut: false };
}

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    taskId: "TASK-1",
    domain: "backend",
    role: "scout",
    instruction: "Inspect the API layer",
    context: { task: "Add pagination" },
    timeoutMs: 1000,
    cwd: "/proj",
    ...overrides,
  };
}

test("runAgent returns metadata and role-restricted tools", async () => {
  let tools: string | undefined;
  const capture: ProcessRunner = async (args) => {
    tools = args[args.indexOf("--tools") + 1];
    return ok(reply("scout findings"));
  };
  const run = await runAgent(request(), capture);
  assert.equal(run.status, "success");
  assert.equal(run.output, "scout findings");
  assert.equal(run.taskId, "TASK-1");
  assert.equal(run.domain, "backend");
  assert.equal(run.role, "scout");
  assert.equal(tools, "read,grep,find,ls");
  assert.ok(run.finishedAt);
});

test("workers get the full built-in tool set plus any extra tools", async () => {
  const capture: ProcessRunner = async (args) => ok(reply(args[args.indexOf("--tools") + 1]!));
  const run = await runAgent(request({ role: "worker" }), capture);
  assert.equal(run.output, "read,bash,edit,write,grep,find,ls");
  const desk = await runAgent(request({ role: "worker", extraTools: ["claim_file"] }), capture);
  assert.equal(desk.output, "read,bash,edit,write,grep,find,ls,claim_file");
});

test("runAgent reports a failed run without throwing", async () => {
  const failing: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom", killed: false, timedOut: false });
  const run = await runAgent(request(), failing);
  assert.equal(run.status, "failed");
  assert.match(run.error!, /boom/);
});

test("runAgent emits running then final updates", async () => {
  const seen: string[] = [];
  await runAgent(request({ onUpdate: (run) => seen.push(run.status) }), async () => ok(reply("x")));
  assert.deepEqual(seen, ["running", "success"]);
});

test("runAgent aborts when cancelled via the registry", async () => {
  const hanging: ProcessRunner = async (_args, options) =>
    new Promise((resolve) => {
      options.signal?.addEventListener("abort", () => resolve({ exitCode: 0, stdout: "", stderr: "", killed: true, timedOut: false }));
    });
  const pending = runAgent(request({ timeoutMs: 60_000 }), hanging);
  cancelAllRuns();
  const run = await pending;
  assert.equal(run.status, "cancelled");
});

test("runParallel runs all requests and preserves order", async () => {
  let active = 0;
  let maxActive = 0;
  const slow: ProcessRunner = async (_args, options) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return ok(reply(String(options.prompt)));
  };
  const results = await runParallel(
    [request({ instruction: "a" }), request({ instruction: "b" }), request({ instruction: "c" })],
    2,
    slow,
  );
  assert.equal(results.length, 3);
  assert.equal(results[0]!.output, "Task: a");
  assert.equal(results[2]!.output, "Task: c");
  assert.ok(maxActive <= 2, `concurrency cap respected, saw ${maxActive}`);
});

test("runSequential substitutes {previous} and stops on failure", async () => {
  const instructions: string[] = [];
  const chain: ProcessRunner = async (_args, options) => {
    const task = String(options.prompt);
    instructions.push(task);
    if (task.includes("second")) return { exitCode: 1, stdout: "", stderr: "nope", killed: false, timedOut: false };
    return ok(reply("first output"));
  };
  const results = await runSequential(
    [request({ instruction: "first" }), request({ instruction: "second: {previous}" }), request({ instruction: "third" })],
    chain,
  );
  assert.equal(results.length, 2);
  assert.equal(results[0]!.status, "success");
  assert.equal(results[1]!.status, "failed");
  assert.equal(instructions.length, 2);
  assert.ok(instructions[1]!.includes("first output"), "prior output substituted");
});

test("runAgent streams deduped activity on the same runId", async () => {
  const seen: AgentRun[] = [];
  const streaming: ProcessRunner = async (_args, options) => {
    options.onEvent?.({ type: "tool_execution_start", toolName: "read" });
    options.onEvent?.({ type: "tool_execution_start", toolName: "read" });
    options.onEvent?.({ type: "tool_execution_start", toolName: "bash" });
    return ok(reply("done"));
  };
  const run = await runAgent(request({ onUpdate: (update) => seen.push(update) }), streaming);
  assert.equal(run.status, "success");
  assert.deepEqual(seen.filter((update) => update.activity).map((update) => update.activity), ["reading", "running"]);
  assert.ok(seen.every((update) => update.runId === run.runId));
});
