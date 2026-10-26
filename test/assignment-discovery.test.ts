import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { approveAssignmentDiscovery, authorizeAssignmentCalls, consumeAssignmentDiscovery, prepareAssignmentDiscovery } from "../src/execution/assignment-discovery.ts";

test("concurrent direct and nested lookups share one persistent allowance; retries/revisions never replenish", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "assignment-discovery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await prepareAssignmentDiscovery(root, "worker", 1);
  const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => authorizeAssignmentCalls(root, "worker", 1, ["codemode", "find"], [{ name: "codemode", children: [{ name: "find" }] }])));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 2);
  assert.equal((await prepareAssignmentDiscovery(root, "worker", 1)).consumed, 2);
  assert.equal((await prepareAssignmentDiscovery(root, "worker", 2)).consumed, 2);
  await assert.rejects(consumeAssignmentDiscovery(root, "worker", 1), /stale revision/);
  await assert.rejects(consumeAssignmentDiscovery(root, "worker", 2), /allowance exhausted/);
  const file = readdirSync(join(root, "assignment-discovery")).find((name) => name.endsWith(".json"))!;
  assert.equal(JSON.parse(readFileSync(join(root, "assignment-discovery", file), "utf8")).consumed, 2);
});

test("only an explicit idempotent master decision raises the persisted total", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "assignment-approval-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(prepareAssignmentDiscovery(root, "worker", 1, 5), /explicit master allowance decision/);
  await prepareAssignmentDiscovery(root, "worker", 1);
  await consumeAssignmentDiscovery(root, "worker", 1, 2);
  await assert.rejects(prepareAssignmentDiscovery(root, "worker", 2, 3), /explicit master allowance decision/);
  const decision = { decisionId: "D-1", reason: "Inspect an additional caller", limit: 3 };
  await approveAssignmentDiscovery(root, "worker", 1, decision);
  await approveAssignmentDiscovery(root, "worker", 1, decision);
  await assert.rejects(approveAssignmentDiscovery(root, "worker", 1, { ...decision, limit: 4 }), /different allowance/);
  assert.equal((await prepareAssignmentDiscovery(root, "worker", 2, 3)).consumed, 2);
  assert.equal((await consumeAssignmentDiscovery(root, "worker", 2)).consumed, 3);
});

test("whole batches authorize before consumption, exempt trusted assigned work, and fail closed on corrupt recovery", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "assignment-batch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await prepareAssignmentDiscovery(root, "worker", 1);
  assert.throws(() => authorizeAssignmentCalls(root, "worker", 1, ["find", "codemode"], [{ name: "find" }, { name: "codemode", children: [{ name: "write" }] }]), /unselected call/);
  assert.equal((await authorizeAssignmentCalls(root, "worker", 1, ["read", "bash"], [{ name: "read", purpose: "assigned-read" }, { name: "bash", purpose: "assigned-verification" }])).consumed, 0);
  await assert.rejects(consumeAssignmentDiscovery(root, "worker", 1, 3), /allowance exhausted/);
  assert.equal((await prepareAssignmentDiscovery(root, "worker", 1)).consumed, 0);
  const file = readdirSync(join(root, "assignment-discovery")).find((name) => name.endsWith(".json"))!;
  writeFileSync(join(root, "assignment-discovery", file), "malformed");
  await assert.rejects(prepareAssignmentDiscovery(root, "worker", 1), /cannot recover ledger.*do not reset consumption/);
});
