import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { ASSIGNMENT_ENV } from "../src/pi/assignment-guard.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { WorkerAssignment } from "../src/execution/assignment.ts";
import { runAgent, type AgentRequest } from "../src/execution/agent-runner.ts";
import type { ProcessRunner } from "../src/execution/pi-runner.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/schemas/harness.ts";

function request(taskDir: string, tools: string[]): AgentRequest {
  const brief: WorkerAssignment = {
    id: "policy", revision: 1, objective: "Inspect package", actions: [{ step: 1, instruction: "Read package.json" }],
    files: [{ path: "package.json", access: "reference", purpose: "Package contract" }],
    tools: tools.map((name) => ({ name, purpose: "Assignment action" })),
    contracts: [], constraints: [], exclusions: [], verification: ["Report package"], evidence: [], completedWork: [], needs: [],
  };
  return { taskId: "policy-task", domain: "backend", role: "worker", instruction: "Inspect", context: { task: "Inspect" }, cwd: process.cwd(), assignment: { taskDir, brief } };
}

/** A worker process stand-in whose guard attests the allowlist it was handed. */
function attesting(seen: string[][]): ProcessRunner {
  return async (_args, options) => {
    const guard = JSON.parse(options.env![ASSIGNMENT_ENV]!);
    seen.push(guard.tools);
    writeFileSync(guard.attestation, JSON.stringify({ assignmentId: guard.assignmentId, revision: guard.revision, allowed: guard.tools, declared: guard.tools, blockedCallable: [], unauthorized: [], ok: true }));
    return { exitCode: 0, killed: false, stderr: "", stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop", usage: { input: 1, output: 1 } } }) };
  };
}

test("assigned preflight sees host-added tools before selection; the run gets exactly the selection", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "assignment-preflight-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const seen: string[][] = [];
  for (const selected of [[], ["codemode", "tool_search"], ["search_knowledge", "open_knowledge"]]) {
    const result = await runAgent(request(root, selected), attesting(seen));
    assert.equal(result.status, "success", result.error);
  }
  assert.deepEqual(seen, [[], ["codemode", "tool_search"], ["open_knowledge", "search_knowledge"]]);
  let spawns = 0;
  const runner: ProcessRunner = async () => { spawns++; throw new Error("must not spawn"); };
  const harness = await runAgent({ ...request(root, []), harness: { id: "codex", model: "", settings: DEFAULT_HARNESS_SETTINGS } }, runner);
  assert.match(harness.error!, /compatibility.*third-party harness/i);
  const unknown = await runAgent(request(root, ["unknown_assignment_tool"]), runner);
  assert.match(unknown.error!, /unknown tool unknown_assignment_tool/);
  const unavailable = await runAgent({ ...request(root, ["mcp__offline__get"]), mcpTools: ["mcp__offline__get"] }, runner);
  assert.match(unavailable.error!, /unavailable tool mcp__offline__get/);
  const resources = await runAgent({ ...request(root, ["read_mcp_resource"]) }, runner);
  assert.match(resources.error!, /ungranted tool read_mcp_resource/);
  assert.equal(spawns, 0);
});

test("unassigned agents retain the combined legacy grants rather than assignment replacement", async () => {
  const assigned = request("unused", []);
  const { assignment: _assignment, ...unassigned } = assigned;
  let selected = "";
  const result = await runAgent(unassigned, async (args) => {
    selected = args[args.indexOf("--tools") + 1]!;
    return { exitCode: 0, killed: false, stderr: "", stdout: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop", usage: { input: 1, output: 1 } } }) };
  });
  assert.equal(result.status, "success");
  for (const name of ["read", "write", "codemode", "tool_search", "search_knowledge"]) assert.ok(selected.split(",").includes(name), name);
});
