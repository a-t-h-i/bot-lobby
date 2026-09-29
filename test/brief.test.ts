import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { briefProblems, briefRejection, resetBriefs, SHORT_BRIEF_CHARS } from "../src/workflow/brief.ts";

beforeEach(() => resetBriefs());

test("short, concrete tasks pass without any ceremony", () => {
  for (const text of ["Fix the typo in README.md", "In `src/a.ts`, rename foo to bar", "Change the button label to \"Save\"", "Add the getUser call to src/api/users.ts"]) {
    assert.deepEqual(briefProblems(text), [], text);
  }
});

test("a vague task names nothing concrete", () => {
  assert.equal(briefProblems("Make it look nicer.").length, 1);
  assert.match(briefProblems("Do work.")[0]!, /no file, path/);
});

test("a long brief needs done criteria, and any wording of them counts", () => {
  const body = `Update src/timer.ts so the countdown ${"uses the shared clock and ".repeat(10)}stays in sync.`;
  assert.ok(body.length > SHORT_BRIEF_CHARS);
  assert.match(briefProblems(body)[0]!, /Done when/);
  assert.deepEqual(briefProblems(`${body} Done when \`npm test\` passes.`), []);
  assert.deepEqual(briefProblems(`${body} Verify with npm test.`), []);
});

test("a short brief is sent back once; the same text again goes through", () => {
  assert.match(briefRejection("T1", "backend", "Make it nicer")!, /not sent/);
  assert.equal(briefRejection("T1", "backend", "  make it   nicer "), undefined, "unchanged means the master judged it complete");
  assert.match(briefRejection("T1", "backend", "Make it nicer")!, /not sent/, "the override is used up");
  assert.equal(briefRejection("T1", "designer", "Add a blue button to src/App.tsx"), undefined);
});

test("a different steps' rejection does not excuse another", () => {
  briefRejection("T1", "backend", "Make it nicer");
  assert.match(briefRejection("T1", "designer", "Make it nicer")!, /designer brief/);
});
