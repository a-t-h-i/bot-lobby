import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_ENV, DELEGATION_ENV, reserveChildren, type AgentPolicy } from "../src/execution/delegation.ts";
import { runPiAgent, type ProcessOutcome, type ProcessRunner } from "../src/execution/pi-runner.ts";
import { createDeskClient } from "../src/desk/ipc.ts";
import { DESK_ENV } from "../src/desk/session.ts";
import { allowedAgentTool } from "../src/pi/delegation.ts";
import { dataRoot } from "../src/state/project.ts";
import type { AgentRun } from "../src/schemas/findings.ts";
import { normalizeMcpTools } from "../src/schemas/configuration.ts";
import { registerAgentPermissions } from "../src/pi/delegation.ts";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { runAgent } from "../src/execution/agent-runner.ts";

const reply = (text: string): ProcessOutcome => ({ exitCode: 0, killed: false, timedOut: false, stderr: "", stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], usage: { input: 10, output: 5, cost: { total: 0.01 } } } }) });

test("five lifetime slots are atomic, invalid requests consume none, failures do not refund slots", () => {
  const quota = { used: 0 };
  assert.throws(() => reserveChildren(quota, [""]), /non-empty/);
  assert.equal(quota.used, 0);
  reserveChildren(quota, ["a", "b", "c"]);
  assert.throws(() => reserveChildren(quota, ["d", "e", "f"]), /Only 2/);
  assert.equal(quota.used, 3);
  reserveChildren(quota, ["d", "e"]);
  assert.throws(() => reserveChildren(quota, ["f"]), /Only 0/);
});

test("direct and codemode calls obey exact grants, read-only roles and nesting limits", () => {
  const policy: AgentPolicy = { tools: ["read", "codemode", "delegate_subtasks"], mcpTools: ["mcp__github__get_issue"], readOnly: true, depth: 1 };
  assert.equal(allowedAgentTool(policy, "read"), true);
  assert.equal(allowedAgentTool(policy, "write"), false);
  assert.equal(allowedAgentTool(policy, "orchestrate"), false);
  assert.equal(allowedAgentTool(policy, "mcp__github__get_issue", true), true);
  assert.equal(allowedAgentTool(policy, "mcp__github__get_issue"), false);
  assert.equal(allowedAgentTool(policy, "mcp__github__get_issue", true, true), false);
  assert.equal(allowedAgentTool(policy, "mcp__github__delete_issue", false), false);
  assert.equal(allowedAgentTool({ ...policy, depth: 2 }, "delegate_subtasks"), false);
  assert.deepEqual(normalizeMcpTools(["mcp__github__get_issue", "write", "mcp__github__*", "mcp__github__get_issue"]), ["mcp__github__get_issue"]);
});

test("the permission hook blocks nested writes, hidden and unknown tools and unscoped resources", () => {
  const before = process.env[AGENT_ENV];
  process.env[AGENT_ENV] = JSON.stringify({ tools: ["read", "codemode"], mcpTools: ["mcp__github__get_issue"], readOnly: true, depth: 1 });
  let check!: (event: ToolCallEvent) => { block: boolean } | undefined;
  try {
    registerAgentPermissions({
      on: (_name: string, handler: typeof check) => { check = handler; },
      getAllTools: () => [
        { name: "read" }, { name: "write" }, { name: "codemode" },
        { name: "mcp__github__get_issue", annotations: { readOnlyHint: true } },
        { name: "mcp__github__hidden", exposure: "hidden" },
        { name: "read_mcp_resource" },
      ],
    } as unknown as ExtensionAPI);
    const call = (toolName: string, input = {}) => check({ type: "tool_call", toolCallId: "nested", parentToolCallId: "code", toolName, input } as ToolCallEvent);
    assert.equal(call("read"), undefined);
    assert.equal(call("mcp__github__get_issue"), undefined);
    assert.equal(call("write")?.block, true);
    assert.equal(call("mcp__github__hidden")?.block, true);
    assert.equal(call("missing")?.block, true);
    assert.equal(call("read_mcp_resource")?.block, true);
    assert.equal(call("read_mcp_resource", { server: "other" })?.block, true);
    assert.equal(call("read_mcp_resource", { server: "github" }), undefined);
  } finally {
    if (before === undefined) delete process.env[AGENT_ENV]; else process.env[AGENT_ENV] = before;
  }
});

test("children inherit permissions, share a desk, report separately, and cannot delegate", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bl-children-"));
  mkdirSync(join(cwd, ".pi"));
  const updates: AgentRun[] = [];
  let active = 0;
  let maximum = 0;
  const identities = new Set<string>();
  let deskAddress: string | undefined;
  const run: ProcessRunner = async (_args, options) => {
    const policy = JSON.parse(options.env![AGENT_ENV]!) as AgentPolicy;
    if (policy.depth === 2) {
      assert.equal(options.env![DELEGATION_ENV], "");
      assert.equal(policy.tools.includes("delegate_subtasks"), false);
      assert.deepEqual(policy.mcpTools, ["mcp__github__get_issue"]);
      assert.ok(options.timeoutMs <= 30_000);
      assert.equal(options.env![DESK_ENV.address], deskAddress);
      identities.add(options.env![DESK_ENV.worker]!);
      active += 1;
      maximum = Math.max(maximum, active);
      options.onEvent?.({ type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } });
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return reply("Verified child report");
    }
    deskAddress = options.env![DESK_ENV.address];
    const target = JSON.parse(options.env![DELEGATION_ENV]!);
    const client = createDeskClient(target.address, target.token);
    try {
      const invalid = await client.request({ op: "delegate", briefs: [""] });
      assert.equal(invalid.ok, false);
      const answer = await client.request({ op: "delegate", briefs: ["a", "b", "c", "d", "e"] }, 30_000);
      assert.equal(answer.ok, true, answer.text);
      const children = JSON.parse(answer.text) as AgentRun[];
      assert.equal(children.length, 5);
      assert.equal((await client.request({ op: "delegate", briefs: ["f"] })).ok, false);
      return reply("Integrated parent report");
    } finally { client.close(); }
  };
  try {
    const result = await runPiAgent({ cwd, task: "Step 6: large feature", tools: ["read", "edit", "write"], timeoutMs: 30_000, mcpTools: ["mcp__github__get_issue"], agent: { runId: "parent", taskId: "TASK-1", domain: "backend", role: "worker" }, onChildRun: (child) => updates.push(child) }, run);
    assert.equal(result.status, "success");
    assert.equal(result.usage.input, 10, "parent usage excludes separately recorded child usage");
    assert.equal(result.children?.length, 5);
    assert.ok(maximum <= 3);
    assert.equal(identities.size, 5);
    assert.equal(updates.filter((child) => child.status === "success").length, 5);
    assert.ok(updates.every((child) => child.parentRunId === "parent" && child.stepInstruction === "Step 6: large feature"));
    const folder = join(dataRoot(cwd, ".pi"), "delegations");
    assert.equal(readdirSync(folder).length, 5);
    assert.match(readFileSync(join(folder, readdirSync(folder)[0]!), "utf8"), /Verified child report/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("a parent that exits with children outstanding cancels and waits for them", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bl-child-cancel-"));
  mkdirSync(join(cwd, ".pi"));
  let cancelled = false;
  let client: ReturnType<typeof createDeskClient> | undefined;
  let started!: () => void;
  const childStarted = new Promise<void>((resolve) => { started = resolve; });
  const run: ProcessRunner = async (_args, options) => {
    const policy = JSON.parse(options.env![AGENT_ENV]!) as AgentPolicy;
    if (policy.depth === 2) {
      started();
      return new Promise((resolve) => {
        options.signal!.addEventListener("abort", () => { cancelled = true; resolve({ ...reply(""), killed: true }); }, { once: true });
      });
    }
    const target = JSON.parse(options.env![DELEGATION_ENV]!);
    client = createDeskClient(target.address, target.token);
    void client.request({ op: "delegate", briefs: ["long task"] });
    await childStarted;
    return reply("Parent stopped");
  };
  try {
    const result = await runPiAgent({ cwd, task: "t", tools: ["read"], timeoutMs: 30_000 }, run);
    assert.equal(cancelled, true);
    assert.equal(result.children?.[0]?.status, "cancelled");
  } finally { client?.close(); rmSync(cwd, { recursive: true, force: true }); }
});

test("a retry shares its five child slots and a time grant resets an expired deadline", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bl-child-retry-"));
  mkdirSync(join(cwd, ".pi"));
  let attempts = 0;
  const run: ProcessRunner = async (_args, options) => {
    const policy = JSON.parse(options.env![AGENT_ENV]!) as AgentPolicy;
    if (policy.depth === 2) return reply("Child done");
    attempts += 1;
    const target = JSON.parse(options.env![DELEGATION_ENV]!);
    const client = createDeskClient(target.address, target.token);
    try {
      const briefs = attempts === 1 ? ["a", "b", "c"] : ["d", "e"];
      assert.equal((await client.request({ op: "delegate", briefs })).ok, true);
      if (attempts === 2) assert.equal((await client.request({ op: "delegate", briefs: ["sixth"] })).ok, false);
      return attempts === 1 ? { ...reply(""), exitCode: 1, stderr: "Retry me" } : reply("Integrated");
    } finally { client.close(); }
  };
  try {
    const request = { taskId: "TASK-retry", domain: "backend" as const, role: "scout" as const, instruction: "Inspect", context: { task: "Inspect" }, cwd, timeoutMs: 30_000, retries: 1 };
    assert.equal((await runAgent(request, run)).status, "success");
    assert.equal(attempts, 2);
    const extended: ProcessRunner = async (_args, options) => {
      const policy = JSON.parse(options.env![AGENT_ENV]!) as AgentPolicy;
      if (policy.depth === 2) return reply("Child after grant");
      await new Promise((resolve) => setTimeout(resolve, 30));
      options.onEvent?.({ type: "extended", ms: 30_000 });
      const target = JSON.parse(options.env![DELEGATION_ENV]!);
      const client = createDeskClient(target.address, target.token);
      try { assert.equal((await client.request({ op: "delegate", briefs: ["New time"] })).ok, true); }
      finally { client.close(); }
      return reply("Done after grant");
    };
    assert.equal((await runPiAgent({ cwd, task: "t", tools: ["read"], timeoutMs: 30_000, time: { upAtMs: 10, upMessage: "Stop", graceMs: 0 } }, extended)).children?.[0]?.status, "success");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
