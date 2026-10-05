import { test } from "node:test";
import assert from "node:assert/strict";
import { thoughtSteps } from "../webui/src/tabs/lobby/thoughtSteps.ts";

test("a headed thought becomes one step per section, its list kept whole", () => {
  const steps = thoughtSteps("**Reading the router**\n\nThe API lives in `src/webui/api`.\n\n**Next**\n\n- add the route\n- test it");
  assert.deepEqual(steps, [
    { title: "Reading the router", text: "The API lives in `src/webui/api`." },
    { title: "Next", text: "- add the route\n- test it" },
  ]);
  assert.deepEqual(thoughtSteps("## Plan\nShip it."), [{ title: "Plan", text: "Ship it." }], "a Markdown heading counts too");
});

test("paragraphs are steps, and a long run of prose splits every sentence or two", () => {
  assert.deepEqual(thoughtSteps("First look.\n\nThen act."), [{ text: "First look." }, { text: "Then act." }]);
  const wall = "The user wants the page to build with no Pi at all, so every call needs a fixture. I should check that `index.ts` still loads the scenarios, e.g. the question one. Then the reconnecting case: the stream drops and comes back. Last, the error scenario shows its banner rather than a blank page, which is easy to miss.";
  const steps = thoughtSteps(wall);
  assert.ok(steps.length >= 2, "a wall of text is broken up");
  assert.equal(steps.map((step) => step.text).join(" "), wall, "nothing is reworded or lost");
  assert.ok(steps.every((step) => !step.title));
  assert.ok(steps.some((step) => step.text.includes("`index.ts` still loads the scenarios, e.g. the question one.")), "a file name and e.g. do not end a sentence");
});

test("code fences stay whole even across blank lines, and a short thought is one step", () => {
  const steps = thoughtSteps("Try this:\n\n```ts\nconst a = 1\n\nconst b = 2\n```");
  assert.equal(steps.length, 2);
  assert.equal(steps[1]!.text, "```ts\nconst a = 1\n\nconst b = 2\n```");
  assert.deepEqual(thoughtSteps("  just one thought  "), [{ text: "just one thought" }]);
  assert.deepEqual(thoughtSteps(""), []);
});
