import { test } from "node:test";
import assert from "node:assert/strict";
import { activityWord } from "../src/pi/activity.ts";

test("activityWord maps known tools to a single gerund", () => {
  assert.equal(activityWord("read"), "reading");
  assert.equal(activityWord("edit"), "editing");
  assert.equal(activityWord("write"), "editing");
  assert.equal(activityWord("grep"), "searching");
  assert.equal(activityWord("find"), "searching");
  assert.equal(activityWord("bash"), "running");
  assert.equal(activityWord("orchestrate"), "orchestrating");
  assert.equal(activityWord("web_search"), "researching");
  assert.equal(activityWord("web_fetch"), "researching");
  assert.equal(activityWord("fetch"), "researching");
});

test("activityWord covers the registered web-access tools", () => {
  assert.equal(activityWord("fetch_content"), "researching");
  assert.equal(activityWord("get_search_content"), "researching");
  assert.equal(activityWord("source_check"), "researching");
});

test("activityWord falls back to working for unknown and empty names", () => {
  assert.equal(activityWord(""), "working");
  assert.equal(activityWord("   "), "working");
  assert.equal(activityWord("ls"), "working");
  assert.equal(activityWord("something_new"), "working");
});

test("activityWord normalises case and surrounding whitespace", () => {
  assert.equal(activityWord("READ"), "reading");
  assert.equal(activityWord(" Bash "), "running");
});

test("every mapped word is a single word", () => {
  for (const tool of ["read", "edit", "grep", "bash", "orchestrate", "web_search", "unknown"]) {
    assert.match(activityWord(tool), /^\S+$/);
  }
});
