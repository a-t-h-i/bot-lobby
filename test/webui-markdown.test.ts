import assert from "node:assert/strict";
import test from "node:test";
import { continueList, link, wrap } from "../webui/src/app/markdownEdit.ts";

test("wrapping marks a selection, takes the mark off again, and leaves the cursor between marks when nothing is selected", () => {
  assert.deepEqual(wrap("a big day", 2, 5, "**"), { value: "a **big** day", start: 4, end: 7 });
  assert.deepEqual(wrap("a **big** day", 4, 7, "**"), { value: "a big day", start: 2, end: 5 }, "marks around the selection come off");
  assert.deepEqual(wrap("a **big** day", 2, 9, "**"), { value: "a big day", start: 2, end: 5 }, "so do marks inside it");
  assert.deepEqual(wrap("", 0, 0, "_"), { value: "__", start: 1, end: 1 });
});

test("a link leaves its address selected", () => {
  const edit = link("see docs here", 4, 8);
  assert.equal(edit.value, "see [docs](url) here");
  assert.equal(edit.value.slice(edit.start, edit.end), "url");
  assert.equal(link("", 0, 0).value, "[text](url)");
});

test("a list carries on at its end, counts up, keeps task boxes and indent, and ends on an empty marker", () => {
  assert.deepEqual(continueList("- one", 5), { value: "- one\n- ", start: 8, end: 8 });
  assert.equal(continueList("1. one\n2. two", 13)!.value, "1. one\n2. two\n3. ");
  assert.equal(continueList("  * [x] done", 12)!.value, "  * [x] done\n  * [ ] ");
  assert.deepEqual(continueList("- one\n- ", 8), { value: "- one\n", start: 6, end: 6 }, "an empty marker ends the list");
  assert.equal(continueList("plain line", 10), undefined);
  assert.equal(continueList("- one", 1), undefined, "inside the marker it is a plain new line");
  assert.equal(continueList("-not a list", 11), undefined);
});
