import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPoint, parsePlace, toPlace, toPoint } from "../webui/src/tabs/lobby/orbPlace.ts";

const card = { left: 12, top: 80, width: 1000, height: 600 };

test("the orb is kept on the card, a few pixels in from every edge", () => {
  assert.deepEqual(clampPoint(-500, -500, card, 44), { x: 18, y: 86 });
  assert.deepEqual(clampPoint(5000, 5000, card, 44), { x: 12 + 1000 - 44 - 6, y: 80 + 600 - 44 - 6 });
  assert.deepEqual(clampPoint(400, 300, card, 44), { x: 400, y: 300 });
});

test("a place is a share of the card, so it holds when the window changes size", () => {
  const place = toPlace(12 + 478, 80 + 278, card, 44);
  assert.deepEqual(place, { fx: 0.5, fy: 0.5 });
  assert.deepEqual(toPoint(place, card, 44), { x: 490, y: 358 });
  const wider = { ...card, width: 1400 };
  assert.deepEqual(toPoint(place, wider, 44), { x: 12 + 678, y: 358 }, "still in the middle of a wider card");
});

test("only a stored place that reads as one is used", () => {
  assert.deepEqual(parsePlace('{"fx":0.2,"fy":0.9}'), { fx: 0.2, fy: 0.9 });
  for (const raw of [null, "", "nope", '{"fx":2,"fy":0.5}', '{"fx":0.5}', '{"fx":"0.5","fy":0.5}']) assert.equal(parsePlace(raw), undefined, String(raw));
});
