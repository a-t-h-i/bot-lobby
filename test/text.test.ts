import { test } from "node:test";
import assert from "node:assert/strict";
import { shortTitle } from "../src/text.ts";

test("shortTitle keeps the first three content words", () => {
  assert.equal(shortTitle("let's create a landing page for our website"), "create landing page");
});

test("shortTitle strips filler anywhere in the request but preserves casing and order", () => {
  assert.equal(shortTitle("Please Can You add OAuth support to the API"), "add OAuth support");
  assert.equal(shortTitle("I would like to fix the login bug"), "fix login bug");
});

test("shortTitle falls back to the raw first words when stripping leaves nothing", () => {
  assert.equal(shortTitle("please help me"), "please help me");
  assert.equal(shortTitle("the a for"), "the a for");
});

test("shortTitle is total and deterministic at the edges", () => {
  assert.equal(shortTitle(""), "");
  assert.equal(shortTitle("   \t\n "), "");
  assert.equal(shortTitle("Refactor", 3), "Refactor");
  assert.equal(shortTitle("add a feature now", 1), "add");
  assert.equal(shortTitle("add a feature now", 0), "");
  assert.equal(shortTitle("add   a\nfeature now"), "add feature now");
});
