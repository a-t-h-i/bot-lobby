import { test } from "node:test";
import assert from "node:assert/strict";
import { busyAgents, busyLabel } from "../webui/src/tabs/lobby/busy.ts";

const quiet = { oracleBusy: false, runs: [], activity: [], background: [] };

test("nobody at work is nobody", () => {
  assert.deepEqual(busyAgents(quiet), []);
  assert.deepEqual(busyAgents({ ...quiet, runs: [{ role: "dev", status: "success" }], activity: [{ source: "DEV", pending: false }], background: [{ name: "S1", busy: false, alive: true }] }), []);
});

test("the oracle, running agents, work still under way and busy background sessions, each once", () => {
  const names = busyAgents({
    oracleBusy: true,
    runs: [{ role: "dev", status: "running" }, { domain: "qa", status: "running" }, { role: "dev", status: "running" }],
    activity: [{ source: "MASTER", pending: true }, { source: "DESIGN", pending: true }, { source: "LOBBY", pending: true }],
    background: [{ name: "S1", busy: true, alive: true }, { name: "S2", busy: true, alive: false }],
  });
  assert.deepEqual(names, ["Oracle", "Dev", "QA", "Design", "1 in the background"]);
});

test("the orb's tag names two and counts the rest", () => {
  assert.equal(busyLabel(["Dev"]), "Dev");
  assert.equal(busyLabel(["Oracle", "Dev"]), "Oracle, Dev");
  assert.equal(busyLabel(["Oracle", "Dev", "QA", "Design"]), "Oracle, Dev +2");
});
