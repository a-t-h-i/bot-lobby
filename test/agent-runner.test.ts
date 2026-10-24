import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runAgent, runParallel, cancelAllRuns, type AgentRequest } from "../src/execution/agent-runner.ts";
import { KNOWLEDGE_TOOLS } from "../src/knowledge/catalog-tools.ts";
import { invariantPrefix } from "../src/prompts/compiler.ts";
import type { ProcessOutcome, ProcessRunner } from "../src/execution/pi-runner.ts";
import type { AgentRun } from "../src/schemas/findings.ts";

function reply(text: string): string {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 1, output: 1 } },
  });
}

function ok(stdout: string): ProcessOutcome {
  return { exitCode: 0, stdout, stderr: "", killed: false };
}

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    taskId: "TASK-1",
    domain: "backend",
    role: "scout",
    instruction: "Inspect the API layer",
    context: { task: "Add pagination" },
    cwd: "/proj",
    ...overrides,
  };
}

test("an agent has no time limit: no deadline reaches the process, and a retry is never cut short", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const req = request({ retries: 1 });
  const run = await runAgent(req, async (_args, options) => {
    seen.push(options as unknown as Record<string, unknown>);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { exitCode: 1, stdout: "", stderr: "crashed", killed: false };
  });
  assert.equal(seen.length, 2);
  for (const options of seen) for (const key of ["timeoutMs", "time", "wrapUpAtMs", "graceMs"]) assert.equal(key in options, false, `${key} is gone`);
  assert.equal(run.status, "failed");
  for (const key of ["endsAt", "allotMs", "timeUp", "extendedMs"]) assert.equal(key in run, false, `${key} is gone`);
});

test("exceptions emit a terminal update and release the working row", async () => {
  const seen: string[] = [];
  const final = await runAgent(request({ onUpdate: (run) => seen.push(run.status) }), async () => { throw new Error("spawn failed"); });
  assert.equal(final.status, "failed");
  assert.deepEqual(seen, ["running", "failed"]);
});

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
  assert.equal(tools, "read,grep,find,ls,search_knowledge,open_knowledge,list_bookmarks,codemode,tool_search");
  assert.ok(run.finishedAt);
});

test("workers get the full built-in tool set plus any extra tools", async () => {
  const capture: ProcessRunner = async (args) => ok(reply(args[args.indexOf("--tools") + 1]!));
  const run = await runAgent(request({ role: "worker" }), capture);
  assert.equal(run.output, "read,bash,edit,write,grep,find,ls,search_knowledge,open_knowledge,list_bookmarks,codemode,tool_search,delegate_subtasks,ask_expert,claim_file,handover_file,my_files,wait_for_files");
  const desk = await runAgent(request({ role: "worker", extraTools: ["claim_file"] }), capture);
  assert.equal(desk.output, "read,bash,edit,write,grep,find,ls,claim_file,search_knowledge,open_knowledge,list_bookmarks,codemode,tool_search,delegate_subtasks,ask_expert,handover_file,my_files,wait_for_files");
});

test("authorized repository roles keep identical knowledge tools with empty or populated context", async () => {
  const capture: ProcessRunner = async (args) => ok(reply(args[args.indexOf("--tools") + 1]!));
  for (const role of ["scout", "worker", "reviewer"] as const) {
    const empty = await runAgent(request({ role }), capture);
    const populated = await runAgent(request({ role, context: {
      task: "Add pagination", knowledge: "Finding", standards: "Standard", decisions: "Decision", bookmarks: "K-ref",
    } }), capture);
    assert.equal(empty.status, "success");
    assert.equal(populated.status, "success");
    assert.equal(empty.output, populated.output, role);
    for (const tool of KNOWLEDGE_TOOLS) assert.ok(empty.output.split(",").includes(tool), `${role}: ${tool}`);
  }
});

test("bookmarks never grant denied roles or whole-prompt overrides knowledge tools", async () => {
  const capture: ProcessRunner = async (args) => ok(reply(args[args.indexOf("--tools") + 1]!));
  for (const overrides of [{ role: "researcher" as const }, { systemPrompt: "Verbatim override." }, { systemPrompt: "" }]) {
    for (const context of [{ task: "Inspect" }, { task: "Inspect", bookmarks: "K-ref", knowledge: "Finding", standards: "Standard", decisions: "Decision" }]) {
      const run = await runAgent(request({ ...overrides, context }), capture);
      assert.equal(run.status, "success");
      for (const tool of KNOWLEDGE_TOOLS) assert.ok(!run.output.split(",").includes(tool), tool);
    }
  }
  const explicit = await runAgent(request({ role: "researcher", systemPrompt: "Custom", extraTools: ["open_knowledge", "custom_read"] }), capture);
  assert.equal(explicit.status, "success");
  assert.ok(explicit.output.split(",").includes("open_knowledge"));
  assert.ok(explicit.output.split(",").includes("custom_read"));
  assert.ok(!explicit.output.split(",").includes("search_knowledge"));
});

test("an explicit systemPrompt override reaches pi verbatim, not the compiled prompt", async () => {
  const capture: ProcessRunner = async (args) => {
    const file = args[args.indexOf("--append-system-prompt") + 1]!;
    return ok(reply(readFileSync(file, "utf8")));
  };
  const run = await runAgent(request({ systemPrompt: "Verbatim override." }), capture);
  assert.equal(run.status, "success");
  assert.ok(run.output!.startsWith("Verbatim override."), `got: ${run.output!.slice(0, 80)}`);
  assert.ok(!run.output!.includes("Global Engineering Agent"), "override replaces the compiled prompt");
});

test("the compiled system prompt starts with the role's invariant prefix, contract before task context", async () => {
  const capture: ProcessRunner = async (args) => {
    const file = args[args.indexOf("--append-system-prompt") + 1]!;
    return ok(reply(readFileSync(file, "utf8")));
  };
  const run = await runAgent(request({ role: "worker", context: { task: "Implement it" } }), capture);
  assert.equal(run.status, "success");
  const prompt = run.output!;
  assert.ok(prompt.startsWith(invariantPrefix("backend", "worker")));
  assert.ok(prompt.indexOf("### Output contract") < prompt.indexOf("Implement it"));
});

test("runAgent reports a failed run without throwing", async () => {
  const failing: ProcessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom", killed: false });
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
      options.signal?.addEventListener("abort", () => resolve({ exitCode: 0, stdout: "", stderr: "", killed: true }));
    });
  const pending = runAgent(request(), hanging);
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
