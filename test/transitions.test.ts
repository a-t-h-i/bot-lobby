import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, nextStates, assertTransition } from "../src/workflow/transitions.ts";

test("valid workflow transitions are allowed", () => {
  const valid: Array<[string, string]> = [
    ["created", "clarifying"],
    ["clarifying", "scouting"],
    ["clarifying", "awaiting_approval"],
    ["scouting", "synthesizing"],
    ["synthesizing", "awaiting_approval"],
    ["awaiting_approval", "planning"],
    ["awaiting_approval", "abandoned"],
    ["planning", "implementing"],
    ["implementing", "reviewing"],
    ["implementing", "blocked"],
    ["reviewing", "implementing"],
    ["reviewing", "completed"],
    ["blocked", "implementing"],
    ["blocked", "abandoned"],
  ];
  for (const [from, to] of valid) {
    assert.ok(canTransition(from as never, to as never), `${from} -> ${to} should be valid`);
  }
});

test("invalid workflow transitions are rejected", () => {
  const invalid: Array<[string, string]> = [
    ["created", "implementing"],
    ["created", "completed"],
    ["clarifying", "implementing"],
    ["planning", "reviewing"],
    ["planning", "completed"],
    ["implementing", "completed"],
    ["reviewing", "planning"],
    ["completed", "implementing"],
    ["abandoned", "created"],
    ["blocked", "completed"],
  ];
  for (const [from, to] of invalid) {
    assert.ok(!canTransition(from as never, to as never), `${from} -> ${to} should be invalid`);
  }
});

test("terminal states have no outgoing transitions", () => {
  assert.deepEqual(nextStates("completed"), []);
  assert.deepEqual(nextStates("abandoned"), []);
});

test("abandon is allowed from every non-terminal state", () => {
  for (const state of [
    "created", "clarifying", "scouting", "synthesizing", "awaiting_approval",
    "planning", "implementing", "reviewing", "blocked",
  ]) {
    assert.ok(canTransition(state as never, "abandoned"), `${state} -> abandoned should be valid`);
  }
  assert.ok(!canTransition("completed", "abandoned"));
  assert.ok(!canTransition("abandoned", "abandoned"));
});

test("assertTransition throws on illegal move", () => {
  assert.throws(() => assertTransition("completed", "implementing"), /Invalid state transition/);
  assertTransition("created", "clarifying");
});
