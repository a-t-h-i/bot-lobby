import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentProfile, DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";
import { claudeSdkOptions, extraArgsOf, loadClaudeSdk, setClaudeSdkLoader } from "../src/harness/claude-sdk.ts";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_HARNESS_SETTINGS, normalizeHarnesses, type HarnessRun, type HarnessSettings } from "../src/schemas/harness.ts";
import { harnessEffort, harnessModelId, harnessModels } from "../src/harness/catalog.ts";
import { codexArgs } from "../src/harness/codex.ts";
import { claudeArgs } from "../src/harness/claude.ts";
import { acpEffortChoice, acpPermissionOption } from "../src/harness/acp.ts";
import { accessOf, planHarnessRun } from "../src/harness/runner.ts";
import { acpPromptWithInstructions, harnessInstructions } from "../src/harness/instructions.ts";
import { findCommand } from "../src/harness/status.ts";
import { runPiAgent, type PiStreamEvent } from "../src/execution/pi-runner.ts";
import { runAgent } from "../src/execution/agent-runner.ts";
import { tokenizeCliArgs } from "../src/harness/cli-args.ts";

const settings = (patch: Partial<HarnessSettings> = {}): HarnessSettings => ({ ...DEFAULT_HARNESS_SETTINGS, customModels: [], ...patch });
const run = (id: HarnessRun["id"], model = "", patch: Partial<HarnessSettings> = {}): HarnessRun => ({ id, model, settings: settings(patch) });

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "bot-lobby-harness-test-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** A fake harness executable: a node script that logs its argv, env and stdin, then runs `body`. */
function fakeHarness(name: string, body: string): { path: string; log: () => { argv: string[]; env: Record<string, string>; stdin: string[] } } {
  const path = join(dir, name);
  const logFile = join(dir, `${name}.log.json`);
  writeFileSync(path, `#!/usr/bin/env node
const fs = require("node:fs");
const log = { argv: process.argv.slice(2), env: { CODEX_HOME: process.env.CODEX_HOME, DISABLE_AUTO_COMPACT: process.env.DISABLE_AUTO_COMPACT, CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK }, stdin: [] };
const save = () => fs.writeFileSync(${JSON.stringify(logFile)}, JSON.stringify(log));
save();
const out = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let buffer = "";
const lines = [];
const waiters = [];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    log.stdin.push(line);
    save();
    const waiter = waiters.shift();
    if (waiter) waiter(line); else lines.push(line);
  }
});
process.stdin.on("end", () => {
  if (buffer) { log.stdin.push(buffer); save(); const waiter = waiters.shift(); if (waiter) waiter(buffer); else lines.push(buffer); buffer = ""; }
  for (const waiter of waiters.splice(0)) waiter(null);
  ended = true;
});
let ended = false;
const next = () => new Promise((resolve) => { if (lines.length) resolve(lines.shift()); else if (ended) resolve(null); else waiters.push(resolve); });
(async () => { ${body} })();
`, "utf8");
  chmodSync(path, 0o755);
  return { path, log: () => JSON.parse(readFileSync(logFile, "utf8")) };
}

test("harness fields survive normalising for subagents and are dropped for the oracle and planner", () => {
  const config = resolveConfig({
    master: { model: "inherit", thinking: "high", harness: "codex" },
    planner: { model: "inherit", thinking: "high", harness: "claude" },
    agents: { backend: { model: "a/b", thinking: "high", harness: "codex", harnessModel: "gpt-6-astra" }, qa: { model: "a/b", thinking: "high", harness: "pi" } },
    scout: { model: "a/b", harness: "gemini" },
    researcher: { model: "a/b", thinking: "low", harness: "nope" },
    harnesses: { codex: { binaryPath: " /opt/codex ", compactAt: 5, customModels: ["my-model", "my-model", "has space"] }, claude: { injectPrompts: false } },
  });
  assert.equal(config.master.harness, undefined);
  assert.equal(config.planner.harness, undefined);
  assert.deepEqual([config.agents.backend.harness, config.agents.backend.harnessModel], ["codex", "gpt-6-astra"]);
  assert.equal(config.agents.qa.harness, undefined);
  assert.equal(config.scout.harness, "gemini");
  assert.equal(config.researcher.harness, undefined, "an unknown harness is dropped");
  assert.equal(config.harnesses.codex.binaryPath, "/opt/codex");
  assert.equal(config.harnesses.codex.compactAt, 10_000, "a threshold is clamped to the smallest one a harness accepts");
  assert.deepEqual(config.harnesses.codex.customModels, ["my-model"]);
  assert.equal(config.harnesses.claude.injectPrompts, false);
  assert.equal(config.harnesses.gemini.injectPrompts, true);
  assert.deepEqual(Object.keys(normalizeHarnesses(undefined)).sort(), ["acp", "antigravity", "claude", "codex", "gemini", "opencode"]);
});

test("a profile carries its harness with that harness's settings", () => {
  const config = resolveConfig({ agents: { backend: { model: "a/b", thinking: "high", harness: "claude", harnessModel: "claude-opus-5-5" } }, harnesses: { claude: { homePath: "/h" } } });
  const profile = agentProfile(config, "backend", "worker");
  assert.equal(profile.harness?.id, "claude");
  assert.equal(profile.harness?.model, "claude-opus-5-5");
  assert.equal(profile.harness?.settings.homePath, "/h");
  assert.equal(agentProfile(DEFAULT_CONFIG, "backend", "worker").harness, undefined);
});

test("the catalog lists each harness's models with the efforts they take", () => {
  const claude = harnessModels("claude", settings({ customModels: ["claude-typed"] }));
  const opus = claude.find((model) => model.id === "claude-opus-5-5");
  assert.ok(opus?.current);
  assert.deepEqual(opus?.efforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(claude.at(-1)?.id, "claude-typed");
  assert.equal(claude.at(-1)?.custom, true);
  assert.ok(claude.findIndex((model) => !model.current) > claude.findIndex((model) => model.current), "current models come first");
  const codex = harnessModels("codex", settings());
  assert.ok(codex.some((model) => model.id === "gpt-6.1-sol"));
  assert.deepEqual(codex[0]?.efforts, ["minimal", "low", "medium", "high", "xhigh"]);
  const antigravity = harnessModels("antigravity", settings());
  const flash = antigravity.find((model) => model.id === "gemini-3.8-flash");
  assert.deepEqual(flash?.efforts, ["low", "medium", "high"]);
  assert.equal(flash?.label, "Gemini 3.8 Flash");
});

test("effort levels become each harness's own value", () => {
  assert.equal(harnessEffort("codex", settings(), "gpt-6.1-sol", "max"), "xhigh");
  assert.equal(harnessEffort("codex", settings(), "gpt-6.1-sol", "off"), "minimal");
  assert.equal(harnessEffort("claude", settings(), "claude-opus-5-5", "minimal"), "low");
  // Sonnet 4.6 has no xhigh: the slider's xhigh lands on high.
  assert.equal(harnessEffort("claude", settings(), "claude-sonnet-4-6", "xhigh"), "high");
  // Opus 4.7's manifest maps xhigh to Claude Code's max.
  assert.equal(harnessEffort("claude", settings(), "claude-opus-4-7", "xhigh"), "max");
  assert.equal(harnessModelId("antigravity", settings(), "gemini-3.8-flash", "max"), "gemini-3.8-flash-high");
  assert.equal(harnessModelId("antigravity", settings(), "gemini-3.8-flash", "low"), "gemini-3.8-flash-low");
  assert.equal(harnessEffort("gemini", settings(), "", "high"), undefined);
});

test("Codex runs read-only roles in a read-only sandbox and carries the instructions, effort, provider and compaction", () => {
  const plan = { ...planHarnessRun({ harness: run("codex", "gpt-6.1-sol", { modelProvider: "ollama", compactAt: 200_000 }), systemPrompt: "ROLE PROMPT", thinking: "high", agent: { runId: "r", taskId: "t", domain: "backend", role: "scout" } }) };
  const scout = codexArgs(plan, accessOf(["read", "grep"]), ["--strict-config"]);
  assert.deepEqual(scout.args.slice(0, 7), ["exec", "--strict-config", "--json", "--skip-git-repo-check", "-s", "read-only", "-c"]);
  assert.ok(scout.args.includes('model_reasoning_effort="high"'));
  assert.deepEqual(scout.args.slice(scout.args.indexOf("--oss"), scout.args.indexOf("--oss") + 3), ["--oss", "--local-provider", "ollama"]);
  assert.ok(scout.args.includes("model_auto_compact_token_limit=200000"));
  const instructions = scout.args.find((arg) => arg.startsWith("developer_instructions="));
  assert.ok(instructions?.includes("ROLE PROMPT"));
  assert.ok(instructions?.includes("Codex CLI harness, as gpt-6.1-sol with high reasoning effort"));
  assert.equal(scout.args.at(-1), "-");
  const worker = codexArgs({ ...plan, autoCompact: false }, accessOf(["read", "edit", "bash"]), []);
  assert.ok(worker.args.includes("workspace-write"));
  assert.ok(worker.args.some((arg) => arg.startsWith("model_auto_compact_token_limit=1000000000000")), "auto-compaction off sets a threshold it never reaches");
  const huge = codexArgs({ ...plan, instructions: "x".repeat(120_000) }, accessOf(undefined), []);
  assert.ok(!huge.args.some((arg) => arg.startsWith("developer_instructions=")));
  assert.equal(huge.promptPrefix.length, 120_000);
});

test("Claude Code gets only the role's tools in dontAsk mode, and its compaction settings", () => {
  const plan = planHarnessRun({ harness: run("claude", "claude-sonnet-4-6", { compactAt: 300_000, modelProvider: "bedrock" }), systemPrompt: "ROLE", thinking: "max" });
  const reviewer = claudeArgs(plan, accessOf(["read", "grep", "find", "ls", "bash"]), [], "/tmp/p.md");
  const at = (flag: string) => reviewer.args[reviewer.args.indexOf(flag) + 1];
  assert.equal(at("--tools"), "Read,Grep,Glob,Bash");
  assert.equal(at("--permission-mode"), "dontAsk");
  assert.equal(at("--effort"), "high", "Sonnet 4.6's effort map turns max into high");
  assert.equal(at("--append-system-prompt-file"), "/tmp/p.md");
  assert.equal(at("--settings"), JSON.stringify({ autoCompactWindow: 300_000 }));
  assert.equal(reviewer.env.CLAUDE_CODE_USE_BEDROCK, "1");
  const worker = claudeArgs({ ...plan, autoCompact: false }, accessOf(undefined), [], undefined);
  assert.equal(worker.args[worker.args.indexOf("--permission-mode") + 1], "bypassPermissions");
  assert.ok(!worker.args.includes("--settings"));
  assert.equal(worker.env.DISABLE_AUTO_COMPACT, "1");
});

test("instructions carry the role prompt, or only the report format when injection is off", () => {
  const on = harnessInstructions({ harness: run("gemini"), systemPrompt: "ROLE", contract: "FORMAT" });
  assert.ok(on.includes("ROLE") && on.includes("Running on another harness") && !on.includes("FORMAT"));
  const off = harnessInstructions({ harness: run("gemini", "", { injectPrompts: false }), systemPrompt: "ROLE", contract: "FORMAT" });
  assert.ok(off.includes("FORMAT") && !off.includes("ROLE"));
  assert.ok(off.includes("Gemini CLI harness"));
  assert.match(acpPromptWithInstructions("Task: x", "I"), /^<bot_lobby_instructions>\nI\n<\/bot_lobby_instructions>\n\n<user_request>\nTask: x\n<\/user_request>$/);
  assert.equal(acpPromptWithInstructions("/compact", "I"), "/compact");
});

test("ACP permission requests are answered from the role's allowlist", () => {
  const options = [{ optionId: "yes", kind: "allow_once" }, { optionId: "always", kind: "allow_always" }, { optionId: "no", kind: "reject_once" }];
  const scout = accessOf(["read", "grep"]);
  assert.equal(acpPermissionOption({ toolCall: { toolCallId: "1", kind: "read" }, options }, scout), "yes");
  assert.equal(acpPermissionOption({ toolCall: { toolCallId: "1", kind: "edit" }, options }, scout), "no");
  assert.equal(acpPermissionOption({ toolCall: { toolCallId: "1", kind: "execute" }, options }, scout), "no");
  assert.equal(acpPermissionOption({ toolCall: { toolCallId: "1", kind: "execute" }, options }, accessOf(["read", "bash"])), "yes");
  assert.equal(acpPermissionOption({ toolCall: { toolCallId: "1", kind: "edit" }, options }, accessOf(undefined)), "yes");
  assert.equal(acpPermissionOption({ toolCall: { toolCallId: "interaction_1", kind: "other" }, options }, accessOf(undefined)), undefined);
  const effort = { id: "thought", category: "thought_level", options: [{ value: "lo", name: "Low" }, { value: "hi", name: "High" }] };
  assert.equal(acpEffortChoice(effort, "xhigh"), "hi");
  assert.equal(acpEffortChoice(effort, "medium"), "lo");
});

test("launch arguments split like a shell would", () => {
  assert.deepEqual(tokenizeCliArgs(`-c 'a=b c' --flag "x \\"y\\""`), ["-c", "a=b c", "--flag", 'x "y"']);
  assert.deepEqual(tokenizeCliArgs(""), []);
});

test("findCommand finds an executable by path and ignores a missing one", () => {
  const fake = fakeHarness("probe", "process.exit(0);");
  assert.equal(findCommand(fake.path), fake.path);
  assert.equal(findCommand(join(dir, "missing")), undefined);
  assert.equal(findCommand("bot-lobby-no-such-command-xyz"), undefined);
});

test("a step on Codex streams tool use, edits and usage, and reports the final message", async () => {
  const codex = fakeHarness("codex", `
    const prompt = await next();
    out({ type: "thread.started", thread_id: "th_1" });
    out({ type: "turn.started" });
    out({ type: "item.started", item: { id: "i1", type: "command_execution", command: "ls", status: "in_progress" } });
    out({ type: "item.completed", item: { id: "i1", type: "command_execution", command: "ls", exit_code: 0, status: "completed" } });
    out({ type: "item.completed", item: { id: "i2", type: "reasoning", text: "thinking it over" } });
    out({ type: "item.completed", item: { id: "i3", type: "file_change", changes: [{ path: "src/a.ts", kind: "update" }], status: "completed" } });
    out({ type: "item.completed", item: { id: "i4", type: "agent_message", text: "## Completed\\n- done: " + prompt.slice(0, 12) } });
    out({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 7 } });
    process.exit(0);
  `);
  const events: PiStreamEvent[] = [];
  const result = await runAgent({
    taskId: "t1", domain: "backend", role: "worker", instruction: "fix it", context: { task: "fix it" }, cwd: dir,
    harness: run("codex", "gpt-6.1-sol", { binaryPath: codex.path, homePath: "/codex-home" }), thinking: "medium",
    onUpdate: () => {},
  });
  assert.equal(result.status, "success", result.error);
  assert.equal(result.output, "## Completed\n- done: Task: fix it");
  assert.deepEqual(result.edited, [join(dir, "src/a.ts")]);
  assert.equal(result.usage?.input, 100);
  assert.equal(result.usage?.output, 7);
  assert.equal(result.model, "gpt-6.1-sol");
  const log = codex.log();
  assert.equal(log.env.CODEX_HOME, "/codex-home");
  assert.ok(log.argv.includes("workspace-write"));
  assert.ok(log.argv.some((arg) => arg.startsWith("developer_instructions=") && arg.includes("Global Engineering Agent")), "the compiled role prompt is injected");
  void events;
});

test("a failed Codex turn and a missing binary come back as failures naming the harness", async () => {
  const codex = fakeHarness("codex-fail", `
    await next();
    out({ type: "turn.failed", error: { message: "quota exceeded" } });
    process.exit(1);
  `);
  const failed = await runPiAgent({ cwd: dir, task: "x", harness: run("codex", "", { binaryPath: codex.path }) });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Codex CLI: quota exceeded");
  const missing = await runPiAgent({ cwd: dir, task: "x", harness: run("codex", "", { binaryPath: join(dir, "no-codex") }) });
  assert.equal(missing.status, "failed");
  assert.match(missing.error ?? "", /^Codex CLI: .*no-codex was not found/);
});

/** Run `body` with the Agent SDK out of reach, so Claude Code falls back to its CLI. */
async function withoutSdk<T>(body: () => Promise<T>): Promise<T> {
  setClaudeSdkLoader(async () => undefined);
  try {
    return await body();
  } finally {
    setClaudeSdkLoader(async () => (await import("@anthropic-ai/claude-agent-sdk")).query as never);
  }
}

test("without the Agent SDK, a step on Claude Code streams over stream-json, takes a steer, and ends on the result", () => withoutSdk(async () => {
  const claude = fakeHarness("claude", `
    const first = JSON.parse(await next());
    out({ type: "system", subtype: "init", model: "claude-opus-5-5" });
    out({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "plan" }, { type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "${dir}/b.ts" } }] } });
    const steer = JSON.parse(await next());
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: false }] } });
    out({ type: "system", subtype: "compact_boundary" });
    out({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "partial" }] } });
    out({ type: "result", subtype: "success", is_error: false, result: "final: " + first.message.content[0].text + " / " + steer.message.content[0].text, total_cost_usd: 0.25, usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 3 } });
    await next();
    process.exit(0);
  `);
  const events: PiStreamEvent[] = [];
  const result = await runPiAgent({
    cwd: dir, task: "do it", systemPrompt: "ROLE", tools: ["read", "edit"],
    harness: run("claude", "claude-opus-5-5", { binaryPath: claude.path, modelProvider: "bedrock" }), thinking: "high", autoCompact: false,
    onStart: (handle) => setTimeout(() => handle.steer("also this"), 50),
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, "success", result.error);
  assert.equal(result.output, "final: Task: do it / also this");
  assert.equal(result.usage.cost, 0.25);
  assert.equal(result.usage.input, 15);
  assert.equal(result.model, "claude-opus-5-5");
  assert.ok(events.some((event) => event.type === "tool_execution_start" && event.toolName === "edit"));
  assert.ok(events.some((event) => event.type === "thought" && event.text === "plan"));
  assert.ok(events.some((event) => event.type === "compaction"));
  const log = claude.log();
  assert.equal(log.env.DISABLE_AUTO_COMPACT, "1");
  assert.equal(log.env.CLAUDE_CODE_USE_BEDROCK, "1");
  const file = log.argv[log.argv.indexOf("--append-system-prompt-file") + 1]!;
  assert.ok(!existsSync(file), "the instructions file is removed after the run");
}));

test("a step on an ACP agent opens a session, sets model and effort, answers permissions and reports its message", async () => {
  const agent = fakeHarness("acp-agent", `
    const reply = (id, result) => out({ jsonrpc: "2.0", id, result });
    const init = JSON.parse(await next());
    reply(init.id, { protocolVersion: 1, agentCapabilities: {} });
    const created = JSON.parse(await next());
    reply(created.id, { sessionId: "s1", configOptions: [
      { id: "model", category: "model", type: "select", currentValue: "a", options: [{ value: "a", name: "A" }, { value: "pro", name: "Pro" }] },
      { id: "effort", category: "thought_level", type: "select", currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
    ] });
    const setModel = JSON.parse(await next());
    reply(setModel.id, {});
    const setEffort = JSON.parse(await next());
    reply(setEffort.id, {});
    const prompt = JSON.parse(await next());
    const update = (u) => out({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: u } });
    update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
    update({ sessionUpdate: "tool_call", toolCallId: "c1", title: "Edit file", kind: "edit", status: "pending", locations: [{ path: "${dir}/c.ts" }] });
    out({ jsonrpc: "2.0", id: 99, method: "session/request_permission", params: { sessionId: "s1", toolCall: { toolCallId: "c1", kind: "edit" }, options: [{ optionId: "ok", kind: "allow_once", name: "Allow" }, { optionId: "no", kind: "reject_once", name: "Reject" }] } });
    const permission = JSON.parse(await next());
    update({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" });
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done " } });
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify([setModel.method, setModel.params.value, setEffort.params.value, permission.result.outcome.optionId, prompt.params.prompt[0].text.startsWith("<bot_lobby_instructions>")]) } });
    reply(prompt.id, { stopReason: "end_turn" });
    await next();
  `);
  const events: PiStreamEvent[] = [];
  const result = await runPiAgent({
    cwd: dir, task: "go", systemPrompt: "ROLE", tools: ["read", "edit", "bash"],
    harness: run("acp", "pro", { binaryPath: agent.path }), thinking: "xhigh",
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, "success", result.error);
  assert.equal(result.output, `Done ${JSON.stringify(["session/set_config_option", "pro", "high", "ok", true])}`);
  assert.ok(events.some((event) => event.type === "tool_execution_start" && event.toolName === "edit"));
  assert.ok(events.some((event) => event.type === "thought" && event.text === "hmm"));
});

test("an ACP agent that cannot open a session fails with its reason", async () => {
  const agent = fakeHarness("acp-noauth", `
    const init = JSON.parse(await next());
    out({ jsonrpc: "2.0", id: init.id, result: { protocolVersion: 1 } });
    const created = JSON.parse(await next());
    out({ jsonrpc: "2.0", id: created.id, error: { code: -32000, message: "Authentication required" } });
    await next();
  `);
  const result = await runPiAgent({ cwd: dir, task: "go", harness: run("gemini", "", { binaryPath: agent.path }) });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /^Gemini CLI: the agent did not open a session: Authentication required \(sign in/);
});

test("cancelling a harness run ends it as cancelled", async () => {
  const agent = fakeHarness("codex-slow", `await next(); await new Promise((r) => setTimeout(r, 30000));`);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const result = await runPiAgent({ cwd: dir, task: "x", signal: controller.signal, harness: run("codex", "", { binaryPath: agent.path }) });
  assert.equal(result.status, "cancelled");
});

test("Claude Code goes through the Agent SDK when it is installed, with the role's prompt, effort, tools and settings", async () => {
  assert.ok(await loadClaudeSdk(), "the SDK is installed as an optional dependency");
  const seen: { options?: Options; prompts: string[] } = { prompts: [] };
  setClaudeSdkLoader(async () => ((params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => {
    seen.options = params.options;
    return (async function* () {
      const input = params.prompt[Symbol.asyncIterator]();
      const text = async () => {
        const next = await input.next();
        const content = next.done ? undefined : next.value.message.content;
        const value = Array.isArray(content) ? (content[0] as { text: string }).text : "";
        seen.prompts.push(value);
        return value;
      };
      const first = await text();
      yield { type: "system", subtype: "init", model: "claude-opus-5-5" };
      yield { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Edit", input: { file_path: `${dir}/c.ts` } }] } };
      const steer = await text();
      yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: false }] } };
      yield { type: "result", subtype: "success", is_error: false, result: `sdk: ${first} / ${steer}`, total_cost_usd: 0.1, usage: { input_tokens: 7, output_tokens: 2 } };
      assert.equal((await input.next()).done, true, "the input ends with the turn's result");
    })() as never;
  }) as never);
  try {
    const events: PiStreamEvent[] = [];
    const result = await runPiAgent({
      cwd: dir, task: "do it", systemPrompt: "ROLE", tools: ["read", "edit"],
      harness: run("claude", "claude-opus-5-5", { binaryPath: "/opt/my-claude", modelProvider: "bedrock", launchArgs: "--foo=bar --verbose", compactAt: 300_000 }), thinking: "high",
      onStart: (handle) => setTimeout(() => handle.steer("also this"), 20),
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.status, "success", result.error);
    assert.equal(result.output, "sdk: Task: do it / also this");
    assert.equal(result.usage.cost, 0.1);
    assert.ok(events.some((event) => event.type === "tool_execution_start" && event.toolName === "edit"));
    const options = seen.options!;
    assert.equal(options.pathToClaudeCodeExecutable, "/opt/my-claude");
    assert.equal(options.model, "claude-opus-5-5");
    assert.equal(options.effort, "high");
    assert.deepEqual(options.systemPrompt && typeof options.systemPrompt === "object" && !Array.isArray(options.systemPrompt) ? [options.systemPrompt.type, "preset" in options.systemPrompt ? options.systemPrompt.preset : ""] : [], ["preset", "claude_code"]);
    assert.match(JSON.stringify(options.systemPrompt), /ROLE/);
    assert.deepEqual([options.permissionMode, options.allowDangerouslySkipPermissions], ["bypassPermissions", true]);
    assert.equal(options.persistSession, false);
    assert.equal(options.env?.CLAUDE_CODE_USE_BEDROCK, "1");
    assert.deepEqual(options.settings, { autoCompactWindow: 300_000 });
    assert.deepEqual(options.extraArgs, { foo: "bar", verbose: null });
  } finally {
    setClaudeSdkLoader(async () => (await import("@anthropic-ai/claude-agent-sdk")).query as never);
  }
});

test("through the SDK, read-only roles get only their tools", () => {
  const input = { cwd: dir, env: {}, launchArgs: [], abort: new AbortController(), stderr: () => {} };
  const plan = planHarnessRun({ harness: run("claude"), systemPrompt: "R", thinking: "low" });
  const readOnly = claudeSdkOptions(plan, accessOf(["read", "grep", "bash"]), input);
  assert.deepEqual([readOnly.tools, readOnly.allowedTools, readOnly.permissionMode], [["Read", "Grep", "Bash"], ["Read", "Grep", "Bash"], "dontAsk"]);
  assert.deepEqual(extraArgsOf(["--a", "1", "-b", "--c=x=y", "loose"]), { a: "1", b: null, c: "x=y" });
});
