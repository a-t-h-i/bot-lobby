import { test } from "node:test";
import assert from "node:assert/strict";
import { choice, choiceOf, noul, score, scoreOf, yesOf, type SystemOneRequest } from "../src/classifier/client.ts";
import { Classifier } from "../src/classifier/classifier.ts";
import { chatClassify, chatUser, parseChatAnswers } from "../src/classifier/chat.ts";
import { engineAnswer, engineClassifiers, splitRef, type Registry } from "../src/classifier/models.ts";
import { DEFAULT_CONFIG, resolveConfig, type ClassifierConfig } from "../src/schemas/configuration.ts";
import { classifierSummary } from "../src/pi/model-settings.ts";
import type { MetricRecord } from "../src/state/metrics.ts";

const REQUEST: SystemOneRequest = {
  state: { task: "rename the export button", scripts: { k1: "seed_holidays.py: seed public holidays" } },
  questions: {
    k1: noul("Does `scripts.k1` do part of `task`?"),
    size: choice("How big is `task`?", { small: "one file", large: "many files" }),
    effort: score("How hard is `task`?", ["trivial", "simple", "complex"]),
  },
};

function config(patch: Partial<ClassifierConfig> = {}): ClassifierConfig {
  return { ...DEFAULT_CONFIG.classifier, enabled: true, ...patch };
}

test("a chat model is asked each typed question as JSON, and its probabilities become Jev's answers", async () => {
  const user = JSON.parse(chatUser(REQUEST)) as { state: unknown; questions: Record<string, Record<string, unknown>> };
  assert.deepEqual(user.state, REQUEST.state, "the state goes as it is: questions name its parts");
  assert.deepEqual(user.questions.k1, { kind: "yes_no", instructions: "Does `scripts.k1` do part of `task`?" });
  assert.deepEqual(user.questions.size!.options, { small: "one file", large: "many files" });
  assert.deepEqual(user.questions.effort!.levels, { 0: "trivial", 1: "simple", 2: "complex" });

  const answers = parseChatAnswers(REQUEST, "Here you go:\n```json\n{\"k1\": 0.2, \"size\": {\"small\": 3, \"large\": 1}, \"effort\": {\"0\": 0.1, \"1\": 0.9}}\n```");
  assert.equal(yesOf(answers, "k1"), 0.2);
  const size = choiceOf(answers, "size")!;
  assert.equal(size.choice, "small");
  assert.equal(size.probability, 0.75, "weights are normalised to sum to 1");
  assert.ok(size.confidence > 0 && size.confidence < 1);
  const effort = scoreOf(answers, "effort")!;
  assert.ok(Math.abs(effort.score - 0.9) < 1e-9, "a level is the probability-weighted index");
  assert.equal(effort.level, 1);

  const partial = parseChatAnswers(REQUEST, "{\"k1\": \"0.7\", \"size\": {\"medium\": 1}}");
  assert.deepEqual(Object.keys(partial), ["k1"], "an answer naming no known option is left out, so the caller falls back for it");
  assert.throws(() => parseChatAnswers(REQUEST, "I think yes."), /did not reply with a JSON object/);
  assert.throws(() => parseChatAnswers(REQUEST, "{\"other\": 1}"), /answered none of the questions/);

  let asked: { system: string; user: string; maxTokens: number } | undefined;
  const done = await chatClassify(REQUEST, async (prompt) => ((asked = prompt), { text: "{\"k1\": 1}", model: "openai/gpt-5-nano" }), false);
  assert.match(asked!.system, /You are a classifier/);
  assert.ok(asked!.maxTokens < 1000, "a short reply needs few tokens");
  assert.equal(done.model, "openai/gpt-5-nano");
});

/** A registry that knows one classifier model and one chat model. */
function registry(record: { classified?: unknown[]; streamed?: unknown[] } = {}, chatText = "{\"k1\": 0.9}"): Registry {
  const classifierModel = { type: "classifier", provider: "openrouter", id: "liquid/d1", name: "Liquid D1" };
  const chatModel = { provider: "openai", id: "gpt-5-nano", reasoning: false };
  return {
    findOfType: (_type: string, provider: string, id: string) => (provider === "openrouter" && id === "liquid/d1" ? classifierModel : undefined),
    find: (provider: string, id: string) => (provider === "openai" && id === "gpt-5-nano" ? chatModel : undefined),
    classify: async (_model: unknown, context: { questions: Record<string, { type: string }> }) => {
      record.classified?.push(context);
      return { stopReason: "stop", model: "liquid/d1", answers: { k1: { type: "bool", probability: 0.8 }, size: { type: "choice", choice: "small", probabilities: { small: 0.9, large: 0.1 }, confidence: 0.6 } }, usage: { input: 40, output: 2 } };
    },
    streamSimple: (_model: unknown, context: unknown, options: unknown) => {
      record.streamed?.push({ context, options });
      return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: chatText }], usage: { input: 300, output: 12 } }) };
    },
    getAvailableOfType: async () => [classifierModel],
  } as unknown as Registry;
}

test("the engine answers with pi's own models: a classifier model natively, a chat model as JSON, anything else is an error", async () => {
  assert.deepEqual(splitRef("openrouter/liquid/d1"), { provider: "openrouter", id: "liquid/d1" });
  assert.equal(splitRef("gpt-5"), undefined);

  const classified: unknown[] = [];
  const streamed: unknown[] = [];
  const answer = engineAnswer(registry({ classified, streamed }));
  const native = await answer("openrouter/liquid/d1", REQUEST, { timeoutMs: 1500, chatTimeoutMs: 4000 });
  assert.equal((classified[0] as { questions: Record<string, { type: string }> }).questions.k1!.type, "bool", "Jev's yes/no questions are pi's bool");
  assert.equal(yesOf(native.answers, "k1"), 0.8, "and its answers come back as Jev's");
  assert.equal(choiceOf(native.answers, "size")?.choice, "small");
  assert.equal(native.model, "openrouter/liquid/d1");
  assert.deepEqual(native.usage, { input_tokens: 40, output_tokens: 2 });

  const chat = await answer("openai/gpt-5-nano", REQUEST, { timeoutMs: 1500, chatTimeoutMs: 4000 });
  assert.equal(yesOf(chat.answers, "k1"), 0.9);
  assert.equal(chat.model, "openai/gpt-5-nano");
  const sent = streamed[0] as { context: { systemPrompt: string }; options: { reasoning?: string; maxTokens: number } };
  assert.match(sent.context.systemPrompt, /You are a classifier/);
  assert.equal(sent.options.reasoning, undefined, "a model without reasoning is asked for none");

  await assert.rejects(answer("anthropic/unknown", REQUEST, { timeoutMs: 100, chatTimeoutMs: 100 }), /pi has no model anthropic\/unknown/);
  await assert.rejects(answer("bare-id", REQUEST, { timeoutMs: 100, chatTimeoutMs: 100 }), /not a provider\/model reference/);
  await assert.rejects(engineAnswer(registry({}, "no idea"))("openai/gpt-5-nano", REQUEST, { timeoutMs: 100, chatTimeoutMs: 100 }), /JSON object/);
  assert.deepEqual(await engineClassifiers(registry()), [{ id: "openrouter/liquid/d1", label: "Liquid D1", kind: "classifier" }], "the picker lists what pi's logins can call");
});

test("with an engine set the classifier answers through it, records the model, and pauses after repeated failures", async () => {
  const records: MetricRecord[] = [];
  const warnings: string[] = [];
  const calls: Array<{ ref: string; timeoutMs: number; chatTimeoutMs: number }> = [];
  let fail = false;
  let clock = 0;
  const jev = new Classifier({
    config: () => config({ engine: "openai/gpt-5-nano", timeoutMs: 6000 }),
    engine: async (ref, _request, options) => {
      calls.push({ ref, timeoutMs: options.timeoutMs, chatTimeoutMs: options.chatTimeoutMs });
      clock += 400;
      if (fail) throw new Error("401 not signed in");
      return { model: ref, answers: { k1: { type: "noul", noul: 0.95 } }, usage: { input_tokens: 300, output_tokens: 9 } };
    },
    keys: async () => assert.fail("Jev's key is never looked up when another model answers"),
    metrics: (record) => records.push(record),
    warn: (message) => warnings.push(message),
    now: () => clock,
  });
  const result = await jev.ask("scripts", REQUEST, { timeoutMs: 1500 });
  assert.equal(yesOf(result?.answers, "k1"), 0.95);
  assert.equal(result?.model, "openai/gpt-5-nano");
  assert.deepEqual(calls[0], { ref: "openai/gpt-5-nano", timeoutMs: 1500, chatTimeoutMs: 6000 }, "the step's budget, and the configured limit for a chat model that must write its answers");
  assert.deepEqual(records.map((record) => [record.purpose, record.status, record.model, record.input]), [["scripts", "success", "openai/gpt-5-nano", 300]]);

  fail = true;
  for (let index = 0; index < 3; index += 1) assert.equal(await jev.ask("scripts", REQUEST), undefined);
  assert.equal(records.at(-1)!.status, "failed");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /paused for 10 minutes after 3 failures in a row \(401 not signed in\)/);
  const test = await jev.test();
  assert.deepEqual(test, { ok: false, error: "401 not signed in" }, "the connection test reports the engine's error");
});

test("the engine setting is empty (Jev) by default, trimmed when set, and named in the summary", () => {
  assert.equal(DEFAULT_CONFIG.classifier.engine, "");
  assert.equal(resolveConfig({ classifier: { engine: " openai/gpt-5-nano " } }).classifier.engine, "openai/gpt-5-nano");
  assert.equal(resolveConfig({ classifier: { engine: 7 } }).classifier.engine, "");
  assert.equal(classifierSummary({ ...DEFAULT_CONFIG, classifier: config({ engine: "openai/gpt-5-nano" }) }, undefined), "on · openai/gpt-5-nano · your pi login");
});
