import { test } from "node:test";
import assert from "node:assert/strict";
import { Classifier } from "../src/classifier/classifier.ts";
import type { Answer, FetchLike, Question } from "../src/classifier/client.ts";
import { chooseSeats } from "../src/classifier/seats.ts";
import { autoAnswer } from "../src/classifier/answers.ts";
import { quickFixSize } from "../src/classifier/triage.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";
import { summarizeClassifier, type MetricRecord } from "../src/state/metrics.ts";

function answering(make: (questions: Record<string, Question>) => Record<string, Answer>): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, Question> };
    return new Response(JSON.stringify({ model: "jev-test", answers: make(body.questions), usage: { input_tokens: 200, output_tokens: 4 } }), { status: 200 });
  };
}

function jev(fetch: FetchLike, records: MetricRecord[]): Classifier {
  return new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true }), keys: async () => "ts_key", fetch, metrics: (record) => records.push(record), sleep: async () => {} });
}

test("each decision records what it spared: seat runs skipped, questions answered, quick fixes held", async () => {
  const records: MetricRecord[] = [];
  await chooseSeats(jev(answering((questions) => Object.fromEntries(Object.keys(questions).map((key) => [key, { type: "noul", noul: key === "seat_backend" ? 0.9 : 0.05 }]))), records), {
    round: 1, idea: "an API", latest: "an API",
    candidates: [{ member: "backend", label: "DEV", owns: "APIs" }, { member: "designer", label: "DESIGN", owns: "screens" }, { member: "qa", label: "QA", owns: "tests" }],
  });
  await autoAnswer(jev(answering(() => ({ q1: { type: "choice", choice: "CSV", probabilities: { CSV: 0.97 }, confidence: 0.97 } })), records), [{ index: 0, from: "QA", text: "Format?", options: [{ label: "CSV", description: "" }, { label: "PDF", description: "" }], recommended: "CSV" }], { request: "export", conversation: "" });
  await quickFixSize(jev(answering(() => ({ size: { type: "score", score: 3, confidence: 0.9 } })), records), "rewrite auth");
  await quickFixSize(jev(answering(() => ({ size: { type: "score", score: 1, confidence: 0.9 } })), records), "fix a typo");
  assert.deepEqual(records.map((record) => [record.purpose, record.saved]), [["seats", 2], ["answers", 1], ["triage", 1], ["triage", undefined]]);
});

function call(purpose: string, durationMs: number, extra: Partial<MetricRecord> = {}): MetricRecord {
  return { id: `${purpose}-${durationMs}`, kind: "classifier", agent: "CLASSIFIER", purpose, status: "success", startedAt: "2026-01-01T00:00:00Z", durationMs, input: 100, ...extra };
}

test("the summary counts calls, their speed and what they spared, and routed runs with their success rate", () => {
  assert.equal(summarizeClassifier([], []), undefined, "never ran: no section");
  const calls = [call("seats", 100, { saved: 2 }), call("seats", 200, { saved: 1 }), call("answers", 300, { saved: 3 }), call("files", 400), call("triage", 500, { saved: 1 }), call("effort", 900, { status: "timeout" })];
  const runs: MetricRecord[] = [
    { id: "a", kind: "worker", agent: "DEV", status: "success", startedAt: "", durationMs: 1, routedFrom: "p/big · high" },
    { id: "b", kind: "worker", agent: "DEV", status: "failed", startedAt: "", durationMs: 1, routedFrom: "p/big · high" },
    { id: "c", kind: "worker", agent: "DEV", status: "success", startedAt: "", durationMs: 1 },
  ];
  const summary = summarizeClassifier(calls, runs)!;
  assert.deepEqual(summary, {
    calls: 6, ok: 5, p50Ms: 400, p90Ms: 900, input: 600,
    byPurpose: { seats: 2, answers: 1, files: 1, triage: 1, effort: 1 },
    seatRunsSkipped: 3, questionsAnswered: 3, quickFixesHeld: 1, routed: 2, routedOk: 1,
  });
});
