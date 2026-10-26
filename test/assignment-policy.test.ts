import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentCallDiscovery, selectAssignmentTools } from "../src/execution/assignment-policy.ts";

const inventory = {
  known: ["read", "find", "codemode", "tool_search", "ask_expert", "search_knowledge", "claim_file", "mcp__docs__get", "mcp__offline__get", "read_mcp_resource"],
  granted: ["read", "find", "codemode", "tool_search", "ask_expert", "search_knowledge", "claim_file", "mcp__docs__get", "mcp__offline__get"],
  available: ["read", "find", "codemode", "tool_search", "ask_expert", "search_knowledge", "claim_file", "mcp__docs__get", "read_mcp_resource"],
};
const tools = (...names: string[]) => ({ tools: names.map((name) => ({ name, purpose: "Assignment action" })) });

test("assignment replacement is sorted and deduplicated after all tool families combine; empty means zero", () => {
  assert.deepEqual(selectAssignmentTools(tools("claim_file", "read", "ask_expert", "read", "search_knowledge", "mcp__docs__get"), inventory), ["ask_expert", "claim_file", "mcp__docs__get", "read", "search_knowledge"]);
  assert.deepEqual(selectAssignmentTools(tools(), inventory), []);
  assert.throws(() => selectAssignmentTools(tools("typo"), inventory), /unknown tool typo/);
  assert.throws(() => selectAssignmentTools(tools("read_mcp_resource"), inventory), /ungranted tool read_mcp_resource/);
  assert.throws(() => selectAssignmentTools(tools("mcp__offline__get"), inventory), /unavailable tool mcp__offline__get/);
});

test("MCP resource grants are explicit, separate from codemode and server tools", () => {
  assert.throws(() => selectAssignmentTools(tools("codemode", "mcp__docs__get", "read_mcp_resource"), inventory), /ungranted/);
  assert.deepEqual(selectAssignmentTools(tools("read_mcp_resource"), { ...inventory, granted: [...inventory.granted, "read_mcp_resource"] }), ["read_mcp_resource"]);
  assert.throws(() => assignmentCallDiscovery(["codemode"], [{ name: "codemode", children: [{ name: "mcp__docs__get" }] }]), /unselected call mcp__docs__get/);
});

test("direct, discovered and deeply nested calls require exact selections before counting a batch", () => {
  const selected = ["codemode", "tool_search", "find", "read", "bash"];
  assert.equal(assignmentCallDiscovery(selected, [{ name: "tool_search" }, { name: "codemode", children: [{ name: "codemode", children: [{ name: "find" }, { name: "bash", purpose: "discovery" }] }] }]), 3);
  assert.equal(assignmentCallDiscovery(selected, [{ name: "read", purpose: "assigned-read" }, { name: "bash", purpose: "assigned-verification" }]), 0);
  assert.throws(() => assignmentCallDiscovery(selected, [{ name: "tool_search" }, { name: "codemode", children: [{ name: "write" }] }]), /unselected call write/);
  assert.throws(() => assignmentCallDiscovery([], [{ name: "read" }]), /unselected call/);
});
