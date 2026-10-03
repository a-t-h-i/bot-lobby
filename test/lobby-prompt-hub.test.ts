import { test } from "node:test";
import assert from "node:assert/strict";
import { PromptHub } from "../src/lobby/prompt-hub.ts";

test("a prompt carries its web shape: id, kind, timestamp, asker and payload", () => {
  const hub = new PromptHub();
  const prompt = hub.open("questionnaire", "planner", { questions: [] });
  assert.match(prompt.id, /^p\d+-[a-z0-9]+$/);
  assert.equal(prompt.kind, "questionnaire");
  assert.ok(prompt.createdAt > 0);
  assert.equal(prompt.from, "planner");
  assert.deepEqual(prompt.payload, { questions: [] });
  assert.deepEqual(hub.pending().map((entry) => entry.id), [prompt.id]);
  assert.equal(hub.dismiss(prompt.id), true);
});

test("the first answer wins and a late one is refused without changing the outcome", () => {
  const hub = new PromptHub();
  const prompt = hub.open("choose", "orchestrate", { title: "Ship it?", options: ["Yes", "No"] });
  assert.equal(hub.answer(prompt.id, "Yes"), true);
  assert.equal(hub.answer(prompt.id, "No"), false);
  assert.deepEqual(hub.pending(), []);
  assert.deepEqual(hub.outcome(prompt.id), { id: prompt.id, value: "Yes", how: "answered" });
});

test("ask waits for the answer and resolves with it", async () => {
  const hub = new PromptHub();
  const asked = hub.ask("text", "orchestrate", { question: "Name?" });
  const [prompt] = hub.pending();
  assert.ok(prompt);
  assert.equal(hub.answer(prompt!.id, "typed"), true);
  assert.deepEqual(await asked, { how: "answered", value: "typed" });
});

test("a dismissed prompt resolves its ask as dismissed, and a second dismiss reports false", async () => {
  const hub = new PromptHub();
  const asked = hub.ask("sessionDialog", "Task-1", { dialog: { id: "q1" } });
  const id = hub.pending()[0]!.id;
  assert.equal(hub.dismiss(id), true);
  assert.equal(hub.dismiss(id), false);
  assert.deepEqual(await asked, { how: "dismissed", value: undefined });
  assert.deepEqual(hub.outcome(id)?.how, "dismissed");
});

test("an aborted caller takes its prompt out of the queue; one already aborted never enters it", async () => {
  const hub = new PromptHub();
  const controller = new AbortController();
  const asked = hub.ask("confirm", "oracle", { title: "Sure?" }, { signal: controller.signal });
  assert.equal(hub.pending().length, 1);
  controller.abort();
  assert.deepEqual(await asked, { how: "cancelled", value: undefined });
  assert.deepEqual(hub.pending(), []);
  assert.deepEqual(await hub.ask("confirm", "oracle", {}, { signal: controller.signal }), { how: "cancelled", value: undefined });
  assert.deepEqual(hub.pending(), [], "nothing was queued");
});

test("an answer to an unknown prompt reports false", () => {
  assert.equal(new PromptHub().answer("p0-nope", "x"), false);
});
