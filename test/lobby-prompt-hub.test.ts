import { test } from "node:test";
import assert from "node:assert/strict";
import { PromptHub, type PromptSurface, type WebPrompt } from "../src/lobby/prompt-hub.ts";

function fakeSurface(name: string) {
  const shown: WebPrompt[] = [];
  const withdrawn: string[] = [];
  const surface: PromptSurface = {
    name,
    show: (prompt) => void shown.push(prompt),
    withdraw: (id) => void withdrawn.push(id),
  };
  return { surface, shown, withdrawn };
}

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

test("two surfaces: the first answer wins and the other surface is withdrawn", () => {
  const hub = new PromptHub();
  const first = fakeSurface("terminal");
  const second = fakeSurface("web");
  hub.registerSurface(first.surface);
  hub.registerSurface(second.surface);
  const prompt = hub.open("choose", "orchestrate", { title: "Ship it?", options: ["Yes", "No"] });
  assert.deepEqual(first.shown.map((entry) => entry.id), [prompt.id]);
  assert.deepEqual(second.shown.map((entry) => entry.id), [prompt.id]);
  assert.equal(hub.answer(prompt.id, "Yes"), true);
  assert.equal(hub.answer(prompt.id, "No"), false);
  assert.deepEqual(first.withdrawn, [prompt.id]);
  assert.deepEqual(second.withdrawn, [prompt.id]);
  assert.deepEqual(hub.pending(), []);
  assert.deepEqual(hub.outcome(prompt.id), { id: prompt.id, value: "Yes", how: "answered" });
  // A late answer is not recorded: exactly one resolution stands.
  assert.equal(hub.answer(prompt.id, "No"), false);
  assert.deepEqual(hub.outcome(prompt.id)?.value, "Yes");
});

test("a cancelled caller withdraws every surface and records one outcome", async () => {
  const hub = new PromptHub();
  const first = fakeSurface("terminal");
  const second = fakeSurface("web");
  hub.registerSurface(first.surface);
  hub.registerSurface(second.surface);
  const controller = new AbortController();
  controller.abort();
  const seen: string[] = [];
  const value = await hub.run("text", "orchestrate", { question: "Name?" }, async (prompt) => {
    seen.push(prompt.id);
    return "typed";
  }, { signal: controller.signal });
  assert.equal(value, "typed");
  assert.deepEqual(seen, first.shown.map((entry) => entry.id));
  assert.deepEqual(first.withdrawn, seen);
  assert.deepEqual(second.withdrawn, seen);
  assert.deepEqual(hub.pending(), []);
  assert.equal(hub.outcome(seen[0]!)?.how, "cancelled");
});

test("run answers through the terminal when nobody else is registered", async () => {
  const hub = new PromptHub();
  const terminal = fakeSurface("terminal");
  hub.registerSurface(terminal.surface);
  const value = await hub.run("confirm", "oracle", { title: "Sure?" }, async () => true);
  assert.equal(value, true);
  assert.equal(terminal.shown.length, 1);
  assert.deepEqual(terminal.withdrawn, terminal.shown.map((entry) => entry.id));
  assert.deepEqual(hub.pending(), []);
});

test("dismiss withdraws and a second dismiss reports false", () => {
  const hub = new PromptHub();
  const terminal = fakeSurface("terminal");
  hub.registerSurface(terminal.surface);
  const prompt = hub.open("sessionDialog", "Task-1", { dialog: { id: "q1" } });
  assert.equal(hub.dismiss(prompt.id), true);
  assert.equal(hub.dismiss(prompt.id), false);
  assert.deepEqual(terminal.withdrawn, [prompt.id]);
  assert.deepEqual(hub.outcome(prompt.id)?.how, "dismissed");
});

test("an answer to an unknown prompt reports false", () => {
  const hub = new PromptHub();
  hub.registerSurface(fakeSurface("terminal").surface);
  assert.equal(hub.answer("p0-nope", "x"), false);
});
