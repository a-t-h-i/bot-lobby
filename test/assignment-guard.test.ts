import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkAssignedCall, payloadToolNames, registerAssignmentGuard, type AssignmentGuardSpec } from "../src/pi/assignment-guard.ts";
import { prepareAssignmentDiscovery, readAssignmentDiscovery } from "../src/execution/assignment-discovery.ts";

type Handler = (event: Record<string, unknown>, ctx?: unknown) => unknown;

function fixture(tools = ["read", "edit", "grep", "codemode", "bash"]) {
  const taskDir = mkdtempSync(join(tmpdir(), "assignment-guard-"));
  const spec: AssignmentGuardSpec = {
    taskDir, assignmentId: "backend-1", revision: 1, tools, cwd: "/repo",
    files: [{ path: "/repo/src/a.ts", access: "edit" }, { path: "/repo/src/b.ts", access: "reference" }],
    verification: ["npm test"], attestation: join(taskDir, "attestation.json"),
  };
  return { spec, taskDir, cleanup: () => rmSync(taskDir, { recursive: true, force: true }) };
}

/** A pi stand-in: handlers by event, and an active set the guard can narrow. */
function fakePi(active: string[], all: { name: string; exposure?: string }[] = active.map((name) => ({ name }))) {
  const handlers = new Map<string, Handler>();
  let current = [...active];
  let aborted = false;
  const pi = {
    on: (name: string, handler: Handler) => { handlers.set(name, handler); },
    getActiveTools: () => current,
    setActiveTools: (names: string[]) => { current = names; },
    getAllTools: () => all,
  } as unknown as ExtensionAPI;
  const ctx = { abort: () => { aborted = true; } };
  return {
    pi,
    start: () => handlers.get("before_agent_start")!({}, ctx),
    call: (toolName: string, input: Record<string, unknown> = {}, parentToolCallId?: string) => handlers.get("tool_call")!({ type: "tool_call", toolCallId: "c", toolName, input, ...(parentToolCallId ? { parentToolCallId } : {}) }) as Promise<{ block?: boolean; reason?: string; terminate?: boolean } | undefined>,
    request: (payload: unknown) => handlers.get("before_provider_request")!({ type: "before_provider_request", payload }),
    widen: (names: string[]) => { current = names; },
    aborted: () => aborted,
  };
}

test("calls outside the selection are blocked, direct or nested, and finding a file does not let you edit it", () => {
  const { spec, cleanup } = fixture();
  try {
    assert.equal(checkAssignedCall(spec, "mcp__github__get_issue", {})?.["block" as never], true);
    assert.equal(checkAssignedCall(spec, "write", { path: "src/a.ts" })?.["block" as never], true, "write is not selected");
    assert.equal(checkAssignedCall(spec, "edit", { path: "src/a.ts" }), undefined);
    assert.match((checkAssignedCall(spec, "edit", { path: "src/b.ts" }) as { reason: string }).reason, /not an edit or create path/);
    assert.match((checkAssignedCall(spec, "edit", { path: "src/found.ts" }) as { reason: string }).reason, /does not let you edit/);
    assert.equal(checkAssignedCall(spec, "read", { path: "src/b.ts" }), undefined, "assigned reads are free");
    assert.deepEqual(checkAssignedCall(spec, "read", { path: "src/other.ts" }), { charge: 1 });
    assert.deepEqual(checkAssignedCall(spec, "grep", { pattern: "x" }), { charge: 1 });
    assert.equal(checkAssignedCall(spec, "bash", { command: "npm test" }), undefined, "shell is instruction-governed");
    assert.equal(checkAssignedCall(spec, "codemode", { code: "..." }), undefined, "the wrapper is free; its calls are charged one by one");
  } finally { cleanup(); }
});

test("each discovery call counts, concurrent nested ones too, and a retry keeps what was spent", async () => {
  const { spec, cleanup } = fixture();
  try {
    await prepareAssignmentDiscovery(spec.taskDir, spec.assignmentId, 1, 2);
    const first = fakePi(spec.tools);
    registerAssignmentGuard(first.pi, spec);
    // Three lookups from one codemode script, at once: two pass, the third is refused.
    const results = await Promise.all([first.call("grep", {}, "code"), first.call("read", { path: "src/x.ts" }, "code"), first.call("grep", {}, "code")]);
    assert.equal(results.filter((result) => result?.block).length, 1);
    assert.match(results.find((result) => result?.block)!.reason!, /allowance exhausted \(2\/2\).*discovery need/);
    assert.equal((await readAssignmentDiscovery(spec.taskDir, spec.assignmentId, 1)).consumed, 2);
    // Assigned files stay readable after the allowance is spent.
    assert.equal(await first.call("read", { path: "src/a.ts" }), undefined);
    // A retry is a new process with a new guard over the same ledger: nothing is refunded.
    const retry = fakePi(spec.tools);
    registerAssignmentGuard(retry.pi, spec);
    assert.equal((await retry.call("grep"))?.block, true);
  } finally { cleanup(); }
});

test("the guard reapplies the allowlist before a run, attests it, and filters provider requests", async () => {
  const { spec, cleanup } = fixture(["codemode", "read"]);
  try {
    await prepareAssignmentDiscovery(spec.taskDir, spec.assignmentId, 1, 2);
    const run = fakePi(["read", "codemode", "write", "mcp__docs__get"], [{ name: "read" }, { name: "codemode" }, { name: "write" }, { name: "mcp__docs__get", exposure: "codemode" }]);
    registerAssignmentGuard(run.pi, spec);
    run.start();
    const attestation = JSON.parse(readFileSync(spec.attestation, "utf8"));
    assert.deepEqual(attestation.declared, ["codemode", "read"]);
    assert.deepEqual(attestation.blockedCallable, ["mcp__docs__get"]);
    assert.equal(attestation.ok, true);
    assert.equal(run.aborted(), false);
    // codemode never reaches an unselected MCP tool.
    assert.equal((await run.call("mcp__docs__get", {}, "script"))?.block, true);
    const payload = { model: "m", tools: [{ name: "read" }, { name: "write" }, { type: "function", function: { name: "codemode" } }] };
    assert.deepEqual(payloadToolNames(run.request(payload)), ["read", "codemode"]);
    const clean = { tools: [{ name: "read" }] };
    assert.equal(run.request(clean), undefined);
  } finally { cleanup(); }
});

test("a declaration that survives reapplying stops the worker", async () => {
  const { spec, cleanup } = fixture(["read"]);
  try {
    const run = fakePi(["read", "write"]);
    // A runtime that ignores setActiveTools: the unauthorized declaration remains.
    (run.pi as unknown as { setActiveTools: () => void }).setActiveTools = () => {};
    registerAssignmentGuard(run.pi, spec);
    run.start();
    assert.equal(run.aborted(), true);
    assert.equal(JSON.parse(readFileSync(spec.attestation, "utf8")).ok, false);
    const blocked = await run.call("read", { path: "src/a.ts" });
    assert.equal(blocked?.block, true);
    assert.equal(blocked?.terminate, true);
    assert.throws(() => run.request({ tools: [] }), /stayed declared/);
  } finally { cleanup(); }
});
