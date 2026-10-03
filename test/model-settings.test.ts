import { test } from "node:test";
import assert from "node:assert/strict";
import { patchEntry, prefillModels } from "../src/pi/model-settings.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";

test("patchEntry never stores a thinking level on scouts", () => {
  const next = patchEntry(DEFAULT_CONFIG, "scout", { model: "p/fast", thinking: "max" });
  assert.deepEqual(next.scout, { model: "p/fast", timeoutMs: DEFAULT_CONFIG.scout.timeoutMs });
  assert.equal(patchEntry(DEFAULT_CONFIG, "researcher", { thinking: "high" }).researcher.thinking, "high");
  assert.equal(DEFAULT_CONFIG.researcher.thinking, "low", "the input is not mutated");
});

test("prefillModels pins every unset subagent model to the session model and leaves set ones", () => {
  const config = resolveConfig({ agents: { qa: { model: "p/qa" } } });
  const { config: next, filled } = prefillModels(config, "p/session");
  assert.deepEqual(filled, ["designer", "backend", "scout", "researcher", "quickfix", "planner"]);
  assert.equal(next.agents.qa.model, "p/qa");
  assert.equal(next.quickFix.model, "p/session");
  assert.equal(next.planner.model, "p/session");
  assert.equal(next.agents.designer.model, "p/session");
  assert.equal(next.scout.model, "p/session");
  assert.equal(next.master.model, "inherit", "the master is the session itself");
  assert.deepEqual(prefillModels(config, undefined).filled, []);
});

test("quick fix and planner keep their own entries, and an unknown thinking level falls back", () => {
  const config = resolveConfig({ quickFix: { model: "p/fast", thinking: "bogus" }, planner: { thinking: "xhigh" } });
  assert.equal(config.quickFix.model, "p/fast");
  assert.equal(config.quickFix.thinking, DEFAULT_CONFIG.quickFix.thinking);
  assert.equal(config.planner.thinking, "xhigh");
  const patched = patchEntry(DEFAULT_CONFIG, "quickfix", { model: "p/q", instructions: "tiny diffs" });
  assert.equal(patched.quickFix.model, "p/q");
  assert.equal(patched.quickFix.instructions, "tiny diffs");
  assert.equal(patchEntry(DEFAULT_CONFIG, "planner", { thinking: "max" }).planner.thinking, "max");
});

test("the planning panel keeps known seats in order and drops the rest", () => {
  assert.deepEqual(DEFAULT_CONFIG.lobby.planningPanel, ["backend", "designer", "qa", "researcher"]);
  assert.deepEqual(resolveConfig({ lobby: { planningPanel: ["qa", "bogus", "backend", "qa"] } }).lobby.planningPanel, ["backend", "qa"]);
  assert.deepEqual(resolveConfig({ lobby: { planningPanel: [] } }).lobby.planningPanel, [], "an empty panel means the oracle plans alone");
});
test("the planning panel read as a string falls back to the default seats", () => {
  assert.deepEqual(resolveConfig({ lobby: { planningPanel: "qa" } }).lobby.planningPanel, DEFAULT_CONFIG.lobby.planningPanel);
});

test("the planning round limit defaults to 5 and keeps whole numbers (0 = unlimited)", () => {
  assert.equal(DEFAULT_CONFIG.lobby.maxPlanningRounds, 5);
  assert.equal(resolveConfig({ lobby: { maxPlanningRounds: 3 } }).lobby.maxPlanningRounds, 3);
  assert.equal(resolveConfig({ lobby: { maxPlanningRounds: 0 } }).lobby.maxPlanningRounds, 0);
  for (const bad of [-1, 2.5, "4", null]) assert.equal(resolveConfig({ lobby: { maxPlanningRounds: bad } }).lobby.maxPlanningRounds, 5);
});

test("the removed terminal-only lobby settings are not kept in a resolved config", () => {
  const lobby = resolveConfig({ lobby: { autoOpen: false, autoAsk: false, mouse: false, miniLine: false, web: { enabled: false, questions: "terminal", port: 8123 } } }).lobby as unknown as Record<string, unknown>;
  for (const key of ["autoOpen", "autoAsk", "mouse", "miniLine"]) assert.equal(key in lobby, false, key);
  assert.deepEqual(lobby.web, { port: 8123, openBrowser: true });
});
