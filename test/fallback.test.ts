import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runAgent, type AgentRequest } from "../src/execution/agent-runner.ts";
import { isUnavailable, looksUnavailable, markUnavailable, resetUnavailable, withFallback } from "../src/execution/fallback.ts";
import type { ProcessOutcome, ProcessRunner } from "../src/execution/pi-runner.ts";
import { agentProfile, DEFAULT_CONFIG, fallbackOf, resolveConfig } from "../src/schemas/configuration.ts";
import { patchEntry } from "../src/pi/settings-ui.ts";
import { registerMasterFallback, usageFailure } from "../src/pi/master-fallback.ts";

beforeEach(() => resetUnavailable());

const outcome = (stdout: string, overrides: Partial<ProcessOutcome> = {}): ProcessOutcome => ({ exitCode: 0, stdout, stderr: "", killed: false, timedOut: false, ...overrides });
const ok = (text: string) => JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
const failing = (errorMessage: string) => JSON.stringify({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage } });
const modelOf = (args: string[]) => args[args.indexOf("--model") + 1];
const request = (overrides: Partial<AgentRequest> = {}): AgentRequest => ({ taskId: "T", domain: "backend", role: "worker", instruction: "Do it", context: { task: "x" }, timeoutMs: 1000, cwd: process.cwd(), ...overrides });

test("errors that mean a model is out of usage are told from ordinary failures", () => {
  for (const text of ["You've hit your usage limit. It resets at 5pm", "429 Too Many Requests", "Your credit balance is too low", "rate_limit_error: quota exceeded", "529 overloaded_error", "401 Unauthorized: invalid api key"]) {
    assert.equal(looksUnavailable(text), true, text);
  }
  for (const text of ["agent produced no usable output", "pi exited with code 1", "TypeError: x is not a function", undefined]) assert.equal(looksUnavailable(text), false, String(text));
});

test("a run that fails on usage runs again on its fallback model and thinking, and the exhausted model is skipped after", async () => {
  const seen: Array<[string | undefined, string | undefined]> = [];
  const runner: ProcessRunner = async (args) => {
    seen.push([modelOf(args), args[args.indexOf("--thinking") + 1]]);
    return modelOf(args) === "claude/fable" ? outcome(failing("You've hit your usage limit")) : outcome(ok("done on the fallback"));
  };
  const base = request({ model: "claude/fable", thinking: "high", fallback: { model: "deepseek/v3", thinking: "low" }, retries: 0 });
  const first = await runAgent(base, runner);
  assert.equal(first.status, "success");
  assert.equal(first.fellBackFrom, "claude/fable");
  assert.deepEqual(seen, [["claude/fable", "high"], ["deepseek/v3", "low"]], "one failed run, then the fallback at its own thinking level");
  assert.equal(isUnavailable("claude/fable"), true);
  seen.length = 0;
  const second = await runAgent(base, runner);
  assert.equal(second.status, "success");
  assert.deepEqual(seen, [["deepseek/v3", "low"]], "the next agent goes straight to the fallback");
});

test("an ordinary failure does not switch model, and a failing fallback is not retried on another", async () => {
  const seen: string[] = [];
  const crash: ProcessRunner = async (args) => {
    seen.push(modelOf(args)!);
    return outcome("", { exitCode: 1, stderr: "segfault" });
  };
  const run = await runAgent(request({ model: "a/x", fallback: { model: "b/y", thinking: "low" }, retries: 1 }), crash);
  assert.equal(run.status, "failed");
  assert.deepEqual(seen, ["a/x", "a/x"], "retries stay on the model");
  seen.length = 0;
  const limited: ProcessRunner = async (args) => {
    seen.push(modelOf(args)!);
    return outcome(failing("usage limit reached"));
  };
  const both = await runAgent(request({ model: "a/x", fallback: { model: "b/y", thinking: "low" }, retries: 0 }), limited);
  assert.equal(both.status, "failed");
  assert.deepEqual(seen, ["a/x", "b/y"], "one switch only");
});

test("without a fallback a usage failure just fails, as before", async () => {
  const runner: ProcessRunner = async () => outcome(failing("usage limit reached"));
  const run = await runAgent(request({ model: "a/x", retries: 0 }), runner);
  assert.equal(run.status, "failed");
  assert.equal(run.fellBackFrom, undefined);
});

test("withFallback serves lobby agents the same way", async () => {
  const seen: string[] = [];
  const attempt = async (model: string | undefined, _thinking: string) => {
    seen.push(String(model));
    return model === "a/x" ? { status: "failed", error: "quota exceeded" } : { status: "success" };
  };
  const first = await withFallback("a/x", "high", { model: "b/y", thinking: "low" }, attempt);
  assert.equal(first.result.status, "success");
  assert.equal(first.switchedFrom, "a/x");
  assert.deepEqual(seen, ["a/x", "b/y"]);
  markUnavailable("a/x");
  seen.length = 0;
  await withFallback("a/x", "high", { model: "b/y", thinking: "low" }, attempt);
  assert.deepEqual(seen, ["b/y"]);
  assert.equal((await withFallback("a/x", "high", undefined, async () => ({ status: "failed", error: "quota" }))).switchedFrom, undefined);
});

test("settings name a fallback model and its thinking per agent; unset means none and thinking follows the agent", () => {
  assert.equal(agentProfile(DEFAULT_CONFIG, "backend", "worker").fallback, undefined);
  const config = resolveConfig({
    agents: { backend: { model: "a/x", thinking: "high", fallbackModel: "b/y" }, designer: { fallbackModel: "c/z", fallbackThinking: "low" } },
    scout: { fallbackModel: "s/mini" }, researcher: { fallbackModel: "inherit", fallbackThinking: "low" },
  });
  assert.deepEqual(agentProfile(config, "backend", "worker").fallback, { model: "b/y", thinking: "high" }, "the agent's own thinking when none is set");
  assert.deepEqual(agentProfile(config, "designer", "worker").fallback, { model: "c/z", thinking: "low" });
  assert.deepEqual(agentProfile(config, "backend", "scout").fallback, { model: "s/mini", thinking: "low" }, "scouts think low on it too");
  assert.equal(agentProfile(config, "qa", "researcher").fallback, undefined, "inherit means none, and a thinking level alone is dropped");
  assert.equal(config.researcher.fallbackThinking, undefined);
  assert.deepEqual(fallbackOf({ fallbackModel: "b/y", fallbackThinking: "bogus", thinking: "medium" }), { model: "b/y", thinking: "medium" });
});

test("the settings menu sets and clears a fallback", () => {
  const set = patchEntry(DEFAULT_CONFIG, "backend", { fallbackModel: "b/y", fallbackThinking: "low" });
  assert.deepEqual(agentProfile(set, "backend", "worker").fallback, { model: "b/y", thinking: "low" });
  const cleared = patchEntry(set, "backend", { fallbackModel: "inherit" });
  assert.equal(cleared.agents.backend.fallbackModel, undefined);
  assert.equal(cleared.agents.backend.fallbackThinking, undefined);
  assert.equal(patchEntry(DEFAULT_CONFIG, "scout", { fallbackModel: "s/mini" }).scout.fallbackModel, "s/mini");
  assert.equal(patchEntry(patchEntry(DEFAULT_CONFIG, "master", { fallbackModel: "m/x" }), "master", { fallbackModel: "inherit" }).master.fallbackModel, undefined);
});

test("the master's turn that failed on usage is seen, and the session switches to its fallback", async () => {
  assert.equal(usageFailure([{ role: "user" }, { role: "assistant", stopReason: "stop" }]), undefined);
  assert.equal(usageFailure([{ role: "assistant", stopReason: "error", errorMessage: "TypeError" }]), undefined);
  assert.match(usageFailure([{ role: "assistant", stopReason: "error", errorMessage: "usage limit reached" }])!, /usage limit/);

  const dir = mkdtempSync(join(tmpdir(), "bl-fb-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ master: { model: "claude/fable", thinking: "high", fallbackModel: "deepseek/v3", fallbackThinking: "low" } }));
  const previous = process.env.BOT_LOBBY_CONFIG_DIR;
  process.env.BOT_LOBBY_CONFIG_DIR = dir;
  try {
    const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
    const calls: string[] = [];
    const pi = {
      on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => void handlers.set(name, handler),
      setModel: async (model: { provider: string; id: string }) => { calls.push(`model ${model.provider}/${model.id}`); return true; },
      setThinkingLevel: (level: string) => calls.push(`thinking ${level}`),
      sendUserMessage: async (text: string) => { calls.push(`say ${text.slice(0, 40)}`); },
    } as unknown as ExtensionAPI;
    registerMasterFallback(pi);
    const notes: string[] = [];
    const ctx = {
      model: { provider: "claude", id: "fable" },
      modelRegistry: { find: (provider: string, id: string) => ({ provider, id }), getAvailable: () => [] },
      ui: { notify: (message: string) => notes.push(message) },
    } as unknown as ExtensionContext;
    handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "You've hit your usage limit" }] }, ctx);
    await handlers.get("agent_settled")!({}, ctx);
    assert.deepEqual(calls.slice(0, 2), ["model deepseek/v3", "thinking low"]);
    assert.match(calls[2]!, /^say bot-lobby: your last turn failed/);
    assert.match(notes[0]!, /ran out of usage; the master now runs on deepseek\/v3/);
    // A settled turn that did not fail on usage does nothing.
    calls.length = 0;
    handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
    await handlers.get("agent_settled")!({}, ctx);
    assert.deepEqual(calls, []);
  } finally {
    if (previous === undefined) delete process.env.BOT_LOBBY_CONFIG_DIR;
    else process.env.BOT_LOBBY_CONFIG_DIR = previous;
  }
});
