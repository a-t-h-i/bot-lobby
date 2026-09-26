import { test } from "node:test";
import assert from "node:assert/strict";
import type { Api, Model } from "@earendil-works/pi-ai";
import { checkThinking, createProfileResolver, supportedThinking, thinkingMismatches } from "../src/pi/model-support.ts";
import { resolveConfig } from "../src/schemas/configuration.ts";

function model(id: string, extra: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "p",
    baseUrl: "http://localhost",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
    ...extra,
  } as Model<Api>;
}

const plain = model("plain", { reasoning: false });
const standard = model("standard");
const deep = model("deep", { thinkingLevelMap: { xhigh: "xhigh", max: "max" } } as Partial<Model<Api>>);
const models = new Map([plain, standard, deep].map((entry) => [`p/${entry.id}`, entry]));
const lookup = (ref: string) => models.get(ref);

test("supported levels follow the model: none without reasoning, xhigh/max only when mapped", () => {
  assert.deepEqual(supportedThinking(plain), ["off"]);
  assert.ok(!supportedThinking(standard).includes("xhigh"));
  assert.ok(supportedThinking(deep).includes("max"));
  assert.ok(supportedThinking(undefined).includes("max"), "unknown models are not restricted");
});

test("an unsupported level is clamped with a warning that names the model", () => {
  const check = checkThinking(standard, "max");
  assert.notEqual(check.level, "max");
  assert.match(check.warning!, /"max" thinking isn't supported by p\/standard/);
  assert.deepEqual(checkThinking(deep, "max"), { level: "max" });
  assert.equal(checkThinking(plain, "high").level, "off");
  assert.deepEqual(checkThinking(undefined, "high"), { level: "high" });
});

test("the profile resolver pins unset models to the session model and warns once per mismatch", () => {
  const config = resolveConfig({ agents: { backend: { model: "p/standard", thinking: "max" } } });
  const warnings: string[] = [];
  const resolve = createProfileResolver(config, { lookup, sessionModel: "p/plain", warn: (message) => warnings.push(message) });
  const worker = resolve("backend", "worker");
  assert.equal(worker.model, "p/standard");
  assert.notEqual(worker.thinking, "max");
  resolve("backend", "worker");
  assert.equal(warnings.length, 1, "the same mismatch warns once");
  assert.match(warnings[0]!, /Backend/);
  const designer = resolve("designer", "worker");
  assert.equal(designer.model, "p/plain", "an unset model runs on the session model");
  assert.equal(designer.thinking, "off", "and is clamped to what that model supports");
});

test("thinkingMismatches lists every agent whose level its model cannot run", () => {
  const config = resolveConfig({ agents: { qa: { model: "p/plain", thinking: "high" } }, researcher: { model: "p/deep", thinking: "max" } });
  const found = thinkingMismatches(config, lookup);
  assert.equal(found.length, 1);
  assert.match(found[0]!, /^QA:/);
});
