import { test } from "node:test";
import assert from "node:assert/strict";
import { routeOf, splitRoutes } from "../webui/src/tabs/lobby/route.ts";

const step = (id: number, source: string, text: string) => ({ id, at: id, source, text, kind: "info", pending: false });

test("the classifier's pick is its own line; a name you typed needs none; other steps stay folded", () => {
  assert.deepEqual(routeOf(step(1, "LOBBY", "DEV answers: the classifier picked DEV (0.83)")), { agent: "DEV" });
  assert.equal(routeOf(step(2, "LOBBY", "SCOUT answers: you named SCOUT")), "named");
  assert.deepEqual(routeOf(step(3, "LOBBY", "a knowledge question (0.71): the oracle reads the project's knowledge")), { knowledge: true });
  assert.equal(routeOf(step(4, "DEV", "DEV answers: no")), undefined);
  const out = splitRoutes([{ kind: "activity", key: "k", entries: [step(1, "LOBBY", "DEV answers: the classifier picked DEV (0.8)"), step(2, "DEV", "read a file"), step(3, "LOBBY", "QA answers: you named QA")] }]);
  assert.deepEqual(out.map((item) => item.kind), ["route", "activity"]);
});
