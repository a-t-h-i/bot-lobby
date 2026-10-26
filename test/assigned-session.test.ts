import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { assignedSessionFile, cleanupAssignedSession, openAssignedSession, sanitizeSession, type AssignedSession } from "../src/execution/assigned-session.ts";
import { buildPiArgs, runPiAgent } from "../src/execution/pi-runner.ts";

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

test("nonempty system content stops without erasing unrelated instructions", () => {
  const source = [header, entry("s", null, { type: "message", message: { ...system, content: "Preserve these instructions" } })].map(row => JSON.stringify(row)).join("\n");
  assert.throws(() => sanitizeSession(source), /unsupported nonempty system content/);
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

test("assigned native execution fails before model work when inventories cannot be inspected", async () => {
  const { assignment, cleanup } = fixture();
  try {
    let spawned = false;
    const result = await runPiAgent({ cwd: "/repo", task: "revision", assignedSession: assignment }, async () => { spawned = true; throw new Error("must not spawn"); });
    assert.equal(result.status, "failed");
    assert.match(result.error!, /declared and callable/);
    assert.equal(spawned, false);
    assert.ok(existsSync(assignedSessionFile(assignment)));
    const args = buildPiArgs({ cwd: "/repo", assignedSession: assignment });
    assert.equal(args[args.indexOf("--session") + 1], assignedSessionFile(assignment));
    assert.ok(!args.includes("--no-session"));
  } finally { cleanup(); }
});
