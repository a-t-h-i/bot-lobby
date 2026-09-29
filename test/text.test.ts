import { test } from "node:test";
import assert from "node:assert/strict";
import { dateStamp, nameWords, shortTitle, taskName } from "../src/text.ts";

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

test("shortTitle reads a Markdown request, escaped line breaks included, as words", () => {
  // A request whose line breaks arrived written out as \n became the title "### Objective\nFour fixes:\n-".
  assert.equal(shortTitle("### Objective\\nFour fixes:\\n- solid Save buttons keep their fill"), "Four fixes: solid");
  assert.equal(shortTitle("### Objective\nFour fixes:\n- solid Save buttons"), "Four fixes: solid");
  assert.equal(shortTitle("## Fix the `navbar` colours"), "Fix navbar colours");
  assert.equal(shortTitle("Rework: the header"), "Rework: header");
});

test("tail keeps the newest end of a log", async () => {
  const { tail } = await import("../src/text.ts");
  assert.equal(tail("abcdef", 10), "abcdef");
  assert.equal(tail("abcdef", 2), "[...4 earlier characters omitted]\nef");
});

test("a task's friendly name is its first content words, capitalised, then the day", () => {
  const day = new Date(2026, 8, 27, 23, 59);
  assert.equal(dateStamp(day), "27-09-2026");
  assert.equal(dateStamp(new Date(2027, 0, 3)), "03-01-2027");
  assert.equal(taskName("Change the table font", day), "Task-Change-Table-Font-27-09-2026");
  assert.equal(taskName("please can you fix the login redirect bug on mobile", day), "Task-Fix-Login-Redirect-Bug-Mobile-27-09-2026", "at most five words, connectors left out");
  assert.equal(taskName("Change the table font to Inter and make it 14px", day), "Task-Change-Table-Font-Inter-Make-27-09-2026", "no `and` filling a slot");
  assert.equal(taskName("update the docs and", day), "Task-Update-Docs-27-09-2026", "and never ends a name");
  assert.equal(nameWords("add OAuth support to the API"), "Add-OAuth-Support-API", "capitals inside a word stay");
  assert.equal(nameWords("rename front-end helpers"), "Rename-Front-End-Helpers", "a hyphenated word keeps its parts");
  assert.equal(nameWords("### Objective\nFour fixes: solid buttons"), "Four-Fixes-Solid-Buttons", "Markdown labels are skipped");
  assert.equal(nameWords("añadir página de inicio"), "Añadir-Página-De-Inicio", "letters of any script count");
  assert.equal(nameWords("x".repeat(80)), `X${"x".repeat(35)}`, "a single long word is cut");
  assert.equal(nameWords("implementation internationalization infrastructure rearchitecture"), "Implementation-Internationalization", "cut between words, not in one");
  assert.equal(nameWords("!!! ???"), "");
  assert.equal(taskName("???", day), "Task-Untitled-27-09-2026");
});
