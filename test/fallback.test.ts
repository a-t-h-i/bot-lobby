import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent, type AgentRequest } from "../src/execution/agent-runner.ts";
import type { ProcessOutcome, ProcessRunner } from "../src/execution/pi-runner.ts";
import { agentProfile, resolveConfig } from "../src/schemas/configuration.ts";

const outcome = (stdout: string): ProcessOutcome => ({ exitCode: 0, stdout, stderr: "", killed: false, timedOut: false });
const failing = (errorMessage: string) => JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage } });
const request: AgentRequest = { taskId: "T", domain: "backend", role: "worker", instruction: "Do it", context: { task: "x" }, timeoutMs: 1000, cwd: process.cwd(), model: "primary/x", thinking: "high" };

test("legacy fallback keys are ignored without rejecting valid primary settings", () => {
  const entry = { model: "primary/x", thinking: "high", fallbackModel: "other/y", fallbackThinking: "low", instructions: "keep me" };
  const config = resolveConfig({ master: entry, agents: { backend: entry }, scout: { model: "scout/x", fallbackModel: "other/y" }, researcher: entry, planner: entry, quickFix: entry });
  assert.equal(config.master.model, "primary/x");
  assert.equal(config.agents.backend.instructions, "keep me");
  assert.equal(agentProfile(config, "backend", "worker").model, "primary/x");
  assert.equal(config.scout.model, "scout/x");
  assert.doesNotMatch(JSON.stringify(config), /fallbackModel|fallbackThinking/);
  assert.doesNotMatch(JSON.stringify(agentProfile(config, "backend", "worker")), /fallback/);
});

test("primary usage failure never switches models, even with runtime legacy fields", async () => {
  const seen: string[] = [];
  const runner: ProcessRunner = async (args) => {
    seen.push(args[args.indexOf("--model") + 1]!);
    return outcome(failing("usage limit reached"));
  };
  const legacy = { ...request, fallback: { model: "other/y", thinking: "low" }, retries: 1 };
  const run = await runAgent(legacy, runner);
  assert.equal(run.status, "failed");
  assert.match(run.error!, /usage limit reached/);
  assert.deepEqual(seen, ["primary/x", "primary/x"], "unrelated bounded retries remain on primary");
  seen.length = 0;
  await runAgent({ ...legacy, retries: 0 }, runner);
  assert.deepEqual(seen, ["primary/x"], "no cached unavailable-model switching on later runs");
});
