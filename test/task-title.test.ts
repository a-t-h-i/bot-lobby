import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/state/project.ts";
import { generateTaskTitle } from "../src/pi/task-title.ts";

function context(text: string, overrides: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const model = { id: "small", provider: "test" };
  const ctx = { model, modelRegistry: {
      find: () => model, getAvailable: () => [model],
      streamSimple: (...args: unknown[]) => {
        calls.push(args);
        return { result: async () => ({ content: [{ type: "text", text }], stopReason: "stop" }) };
      },
      ...overrides,
  } } as unknown as ExtensionContext;
  return { ctx, calls, model };
}

test("task titles summarize the full request using low reasoning and the cheap model", async () => {
  const { ctx, calls, model } = context("Improve task naming");
  ctx.model = { ...model, id: "large" } as NonNullable<ExtensionContext["model"]>;
  const config = loadConfig();
  config.classifier.effort.cheapModel = "test/small";
  const request = "I was looking at the lobby today. Task names should capture the gist instead of the first few words.";
  assert.equal(await generateTaskTitle(ctx, request, config), "Improve task naming");
  assert.equal(calls[0]![0], model);
  assert.equal((calls[0]![1] as { messages: { content: string }[] }).messages[0]!.content, request);
  assert.equal((calls[0]![2] as { reasoning: string }).reasoning, "low");
  assert.ok((calls[0]![2] as { signal: AbortSignal }).signal instanceof AbortSignal);
});

test("task naming uses the session model when the cheap model is inherited or unavailable", async () => {
  for (const cheapModel of ["inherit", "test/missing"]) {
    const { ctx, calls, model } = context("Fix task names", { find: () => undefined });
    const config = loadConfig();
    config.classifier.effort.cheapModel = cheapModel;
    assert.equal(await generateTaskTitle(ctx, "please fix task names", config), "Fix task names");
    assert.equal(calls[0]![0], model);
    assert.equal((calls[0]![2] as { reasoning: string }).reasoning, "low");
  }
});

test("task naming falls back on missing models, failures and invalid replies", async () => {
  const request = "please fix task names";
  for (const text of ["", "Title: Fix task names", "Here is a title\nFix task names", "a b c d e f", "!!!"]) {
    assert.equal(await generateTaskTitle(context(text).ctx, request, loadConfig()), "fix task names");
  }
  const failed = context("", { streamSimple: () => { throw new Error("offline"); } });
  assert.equal(await generateTaskTitle(failed.ctx, request, loadConfig()), "fix task names");
  assert.equal(await generateTaskTitle({} as ExtensionContext, request, loadConfig()), "fix task names");
});

test("task naming times out even when the provider ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stalled = context("", { streamSimple: () => ({ result: () => new Promise(() => {}) }) });
  const result = generateTaskTitle(stalled.ctx, "fix task names", loadConfig());
  t.mock.timers.tick(8000);
  assert.equal(await result, "fix task names");
});

test("task titles accept quoted Unicode text but reject failed completions", async () => {
  assert.equal(await generateTaskTitle(context('"Réparer les noms"').ctx, "fix names", loadConfig()), "Réparer les noms");
  const failed = context("", { streamSimple: () => ({ result: async () => ({ stopReason: "error", content: [{ type: "text", text: "Wrong title" }] }) }) });
  assert.equal(await generateTaskTitle(failed.ctx, "fix names", loadConfig()), "fix names");
});
