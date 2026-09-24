import { test } from "node:test";
import assert from "node:assert/strict";
import { selectKnowledge, selectRelevant, splitSections, tokenize } from "../src/knowledge/selector.ts";

const SAMPLE = [
  "# Knowledge",
  "",
  "## Authentication",
  "Login uses a central session service at src/auth/session.ts.",
  "",
  "## Billing",
  "Invoices are generated nightly by the billing worker.",
  "",
  "## Notifications",
  "Email notifications go through the queue in src/notify/queue.ts.",
].join("\n");

test("tokenize drops stopwords and short tokens", () => {
  const tokens = tokenize("The payment service should validate the token");
  assert.ok(tokens.includes("payment"));
  assert.ok(tokens.includes("service"));
  assert.ok(tokens.includes("validate"));
  assert.ok(!tokens.includes("the"));
  assert.ok(!tokens.includes("and"));
});

test("splitSections keeps each heading with its body", () => {
  const sections = splitSections(SAMPLE);
  assert.equal(sections.length, 4);
  assert.ok(sections[1]!.startsWith("## Authentication"));
});

test("content within budget is returned unchanged", () => {
  const short = "# Knowledge\n\nSmall.";
  assert.equal(selectRelevant("anything", short, 1000), short);
});

test("oversized content keeps the section relevant to the task", () => {
  const selected = selectRelevant("how does billing invoice work", SAMPLE, 120);
  assert.ok(selected.includes("Billing"), selected);
  assert.ok(!selected.includes("Notifications"));
});

test("oversized content with no keyword match still respects the budget", () => {
  const selected = selectRelevant("zzzz qqqq", SAMPLE, 80);
  assert.ok(selected.length > 0);
  assert.ok(selected.length <= 80);
});

test("selectKnowledge selects each file independently", () => {
  const selection = selectKnowledge("billing", {
    knowledge: SAMPLE,
    standards: "# Standards\n\n## Billing\nAlways use integers for money.",
    decisions: "# Decisions\n\n## Auth\nSessions are server-side.",
  }, 200);
  assert.ok(selection.knowledge.includes("Billing"));
  assert.ok(selection.standards.includes("integers for money"));
  assert.ok(selection.decisions.length > 0);
});
