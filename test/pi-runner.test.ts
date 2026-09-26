import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPiArgs,
  createStreamCollector,
  isPiLauncher,
  parsePiStream,
  runPiAgent,
  spawnPiProcess,
  type ProcessOutcome,
  type ProcessRunner,
} from "../src/execution/pi-runner.ts";


// The suite can run inside a subagent process (BOT_LOBBY_SUBAGENT=1), where
// ambient gate variables would otherwise leak into spawned-process assertions.
let ambientSubagent: string | undefined;
before(() => {
  ambientSubagent = process.env.BOT_LOBBY_SUBAGENT;
  delete process.env.BOT_LOBBY_SUBAGENT;
});
after(() => {
  if (ambientSubagent === undefined) delete process.env.BOT_LOBBY_SUBAGENT;
  else process.env.BOT_LOBBY_SUBAGENT = ambientSubagent;
});
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

test("buildPiArgs contains RPC isolation flags and role tools, never the task", () => {
  const args = buildPiArgs({
    cwd: "/proj",
    tools: ["read", "grep"],
    model: "provider/model",
    thinking: "high",
    timeoutMs: 1000,
    systemPromptFile: "/tmp/system.md",
  });
  assert.deepEqual(args.slice(0, 5), ["--mode", "rpc", "--no-session", "--no-prompt-templates", "--no-themes"]);
  assert.ok(args.includes("--tools"));
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep");
  assert.equal(args[args.indexOf("--model") + 1], "provider/model");
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "/tmp/system.md");
  assert.ok(!args.some((arg) => arg.includes("Do the thing")));
});

test("buildPiArgs omits --model when inheriting", () => {
  const args = buildPiArgs({ cwd: "/p", model: "inherit", timeoutMs: 1 });
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

test("stream collector keeps assistant message_end lines and drops the rest", () => {
  const collector = createStreamCollector();
  const lines = [
    JSON.stringify({ type: "agent_start" }),
    JSON.stringify({ type: "message_end", message: { role: "user" } }),
    JSON.stringify({ type: "message_update", message: { role: "assistant" } }),
    JSON.stringify({ type: "tool_execution_end", result: "x".repeat(500) }),
    "not json",
    "null",
    assistantEvent("first"),
    assistantEvent("final"),
  ];
  collector.push(`${lines.join("\n")}\n`);
  const kept = collector.finish();
  assert.ok(!kept.includes("tool_execution_end"));
  assert.ok(!kept.includes('"role":"user"'));
  const parsed = parsePiStream(kept);
  assert.equal(parsed.text, "final");
  assert.equal(parsed.usage.turns, 2);
});

test("stream collector reassembles an event split across chunk boundaries", () => {
  const collector = createStreamCollector();
  const event = assistantEvent("split report");
  collector.push(event.slice(0, 25));
  collector.push(event.slice(25));
  assert.equal(parsePiStream(collector.finish()).text, "split report");
});

test("runPiAgent keeps the final report when the stream is 20x the old cap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-pi-"));
  const stub = join(dir, "fake-pi.mjs");
  const finalEvent = assistantEvent("## Verdict PASS\nfinal report");
  writeFileSync(
    stub,
    [
      "#!/usr/bin/env node",
      'const chunk = \'{"type":"message_update","message":{"role":"assistant"}}\\n\'.repeat(1250);',
      "const writes = Math.ceil((20 * 5_000_000) / chunk.length);",
      "for (let i = 0; i < writes; i += 1) process.stdout.write(chunk);",
      `process.stdout.write(${JSON.stringify(`${finalEvent}\n`)});`,
    ].join("\n"),
    { mode: 0o755 },
  );
  chmodSync(stub, 0o755);
  const previous = process.env.BOT_LOBBY_PI_BIN;
  process.env.BOT_LOBBY_PI_BIN = stub;
  try {
    const result = await runPiAgent({ cwd: dir, task: "review", timeoutMs: 120_000 });
    assert.equal(result.status, "success");
    assert.match(result.output, /## Verdict PASS/);
    assert.equal(result.usage.turns, 1);
  } finally {
    if (previous === undefined) delete process.env.BOT_LOBBY_PI_BIN;
    else process.env.BOT_LOBBY_PI_BIN = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Point BOT_LOBBY_PI_BIN at a throwaway stub and return the restore/cleanup hook. */
function withFakePi(script: string): () => void {
  const dir = mkdtempSync(join(tmpdir(), "dh-pi-activity-"));
  const stub = join(dir, "fake-pi.mjs");
  writeFileSync(stub, script, { mode: 0o755 });
  chmodSync(stub, 0o755);
  const previous = process.env.BOT_LOBBY_PI_BIN;
  process.env.BOT_LOBBY_PI_BIN = stub;
  return () => {
    if (previous === undefined) delete process.env.BOT_LOBBY_PI_BIN;
    else process.env.BOT_LOBBY_PI_BIN = previous;
    rmSync(dir, { recursive: true, force: true });
  };
}

/** Stub pi that splits the first tool line across two stdout writes. */
function activityScript(): string {
  const read = '{"type":"tool_execution_start","toolCallId":"1","toolName":"read"}\n';
  const bash = '{"type":"tool_execution_start","toolCallId":"2","toolName":"bash"}\n';
  const write = (payload: string) => `process.stdout.write(${JSON.stringify(payload)});`;
  const lines = ["#!/usr/bin/env node", write(read.slice(0, 40)), write(read.slice(40)), write(bash), write(`${assistantEvent("## done")}\n`)];
  return lines.join("\n");
}

test("stream collector forwards tool starts while keeping only the report", () => {
  const tools: string[] = [];
  const collector = createStreamCollector((event) => {
    if (event.type === "tool_execution_start") tools.push(event.toolName);
  });
  const toolLine = JSON.stringify({ type: "tool_execution_start", toolCallId: "1", toolName: "grep" });
  const report = assistantEvent("report");
  collector.push(`${toolLine}\n${report.slice(0, 10)}`);
  collector.push(`${report.slice(10)}\n`);
  const kept = collector.finish();
  assert.deepEqual(tools, ["grep"]);
  assert.ok(!kept.includes("tool_execution_start"));
  assert.equal(parsePiStream(kept).text, "report");
});

test("a tool_execution_start stream drives onActivity through the spawned process", async () => {
  const cleanup = withFakePi(activityScript());
  try {
    const words: string[] = [];
    const result = await runPiAgent({
      cwd: process.cwd(),
      task: "explore",
      timeoutMs: 30_000,
      onActivity: (word) => words.push(word),
    });
    assert.equal(result.status, "success");
    assert.deepEqual(words, ["reading", "running"]);
  } finally {
    cleanup();
  }
});

test("runPiAgent maps streamed tool names to activity words", async () => {
  const words: string[] = [];
  const streaming: ProcessRunner = async (_args, options) => {
    options.onEvent?.({ type: "tool_execution_start", toolName: "grep" });
    return outcome(assistantEvent("ok"));
  };
  const result = await runPiAgent(
    { cwd: "/p", task: "t", timeoutMs: 1000, onActivity: (word) => words.push(word) },
    streaming,
  );
  assert.equal(result.status, "success");
  assert.deepEqual(words, ["searching"]);
});

test("absent onEvent and onActivity callbacks are optional", async () => {
  const cleanup = withFakePi(activityScript());
  try {
    const spawned = await spawnPiProcess(["Task: t"], { cwd: process.cwd(), timeoutMs: 30_000 });
    assert.equal(spawned.exitCode, 0);
    const result = await runPiAgent({ cwd: process.cwd(), task: "t", timeoutMs: 30_000 });
    assert.equal(result.status, "success");
  } finally {
    cleanup();
  }
});

test("stream collector joins a line split over many chunks and several lines in one chunk", () => {
  const tools: string[] = [];
  const collector = createStreamCollector((event) => {
    if (event.type === "tool_execution_start") tools.push(event.toolName);
  });
  const report = assistantEvent("many chunks — ünïcode report");
  for (let at = 0; at < report.length; at += 3) collector.push(report.slice(at, at + 3));
  const tool = JSON.stringify({ type: "tool_execution_start", toolCallId: "1", toolName: "read" });
  collector.push(`\n${tool}\n${JSON.stringify({ type: "message_update", usage: {} })}\n`);
  assert.equal(parsePiStream(collector.finish()).text, "many chunks — ünïcode report");
  assert.deepEqual(tools, ["read"]);
});

/* -------------------------------------------------------------------------
 * RPC transport: stub pi processes that speak the stdin/stdout protocol.
 * ---------------------------------------------------------------------- */

/** A stub pi whose `onCommand(cmd, emit)` body reacts to each RPC command; stdin end exits. */
function rpcStub(body: string, preamble = ""): string {
  return [
    "#!/usr/bin/env node",
    'import { appendFileSync } from "node:fs";',
    preamble,
    "const log = process.env.STUB_LOG;",
    "const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');",
    `const report = (text) => emit(${JSON.stringify(JSON.parse(assistantEvent("__TEXT__")))});`.replace(
      '"__TEXT__"',
      "text",
    ),
    "const settle = () => { emit({ type: 'agent_end', messages: [], willRetry: false }); emit({ type: 'agent_settled' }); };",
    "async function onCommand(cmd) {",
    body,
    "}",
    "let buffer = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => {",
    "  buffer += chunk;",
    "  let at;",
    "  while ((at = buffer.indexOf('\\n')) >= 0) {",
    "    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);",
    "    if (!line) continue;",
    "    const cmd = JSON.parse(line);",
    "    if (log) appendFileSync(log, JSON.stringify(cmd) + '\\n');",
    "    void onCommand(cmd);",
    "  }",
    "});",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n");
}

function commandLog(): { path: string; read(): Array<Record<string, unknown>> } {
  const path = join(mkdtempSync(join(tmpdir(), "dh-rpc-log-")), "commands.jsonl");
  return {
    path,
    read() {
      try {
        return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
  };
}

async function withStub<T>(script: string, fn: (log: ReturnType<typeof commandLog>) => Promise<T>): Promise<T> {
  const cleanup = withFakePi(script);
  const log = commandLog();
  const previous = process.env.STUB_LOG;
  process.env.STUB_LOG = log.path;
  try {
    return await fn(log);
  } finally {
    if (previous === undefined) delete process.env.STUB_LOG;
    else process.env.STUB_LOG = previous;
    cleanup();
  }
}

test("rpc: the task arrives as a prompt on stdin and agent_settled ends the run", async () => {
  const script = rpcStub(`
    if (cmd.type !== "prompt") return;
    emit({ type: "turn_start" });
    emit({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "src/app.ts" } });
    emit({ type: "tool_execution_end", toolCallId: "1", toolName: "read", isError: false });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hm" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "m" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "ok" } });
    report("## done " + cmd.message);
    settle();`);
  await withStub(script, async (log) => {
    const events: string[] = [];
    const result = await runPiAgent({ cwd: process.cwd(), task: "ship it", timeoutMs: 20_000, onEvent: (event) => events.push(event.type) });
    assert.equal(result.status, "success");
    assert.match(result.output, /## done Task: ship it/);
    const commands = log.read();
    assert.equal(commands[0]!.type, "prompt");
    assert.equal(commands[0]!.message, "Task: ship it");
    for (const type of ["turn_start", "tool_execution_start", "tool_execution_end", "thinking", "writing", "usage"]) {
      assert.ok(events.includes(type), `${type} forwarded`);
    }
    assert.equal(events.filter((type) => type === "thinking").length, 1, "thinking reported once per phase");
  });
});

test("rpc: a silent agent is killed as stalled", async () => {
  const script = rpcStub("", "setInterval(() => {}, 1000);");
  await withStub(script, async () => {
    const started = Date.now();
    const result = await runPiAgent({ cwd: process.cwd(), task: "t", timeoutMs: 20_000, stallTimeoutMs: 300 });
    assert.equal(result.status, "timeout");
    assert.equal(result.stalled, true);
    assert.match(result.error!, /stalled: no output/);
    assert.ok(Date.now() - started < 10_000, "stall detection is prompt");
  });
});

test("rpc: provider retries extend the silence allowance and are forwarded", async () => {
  const script = rpcStub(`
    if (cmd.type !== "prompt") return;
    emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 600, errorMessage: "429 rate limited" });
    emit({ type: "compaction_start", reason: "threshold" });
    setTimeout(() => { emit({ type: "auto_retry_end", success: true, attempt: 1 }); report("## done"); settle(); }, 500);`);
  await withStub(script, async () => {
    const events: string[] = [];
    const result = await runPiAgent({ cwd: process.cwd(), task: "t", timeoutMs: 20_000, stallTimeoutMs: 250, onEvent: (event) => events.push(event.type) });
    assert.equal(result.status, "success", result.error);
    assert.ok(events.includes("retry") && events.includes("retry_end") && events.includes("compaction"));
  });
});

test("rpc: the agent is steered to wrap up before the deadline and its report is kept", async () => {
  const script = rpcStub(`
    if (cmd.type === "steer") { report("## partial report"); settle(); }`, "setInterval(() => {}, 1000);");
  await withStub(script, async (log) => {
    const events: string[] = [];
    const result = await runPiAgent({ cwd: process.cwd(), task: "t", timeoutMs: 10_000, wrapUpAtMs: 200, onEvent: (event) => events.push(event.type) });
    assert.equal(result.status, "success");
    assert.equal(result.wrappedUp, true);
    assert.match(result.output, /partial report/);
    assert.ok(events.includes("wrap_up"));
    assert.ok(log.read().some((command) => command.type === "steer"));
  });
});

test("rpc: the deadline aborts the agent and times it out", async () => {
  const script = rpcStub("", "setInterval(() => emit({ type: 'turn_start' }), 50); process.stdin.removeAllListeners('end');");
  await withStub(script, async (log) => {
    const pending = spawnPiProcess([], { cwd: process.cwd(), timeoutMs: 300, prompt: "Task: t", graceMs: 100 });
    const outcome = await pending;
    assert.equal(outcome.timedOut, true);
    assert.ok(log.read().some((command) => command.type === "abort"), "abort sent before the kill");
  });
});

test("rpc: a grandchild holding stdout does not hang the run", async () => {
  const script = rpcStub(`
    if (cmd.type !== "prompt") return;
    spawn("sleep", ["30"], { stdio: ["ignore", "inherit", "inherit"] });
    report("## done");
    settle();`, 'import { spawn } from "node:child_process";');
  await withStub(script, async () => {
    const started = Date.now();
    const result = await runPiAgent({ cwd: process.cwd(), task: "t", timeoutMs: 20_000 });
    assert.equal(result.status, "success");
    assert.ok(Date.now() - started < 8_000, `finished in ${Date.now() - started}ms`);
  });
});

test("rpc: extension dialogs are cancelled instead of blocking the agent", async () => {
  const script = rpcStub(`
    if (cmd.type === "prompt") emit({ type: "extension_ui_request", id: "d1", method: "select", title: "Pick", options: ["a"] });
    if (cmd.type === "extension_ui_response" && cmd.id === "d1" && cmd.cancelled) { report("## unblocked"); settle(); }`);
  await withStub(script, async () => {
    const result = await runPiAgent({ cwd: process.cwd(), task: "t", timeoutMs: 20_000 });
    assert.equal(result.status, "success");
    assert.match(result.output, /unblocked/);
  });
});

test("rpc: a rejected prompt fails the run with the host's reason", async () => {
  const script = rpcStub(`
    if (cmd.type === "prompt") emit({ type: "response", id: cmd.id, command: "prompt", success: false, error: "model not found" });`);
  await withStub(script, async () => {
    const result = await runPiAgent({ cwd: process.cwd(), task: "t", timeoutMs: 20_000 });
    assert.equal(result.status, "failed");
    assert.match(result.error!, /model not found/);
  });
});

test("rpc: onStart exposes a steering handle", async () => {
  const script = rpcStub(`
    if (cmd.type === "steer" && cmd.message === "hello worker") { report("## steered"); settle(); }`, "setInterval(() => {}, 1000);");
  await withStub(script, async () => {
    const result = await runPiAgent({ cwd: process.cwd(), task: "t", timeoutMs: 20_000, onStart: (handle) => handle.steer("hello worker") });
    assert.equal(result.status, "success");
    assert.match(result.output, /steered/);
  });
});
