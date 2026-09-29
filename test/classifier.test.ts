import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { choice, choiceOf, JevError, noul, score, scoreOf, systemOne, yesOf, type FetchLike } from "../src/classifier/client.ts";
import { BREAKER_FAILURES, BREAKER_PAUSE_MS, Classifier } from "../src/classifier/classifier.ts";
import { clip, clipTail, fitsBudget, LIMITS } from "../src/classifier/limits.ts";
import { chooseHost, describeKey, JEV_HOST_TABLE, jevEndpoint, keyHint, maskKey, registerJevProvider, resolveKey, resolveTarget, type StatusSource } from "../src/classifier/hosts.ts";
import { DEFAULT_CONFIG, resolveConfig, type ClassifierConfig } from "../src/schemas/configuration.ts";
import { appendMetrics, readClassifierMetrics, readMetrics, type MetricRecord } from "../src/state/metrics.ts";
import { classifierSummary, nextJevHost, toggleClassifierFeature } from "../src/pi/settings-ui.ts";

interface Sent {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** A fake API: each call takes the next response (a Response, a thrown error, or a JSON body). */
function fakeFetch(responses: Array<Response | Error | object>, sent: Sent[] = []): FetchLike {
  return async (url, init) => {
    sent.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return new Response(JSON.stringify(next ?? {}), { status: 200 });
  };
}

const OK = { model: "jev-1.13", answers: { a: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 120, output_tokens: 3 } };
const options = { apiKey: "ts_secret_key", baseUrl: "https://api.example/", timeoutMs: 1000, sleep: async () => {} };

test("systemOne posts the state and questions with a bearer key and reads typed answers", async () => {
  const sent: Sent[] = [];
  const response = await systemOne({ state: { message: "hi" }, questions: { a: noul("Is `message` a greeting?") } }, { ...options, model: "jev-latest", fetch: fakeFetch([OK], sent) });
  assert.equal(sent[0]!.url, "https://api.example/v1/systemone");
  assert.equal((sent[0]!.init.headers as Record<string, string>).Authorization, "Bearer ts_secret_key");
  assert.deepEqual(sent[0]!.body, { model: "jev-latest", state: { message: "hi" }, questions: { a: { type: "noul", instructions: "Is `message` a greeting?" } } });
  assert.equal(response.model, "jev-1.13");
  assert.equal(yesOf(response.answers, "a"), 0.9);
  assert.deepEqual(response.usage, { input_tokens: 120, output_tokens: 3 });
});

test("systemOne retries once on a rate limit, honouring retry-after (capped), and never on a client error", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  const limited = new Response(JSON.stringify({ detail: "slow down" }), { status: 429, headers: { "retry-after": "60" } });
  const sent: Sent[] = [];
  const response = await systemOne({ state: "x", questions: {} }, { ...options, sleep, fetch: fakeFetch([limited, OK], sent) });
  assert.equal(sent.length, 2);
  assert.deepEqual(waits, [2000], "a long retry-after is capped: the classifier sits on the interactive path");
  assert.equal(response.model, "jev-1.13");

  const twice = fakeFetch([new Response("{}", { status: 503 }), new Response("{}", { status: 503 })]);
  await assert.rejects(systemOne({ state: "x", questions: {} }, { ...options, fetch: twice }), (error: JevError) => error.status === 503 && error.retryable);

  const bad = new Response(JSON.stringify({ detail: { message: "questions must not be empty" } }), { status: 400 });
  const badSent: Sent[] = [];
  await assert.rejects(systemOne({ state: "x", questions: {} }, { ...options, fetch: fakeFetch([bad, OK], badSent) }), /API error 400: questions must not be empty/);
  assert.equal(badSent.length, 1);
});

test("systemOne times out, aborts, and rejects bodies without answers", async () => {
  const hang: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  const hung: Sent[] = [];
  const counting: FetchLike = (url, init) => (hung.push({ url, init, body: {} }), hang(url, init));
  await assert.rejects(systemOne({ state: "x", questions: {} }, { ...options, timeoutMs: 10, fetch: counting }), /timed out after 10 ms/);
  assert.equal(hung.length, 1, "a timeout is not retried: the time limit already bounds the decision");
  const controller = new AbortController();
  const pending = systemOne({ state: "x", questions: {} }, { ...options, signal: controller.signal, fetch: hang });
  controller.abort(new Error("user pressed esc"));
  await assert.rejects(pending, (error: Error) => !(error instanceof JevError));
  await assert.rejects(systemOne({ state: "x", questions: {} }, { ...options, fetch: fakeFetch([{ model: "m" }]) }), /without answers/);
  await assert.rejects(systemOne({ state: "x", questions: {} }, { ...options, fetch: fakeFetch([new Response("<html>", { status: 200 })]) }), /not JSON/);
});

test("answer readers validate shapes and compute a choice's lead over the runner-up", () => {
  const answers = {
    yes: { type: "noul" as const, noul: 1.4 },
    pick: { type: "choice" as const, choice: "b", probabilities: { a: 0.05, b: 0.9, c: 0.05 }, confidence: 0.8 },
    level: { type: "score" as const, score: 1.6, confidence: 0.7 },
  };
  assert.equal(yesOf(answers, "yes"), 1, "clamped to a probability");
  assert.equal(yesOf(answers, "pick"), undefined, "wrong type");
  assert.equal(yesOf(answers, "missing"), undefined);
  const picked = choiceOf(answers, "pick")!;
  assert.equal(picked.choice, "b");
  assert.equal(picked.probability, 0.9);
  assert.ok(Math.abs(picked.margin - 0.85) < 1e-9);
  assert.deepEqual(scoreOf(answers, "level"), { score: 1.6, level: 2, confidence: 0.7 });
  assert.deepEqual(choice("Which?", { a: null }), { type: "choice", instructions: "Which?", criteria: { a: null } });
  assert.deepEqual(score("How big?", ["small", "large"]), { type: "score", instructions: "How big?", criteria: ["small", "large"] });
  assert.deepEqual(noul("Q?", "yes when", "no when"), { type: "noul", instructions: "Q?", criteria: { true: "yes when", false: "no when" } });
});

test("limits clip long items and keep requests within budget", () => {
  assert.equal(clip("abcdef", 10), "abcdef");
  assert.equal(clip("a".repeat(20), 10), "aaaaaa […]");
  assert.equal(clipTail("0123456789abcdef", 10), "[…] abcdef");
  assert.ok(fitsBudget({ state: "x", questions: {} }));
  assert.equal(fitsBudget({ state: "x".repeat(LIMITS.requestChars), questions: {} }), false);
});

function config(overrides: Partial<ClassifierConfig> = {}): ClassifierConfig {
  return { ...DEFAULT_CONFIG.classifier, enabled: true, ...overrides };
}

test("the classifier stays silent when off, and warns once when it has no key", async () => {
  let settings = config({ enabled: false });
  const sent: Sent[] = [];
  const warnings: string[] = [];
  const jev = new Classifier({ config: () => settings, fetch: fakeFetch([OK, OK], sent), env: {}, warn: (message) => warnings.push(message), keys: async () => undefined });
  assert.equal(jev.enabled(), false);
  assert.equal(await jev.ask("seats", { state: "x", questions: {} }), undefined);
  assert.equal(sent.length, 0, "off means no call at all");
  settings = config({ features: { ...DEFAULT_CONFIG.classifier.features, seats: false } });
  assert.equal(jev.enabled("seats"), false, "each decision has its own switch");
  assert.equal(jev.enabled("files"), true);
  settings = config();
  assert.equal(await jev.ask("seats", { state: "x", questions: {} }), undefined);
  assert.equal(await jev.ask("seats", { state: "x", questions: {} }), undefined);
  assert.equal(sent.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /no Jev key: sign in to OpenCode for its free Jev \(\/login opencode or set OPENCODE_API_KEY\), or \/login typesafe \(Use an API key\) or set TYPESAFE_API_KEY/);
});

test("the classifier uses pi's key for the chosen host, records every call, and skips requests over budget", async () => {
  const sent: Sent[] = [];
  const records: MetricRecord[] = [];
  const asked: string[] = [];
  let clock = 1_000;
  const jev = new Classifier({
    config: () => config({ provider: "openrouter", model: "jev-1.13" }),
    keys: async (provider) => (asked.push(provider), "sk-or-key"),
    fetch: async (url, init) => {
      clock += 180;
      return fakeFetch([OK], sent)(url, init);
    },
    metrics: (record) => records.push(record),
    now: () => clock,
    warn: () => {},
  });
  const result = await jev.ask("files", { state: "x", questions: { a: noul("?") } });
  assert.deepEqual(asked, ["openrouter"], "OpenRouter's key is the one pi already holds");
  assert.equal(sent[0]!.url, "https://openrouter.ai/api/v1/systemone");
  assert.equal(sent[0]!.body.model, "jev-1.13");
  assert.equal((sent[0]!.init.headers as Record<string, string>)["X-Title"], "bot-lobby");
  assert.equal(result?.ms, 180);
  assert.equal(yesOf(result?.answers, "a"), 0.9);
  assert.deepEqual(records.map((record) => [record.kind, record.agent, record.purpose, record.status, record.model, record.durationMs, record.input]), [["classifier", "CLASSIFIER", "files", "success", "jev-1.13", 180, 120]]);
  assert.equal(await jev.ask("files", { state: "x".repeat(LIMITS.requestChars), questions: {} }), undefined);
  assert.equal(sent.length, 1, "an oversized request is never sent");
  assert.equal(records.at(-1)!.status, "failed");
});

test("three failures in a row pause the classifier for ten minutes with one warning; a success resets the count", async () => {
  let clock = 0;
  const warnings: string[] = [];
  const responses: Array<Response | object> = [];
  const sent: Sent[] = [];
  const jev = new Classifier({ config: () => config(), keys: async () => "ts_key", fetch: fakeFetch(responses as Array<Response | object>, sent), now: () => clock, warn: (message) => warnings.push(message), sleep: async () => {} });
  const fail = () => new Response("{}", { status: 400 });
  responses.push(fail(), fail(), OK);
  for (let i = 0; i < 3; i++) await jev.ask("seats", { state: "x", questions: {} });
  assert.equal(warnings.length, 0, "two failures then a success: no pause");
  responses.push(...Array.from({ length: BREAKER_FAILURES }, fail));
  for (let i = 0; i < BREAKER_FAILURES; i++) assert.equal(await jev.ask("seats", { state: "x", questions: {} }), undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /paused for 10 minutes after 3 failures in a row \(API error 400/);
  assert.equal(jev.enabled(), false);
  const before = sent.length;
  assert.equal(await jev.ask("seats", { state: "x", questions: {} }), undefined);
  assert.equal(sent.length, before, "no calls while paused");
  clock += BREAKER_PAUSE_MS;
  assert.equal(jev.enabled(), true, "back after the pause");
});

test("a cancelled call is not a failure, and the connection test reports its error", async () => {
  const warnings: string[] = [];
  const hang: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  const records: MetricRecord[] = [];
  const jev = new Classifier({ config: () => config(), keys: async () => "ts_key", fetch: hang, warn: (message) => warnings.push(message), metrics: (record) => records.push(record) });
  for (let i = 0; i < BREAKER_FAILURES; i++) {
    const controller = new AbortController();
    const pending = jev.ask("seats", { state: "x", questions: {} }, { signal: controller.signal });
    controller.abort();
    assert.equal(await pending, undefined);
  }
  assert.deepEqual(warnings, []);
  assert.ok(records.every((record) => record.status === "cancelled"));
  const failing = new Classifier({ config: () => config({ enabled: false }), keys: async () => "ts_key", fetch: fakeFetch([new Response("{}", { status: 401 })]) });
  assert.deepEqual(await failing.test(), { ok: false, error: "API error 401: {}" }, "the test runs even while the classifier is off");
  const working = new Classifier({ config: () => config(), keys: async () => "ts_key", fetch: fakeFetch([OK]) });
  const result = await working.test();
  assert.equal(result.ok && result.model, "jev-1.13");
});

/** pi's auth status for the providers named, as `getProviderAuthStatus` reports it. */
function statusOf(entries: Record<string, { source: string; label?: string }>): StatusSource {
  return (provider) => (entries[provider] ? { configured: true, ...entries[provider] } : { configured: false });
}

test("hosts: auto takes OpenCode's free Jev when pi holds an OpenCode key, else TypeSafe; keys resolve through pi then the environment", async () => {
  assert.equal(DEFAULT_CONFIG.classifier.provider, "auto");
  assert.equal(chooseHost(DEFAULT_CONFIG.classifier, statusOf({ "opencode-go": { source: "stored" } }), {}).name, "opencode", "an OpenCode Go key is the same OpenCode key");
  assert.equal(chooseHost(DEFAULT_CONFIG.classifier, statusOf({ typesafe: { source: "stored" } }), {}).name, "typesafe");
  assert.equal(chooseHost(DEFAULT_CONFIG.classifier, statusOf({}), { OPENCODE_API_KEY: "x" }).name, "opencode");
  assert.equal(chooseHost(DEFAULT_CONFIG.classifier, statusOf({}), {}).name, "typesafe", "nothing set: TypeSafe, whose /login entry bot-lobby adds");
  assert.deepEqual(jevEndpoint(DEFAULT_CONFIG.classifier, statusOf({ opencode: { source: "stored" } }), {}), { host: JEV_HOST_TABLE.opencode, baseUrl: "https://opencode.ai/zen", model: "jev-1.13-free" });
  assert.equal(jevEndpoint(config({ provider: "vercel" })).host.piProviders[0], "vercel-ai-gateway");
  assert.equal(jevEndpoint(config({ provider: "typesafe", baseUrl: "https://proxy.local", model: "jev-1.13" })).baseUrl, "https://proxy.local");

  // The classifier resolves the key itself: the first auto host with one wins.
  const asked: string[] = [];
  const target = await resolveTarget(config(), async (provider) => (asked.push(provider), provider === "opencode-go" ? "oc_key" : undefined), {});
  assert.deepEqual(asked, ["opencode", "opencode-go"]);
  assert.deepEqual(target, { host: JEV_HOST_TABLE.opencode, baseUrl: "https://opencode.ai/zen", model: "jev-1.13-free", key: "oc_key" });
  assert.equal((await resolveTarget(config(), async (provider) => (provider === "typesafe" ? "ts_key" : undefined), {})).host.name, "typesafe");
  assert.equal((await resolveTarget(config(), async () => undefined, {})).key, undefined);
  assert.equal((await resolveTarget(config({ provider: "opencode", model: "jev-1.13" }), async () => "oc", {})).model, "jev-1.13", "the paid model once the free one ends");

  assert.equal(await resolveKey(JEV_HOST_TABLE.typesafe, async () => " ts_pi ", {}), "ts_pi");
  assert.equal(await resolveKey(JEV_HOST_TABLE.typesafe, async () => undefined, { TYPESAFE_API_KEY: "ts_env" }), "ts_env");
  assert.equal(await resolveKey(JEV_HOST_TABLE.typesafe, async () => { throw new Error("no registry"); }, {}), undefined);
  assert.equal(maskKey("ts_abcdefgh1234"), "ts_a…1234");
  assert.equal(maskKey("short"), "*****");
  assert.equal(describeKey(JEV_HOST_TABLE.typesafe, statusOf({ typesafe: { source: "stored" } }), {}), "stored in pi (/login typesafe)");
  assert.equal(describeKey(JEV_HOST_TABLE.opencode, statusOf({ "opencode-go": { source: "stored" } }), {}), "stored in pi (/login opencode-go)");
  assert.equal(describeKey(JEV_HOST_TABLE.typesafe, statusOf({ typesafe: { source: "environment", label: "TYPESAFE_API_KEY" } }), {}), "from TYPESAFE_API_KEY");
  assert.equal(describeKey(JEV_HOST_TABLE.typesafe, statusOf({}), {}), "missing: /login typesafe → Use an API key, or set TYPESAFE_API_KEY");
  assert.equal(describeKey(JEV_HOST_TABLE.opencode, statusOf({}), {}), "missing: /login opencode, or set OPENCODE_API_KEY");
  assert.equal(keyHint({ provider: "opencode" }), "/login opencode or set OPENCODE_API_KEY");
  const registered: Array<[string, unknown]> = [];
  assert.equal(registerJevProvider({ registerProvider: (name: string, cfg: unknown) => registered.push([name, cfg]) } as never), true);
  assert.deepEqual(registered, [["typesafe", { name: "TypeSafe (Jev classifier)", baseUrl: "https://api.typesafe.ai", apiKey: "$TYPESAFE_API_KEY", models: [] }]], "a login entry with no chat models; the key reference is pi's $ENV form");
  assert.equal(registerJevProvider({ registerProvider: () => { throw new Error("old pi"); } } as never), false);
});

test("OpenCode's free Jev is called at the Zen endpoint, and when it ends the classifier says to pick the paid model instead of switching", async () => {
  const sent: Sent[] = [];
  const warnings: string[] = [];
  const gone = () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 });
  const jev = new Classifier({ config: () => config(), keys: async (provider) => (provider === "opencode" ? "oc_key" : undefined), fetch: fakeFetch([OK, gone(), gone(), gone()], sent), warn: (message) => warnings.push(message), sleep: async () => {}, env: {} });
  assert.ok(await jev.ask("seats", { state: "x", questions: {} }));
  assert.equal(sent[0]!.url, "https://opencode.ai/zen/v1/systemone");
  assert.equal(sent[0]!.body.model, "jev-1.13-free");
  assert.equal((sent[0]!.init.headers as Record<string, string>).Authorization, "Bearer oc_key");
  for (let i = 0; i < 3; i++) await jev.ask("seats", { state: "x", questions: {} });
  assert.equal(sent.length, 4, "never retried on the paid model");
  assert.ok(sent.every((entry) => entry.body.model === "jev-1.13-free"));
  assert.match(warnings[0]!, /OpenCode Zen's free jev-1\.13-free may have ended; set the classifier's model to jev-1\.13 \(paid\)/);
});

test("the classifier config is off by default and normalises every field", () => {
  assert.equal(DEFAULT_CONFIG.classifier.enabled, false);
  const resolved = resolveConfig({ classifier: { enabled: true, provider: "bogus", timeoutMs: -1, model: " jev-1.13 ", features: { effort: false, nope: true }, thresholds: { seatAt: 0.2, autoAnswerAt: 7 }, fileHints: { topK: 3, budgetMs: 0 }, effort: { cheapModel: "p/cheap" }, exclude: ["secrets/**", 4, ""] } }).classifier;
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.provider, "auto");
  assert.equal(resolved.timeoutMs, 4000);
  assert.equal(resolved.model, "jev-1.13");
  assert.deepEqual(resolved.features, { seats: true, answers: true, files: true, triage: true, effort: false, review: true });
  assert.equal(resolved.thresholds.seatAt, 0.2);
  assert.equal(resolved.thresholds.autoAnswerAt, 0.9, "a probability outside 0..1 keeps the default");
  assert.deepEqual(resolved.fileHints, { topK: 3, maxCandidates: 480, budgetMs: 1500 });
  assert.equal(resolved.effort.cheapModel, "p/cheap");
  assert.deepEqual(resolved.exclude, ["secrets/**"]);
  assert.deepEqual(resolveConfig({}).classifier, DEFAULT_CONFIG.classifier);
  assert.deepEqual(["auto", "opencode", "typesafe", "openrouter", "vercel"].map((name) => nextJevHost(name as never)), ["opencode", "typesafe", "openrouter", "vercel", "auto"]);
  assert.equal(toggleClassifierFeature(DEFAULT_CONFIG, "files").classifier.features.files, false);
  assert.equal(classifierSummary(DEFAULT_CONFIG, statusOf({ opencode: { source: "stored" } })), "off · OpenCode Zen (auto) · jev-1.13-free · key stored in pi (/login opencode)");
  assert.equal(classifierSummary({ ...DEFAULT_CONFIG, classifier: { ...DEFAULT_CONFIG.classifier, provider: "typesafe" } }, statusOf({ typesafe: { source: "stored" } })), "off · TypeSafe · jev-latest · key stored in pi (/login typesafe)");
});

test("classifier calls share the metrics log but stay out of the agent tables", () => {
  const root = mkdtempSync(join(tmpdir(), "bl-classifier-"));
  const at = new Date().toISOString();
  appendMetrics(root, ".pi", [
    { id: "w1", kind: "worker", agent: "DEV", status: "success", startedAt: at, durationMs: 60_000 },
    { id: "c1", kind: "classifier", agent: "CLASSIFIER", purpose: "seats", status: "success", startedAt: at, durationMs: 200 },
  ]);
  assert.deepEqual(readMetrics(root, ".pi").map((record) => record.id), ["w1"]);
  assert.deepEqual(readClassifierMetrics(root, ".pi").map((record) => record.id), ["c1"]);
});
