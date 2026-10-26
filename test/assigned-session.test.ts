import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { assignedSessionFile, cleanupAssignedSession, openAssignedSession, sanitizeSession, type AssignedSession } from "../src/execution/assigned-session.ts";
import { buildPiArgs, runPiAgent } from "../src/execution/pi-runner.ts";
import { ASSIGNMENT_ENV } from "../src/pi/assignment-guard.ts";

const header = { type: "session", version: 3, id: "session", cwd: "/repo" };
const system = { role: "system", content: "", sections: { tools: "old tools", cwd: "/repo" }, toolsAdded: [{ name: "write" }], toolsRemoved: [{ name: "read" }], timestamp: 1 };
const entry = (id: string, parentId: string | null, fields: object) => ({ id, parentId, timestamp: "now", ...fields });
function fixture() {
  const taskDir = mkdtempSync(join(tmpdir(), "assigned-session-test-"));
  const assignment: AssignedSession = { taskDir, assignmentId: "backend/one", revision: 1 };
  return { assignment, cleanup: () => rmSync(taskDir, { recursive: true, force: true }) };
}

test("sanitation preserves conversations, graph, summaries, accounting and retention pointers", () => {
  const rows = [header,
    entry("s", null, { type: "message", message: system }),
    entry("u", "s", { type: "message", message: { role: "user", content: "keep me" } }),
    entry("a", "u", { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "write", id: "call", arguments: {} }], usage: { input: 1 } } }),
    entry("t", "a", { type: "message", message: { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "history" }] } }),
    entry("c", "t", { type: "compaction", summary: "keep summary", firstKeptEntryId: "u", systemMessage: system, usage: { input: 2 } }),
    entry("b", "u", { type: "branch_summary", fromId: "c", summary: "branch" }),
  ];
  const clean = sanitizeSession(rows.map(row => JSON.stringify(row)).join("\n")).trim().split("\n").map(line => JSON.parse(line));
  for (const index of [0, 2, 3, 4, 6]) assert.deepEqual(clean[index], rows[index]);
  for (const message of [clean[1].message, clean[5].systemMessage]) {
    assert.equal(message.content, "");
    assert.deepEqual(message.sections, { cwd: "/repo" });
    assert.ok(!("toolsAdded" in message));
    assert.ok(!("toolsRemoved" in message));
  }
  assert.equal(clean[5].firstKeptEntryId, "u");
  assert.equal(clean[5].summary, "keep summary");
  assert.deepEqual(clean[5].usage, { input: 2 });
});

test("composed system text keeps its instructions and loses only its tool listing", () => {
  const content = "Preserve these instructions\n<tools>\n- write: old\n</tools>\nAnd these";
  const source = [header,
    entry("s", null, { type: "message", message: { ...system, content } }),
    entry("u", "s", { type: "message", message: { role: "user", content: "keep me" } }),
    entry("c", "u", { type: "compaction", summary: "kept", firstKeptEntryId: "u", tokensBefore: 9, systemMessage: { role: "system", content, toolsAdded: [{ name: "write" }], timestamp: 2 } }),
  ].map(row => JSON.stringify(row)).join("\n");
  const clean = sanitizeSession(source).trim().split("\n").map(line => JSON.parse(line));
  for (const message of [clean[1].message, clean[3].systemMessage]) {
    assert.equal(message.content, "Preserve these instructions\nAnd these");
    assert.equal(message.toolsAdded, undefined);
  }
  assert.equal(clean[2].message.content, "keep me");
});

test("system context edits cannot reintroduce undeclared system payloads", () => {
  const source = [header,
    entry("s", null, { type: "message", message: system }),
    entry("e", "s", { type: "context_edit", targetId: "s", replacement: { content: "undeclared tools" } }),
  ].map(row => JSON.stringify(row)).join("\n");
  assert.throws(() => sanitizeSession(source), /unsupported context edit/);
});

test("malformed, unsupported and broken retention sessions fail without repair", () => {
  for (const source of ["{", JSON.stringify({ ...header, version: 4 }), JSON.stringify(header) + "\n" + JSON.stringify(entry("c", null, { type: "compaction", firstKeptEntryId: "missing" })), JSON.stringify(header) + "\n" + JSON.stringify(entry("x", "x", { type: "usage" }))]) assert.throws(() => sanitizeSession(source), /recovery/);
});

test("revision recovery reuses isolated conversation, keeps allowance and excludes concurrent resume", () => {
  const { assignment, cleanup } = fixture();
  try {
    const first = openAssignedSession({ ...assignment, consumedDiscovery: 2 }, "/repo");
    const other = openAssignedSession({ ...assignment, assignmentId: "other" }, "/repo");
    assert.notEqual(first.file, other.file);
    other.release();
    assert.throws(() => openAssignedSession(assignment, "/repo"), /locked/);
    first.release();
    assert.throws(() => openAssignedSession(assignment, "/different-project"), /project scope changed/);
    const resumed = openAssignedSession({ ...assignment, revision: 2, consumedDiscovery: 0, evidence: ["evidence"] }, "/repo");
    assert.equal(resumed.file, first.file);
    first.release();
    assert.throws(() => openAssignedSession(assignment, "/repo"), /locked/);
    assert.throws(() => first.save(), /after releasing/);
    assert.equal(resumed.state.consumedDiscovery, 2);
    assert.equal(resumed.state.revision, 2);
    assert.deepEqual(resumed.state.evidence, ["evidence"]);
    resumed.release();
    assert.throws(() => openAssignedSession(assignment, "/repo"), /superseded/);
  } finally { cleanup(); }
});

test("missing/corrupt recovery never falls back; interrupted rewrite preserves original", () => {
  const { assignment, cleanup } = fixture();
  try {
    const session = openAssignedSession(assignment, "/repo");
    session.release();
    const before = readFileSync(session.file, "utf8");
    writeFileSync(`${session.file}.rewrite`, "interrupted");
    const resumed = openAssignedSession(assignment, "/repo");
    resumed.release();
    assert.equal(readFileSync(session.file, "utf8"), before);
    writeFileSync(session.file, "corrupt");
    assert.throws(() => openAssignedSession(assignment, "/repo"), /malformed/);
    assert.equal(readFileSync(session.file, "utf8"), "corrupt");
    rmSync(session.file);
    assert.throws(() => openAssignedSession(assignment, "/repo"), /missing/);
  } finally { cleanup(); }
});

test("terminal deletion retries from tombstone and removes temporary conversation bodies", () => {
  const { assignment, cleanup } = fixture();
  try {
    const session = openAssignedSession(assignment, "/repo");
    session.state.terminal = true;
    session.save();
    session.release();
    writeFileSync(`${session.file}.rewrite`, "temporary body");
    cleanupAssignedSession(assignment, "/repo");
    cleanupAssignedSession(assignment, "/repo");
    assert.ok(!existsSync(session.file));
    assert.ok(!existsSync(`${session.file}.rewrite`));
    assert.equal(JSON.parse(readFileSync(join(dirname(session.file), "state.json"), "utf8")).terminal, true);
    assert.throws(() => openAssignedSession(assignment, "/repo"), /terminal/);
  } finally { cleanup(); }
});

test("process death retains conversation and permits serialized demonstrated-death recovery", () => {
  const { assignment, cleanup } = fixture();
  try {
    const module = new URL("../src/execution/assigned-session.ts", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import {openAssignedSession} from ${JSON.stringify(module)}; openAssignedSession(${JSON.stringify(assignment)}, '/repo'); process.exit(1);`], { timeout: 10000 });
    assert.equal(child.status, 1);
    const file = assignedSessionFile(assignment);
    assert.ok(existsSync(file));
    const before = readFileSync(file, "utf8");
    const resumed = openAssignedSession({ ...assignment, revision: 2 }, "/repo");
    assert.equal(readFileSync(file, "utf8"), before);
    assert.throws(() => openAssignedSession({ ...assignment, revision: 2 }, "/repo"), /locked/);
    resumed.release();
  } finally { cleanup(); }
});

test("assigned argv preserves exact tool selection without implicit MCP resources or defaults", () => {
  const assignedSession = { taskDir: "/task", assignmentId: "tools", revision: 1 };
  const options = { cwd: "/repo", assignedSession, mcpTools: ["mcp__docs__get"] };
  const empty = buildPiArgs({ ...options, tools: [] });
  assert.ok(empty.includes("--no-tools"));
  assert.ok(empty.includes("--no-mcp"));
  assert.ok(!empty.includes("--tools"));
  const selected = buildPiArgs({ ...options, tools: ["read", "mcp__docs__get", "read"] });
  assert.equal(selected[selected.indexOf("--tools") + 1], "mcp__docs__get,read");
  assert.ok(!selected.includes("--no-mcp"));
  const resource = buildPiArgs({ ...options, tools: ["read_mcp_resource"] });
  assert.equal(resource[resource.indexOf("--tools") + 1], "read_mcp_resource");
  assert.ok(!resource.includes("--no-mcp"));
});

test("an assigned run holds its conversation lock, carries the guard and needs the guard's attestation", async () => {
  const { assignment, cleanup } = fixture();
  try {
    const guarded = { ...assignment, files: [{ path: "src/a.ts", access: "edit" as const }], verification: ["npm test"] };
    let seen: { args: string[]; env: Record<string, string> } | undefined;
    const reply = JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", usage: { input: 1, output: 1, cost: { total: 0 } } } });
    const runner = (attest: boolean) => async (args: string[], options: { env?: Record<string, string> }) => {
      seen = { args, env: options.env ?? {} };
      // The conversation is locked while the worker runs.
      assert.throws(() => openAssignedSession(guarded, "/repo"), /locked/);
      const guard = JSON.parse(options.env![ASSIGNMENT_ENV]!);
      if (attest) writeFileSync(guard.attestation, JSON.stringify({ assignmentId: guard.assignmentId, revision: guard.revision, allowed: guard.tools, declared: guard.tools, blockedCallable: [], unauthorized: [], ok: true }));
      return { exitCode: 0, stdout: reply, stderr: "", killed: false };
    };
    const grants = { tools: ["read", "bash", "edit", "write", "grep", "find", "ls"], assignedTools: ["read", "edit", "read"] };
    const unattested = await runPiAgent({ cwd: "/repo", task: "go", ...grants, assignedSession: guarded }, runner(false));
    assert.equal(unattested.status, "failed");
    assert.match(unattested.error!, /never attested/);
    const attested = await runPiAgent({ cwd: "/repo", task: "go", ...grants, assignedSession: guarded }, runner(true));
    assert.equal(attested.status, "success", attested.error);
    const guard = JSON.parse(seen!.env[ASSIGNMENT_ENV]!);
    // Replacement allowlist: the host's codemode, tool_search, delegation and expert stay out; the file desk's
    // claim/handover protocol comes with a selected edit.
    const expected = ["claim_file", "edit", "handover_file", "my_files", "read", "wait_for_files"];
    assert.deepEqual(guard.tools, expected);
    assert.deepEqual(guard.files, [{ path: "/repo/src/a.ts", access: "edit" }]);
    assert.deepEqual(JSON.parse(seen!.env.BOT_LOBBY_AGENT_POLICY!).tools, expected);
    assert.equal(seen!.args[seen!.args.indexOf("--tools") + 1], expected.join(","));
    assert.ok(seen!.args.includes("--no-mcp"));
    assert.equal(seen!.args[seen!.args.indexOf("--session") + 1], assignedSessionFile(assignment));
    // Released afterwards: the next revision resumes the same conversation.
    openAssignedSession({ ...guarded, revision: 2 }, "/repo").release();
  } finally { cleanup(); }
});

test("assigned execution on a third-party harness is refused before any process starts", async () => {
  const { assignment, cleanup } = fixture();
  try {
    let spawned = false;
    const result = await runPiAgent({ cwd: "/repo", task: "go", assignedSession: assignment, harness: { kind: "codex" } as never }, async () => { spawned = true; throw new Error("must not spawn"); });
    assert.equal(result.status, "failed");
    assert.match(result.error!, /third-party harness/);
    assert.equal(spawned, false);
  } finally { cleanup(); }
});

test("a corrupt task conversation is a recovery issue, never a fresh start", async () => {
  const { assignment, cleanup } = fixture();
  try {
    openAssignedSession(assignment, "/repo").release();
    writeFileSync(assignedSessionFile(assignment), "{not json\n");
    let spawned = false;
    const result = await runPiAgent({ cwd: "/repo", task: "go", assignedSession: { ...assignment, revision: 2 } }, async () => { spawned = true; throw new Error("must not spawn"); });
    assert.equal(result.status, "failed");
    assert.match(result.error!, /malformed JSONL/);
    assert.equal(spawned, false);
  } finally { cleanup(); }
});
