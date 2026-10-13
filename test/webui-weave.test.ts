import { test } from "node:test";
import assert from "node:assert/strict";
import { weave } from "../webui/src/tabs/lobby/weave.ts";

const msg = (id: number, at: number) => ({ id, at, role: "you", text: `m${id}` });
const step = (id: number, at: number) => ({ id, at, source: "DEV", text: `s${id}`, kind: "info", pending: false });

test("each run of steps follows the message it came after", () => {
  const woven = weave([msg(1, 10), msg(2, 20)], [step(5, 12), step(6, 15), step(7, 25)]);
  assert.deepEqual(woven.map((item) => (item.kind === "message" ? `m${item.entry.id}` : item.entries.map((entry) => entry.id).join("+"))), ["m1", "5+6", "m2", "7"]);
  assert.equal(woven[1]?.kind === "activity" && woven[1].key, "steps-5", "a run is keyed by its first step, so it keeps its place while it grows");
});

test("steps older than every message go first, and a step at a message's moment follows it", () => {
  const woven = weave([msg(1, 10)], [step(2, 10), step(3, 4)]);
  assert.deepEqual(woven.map((item) => item.kind), ["activity", "message", "activity"]);
});

test("no steps, no runs; no messages, one run", () => {
  assert.deepEqual(weave([msg(1, 1)], []).map((item) => item.kind), ["message"]);
  assert.deepEqual(weave([], [step(1, 1), step(2, 2)]).map((item) => item.kind), ["activity"]);
});
