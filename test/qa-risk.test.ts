import { test } from "node:test";
import assert from "node:assert/strict";
import { Classifier } from "../src/classifier/classifier.ts";
import type { Answer, FetchLike, Question } from "../src/classifier/client.ts";
import { assessQaRisk } from "../src/classifier/qa-risk.ts";
import { DEFAULT_CONFIG, type ClassifierConfig } from "../src/schemas/configuration.ts";

/** A diff as the QA gate reads it: each file's removed and added lines. */
function diffOf(files: Record<string, { add?: string[]; remove?: string[] }>): string {
  return Object.entries(files)
    .map(([path, { add = [], remove = [] }]) => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -1 +1 @@", ...remove.map((line) => `-${line}`), ...add.map((line) => `+${line}`)].join("\n"))
    .join("\n");
}

function change(files: Record<string, { add?: string[]; remove?: string[] }>, extra: { bugfix?: boolean } = {}) {
  return { files: Object.keys(files), diff: diffOf(files), ...extra };
}

const lines = (count: number, text = "x") => Array.from({ length: count }, (_, index) => `const ${text}${index} = ${index};`);

test("the rules size QA by what the change touches, not by how long it is", async () => {
  const cases: Array<[string, ReturnType<typeof change>, string, string]> = [
    ["500 lines of documentation", change({ "docs/guide.md": { add: Array.from({ length: 500 }, (_, index) => `Line ${index}.`) } }), "none", "0"],
    ["a comment in an auth file", change({ "src/auth/reset.ts": { add: ["// Tokens expire after an hour."] } }), "none", "0"],
    ["five lines of authorization", change({ "src/routes/admin.ts": { add: ["if (!user.permissions.includes(\"admin\")) return deny();", ...lines(4)] } }), "high", "2-6"],
    ["a small local fix", change({ "src/format.ts": { remove: ["return n.toFixed(1);"], add: ["return n.toFixed(2);"] } }), "low", "0-1"],
    ["a feature in one module", change({ "src/report/build.ts": { add: lines(60) }, "src/report/rows.ts": { add: lines(50, "y") }, "src/report/totals.ts": { add: lines(30, "z") } }), "medium", "1-3"],
    ["a dependency bump", change({ "package.json": { remove: ['"zod": "^3.22.0",'], add: ['"zod": "^4.0.0",'] }, "package-lock.json": { add: ["…"] } }), "medium", "1-3"],
  ];
  for (const [name, input, risk, budget] of cases) {
    const assessed = await assessQaRisk(input);
    assert.equal(assessed.risk, risk, `${name}: ${assessed.reasoning}`);
    const { min, max } = assessed.testBudget;
    assert.equal(min === max ? `${max}` : `${min}-${max}`, budget, name);
    assert.equal(assessed.qaRequired, risk !== "none", name);
    assert.equal(assessed.source, "rules");
  }
  const high = await assessQaRisk(cases[2]![1]);
  assert.match(high.riskFactors.join("\n"), /security: src\/routes\/admin\.ts \("permission"\)/, "the evidence names the file and what in it");
  assert.match(high.focusAreas.join("\n"), /security boundaries/);
});

/** A fake Jev answering the QA risk questions from a script. */
function jev(script: { risk: number; confidence?: number; areas?: Record<string, number>; behaviour?: number; testsCover?: number }, calls: Array<Record<string, Question>> = []): FetchLike {
  return async (_url, init) => {
    const { questions } = JSON.parse(String(init.body)) as { questions: Record<string, Question> };
    calls.push(questions);
    const answers: Record<string, Answer> = {};
    for (const key of Object.keys(questions)) {
      if (key === "risk") answers[key] = { type: "score", score: script.risk, confidence: script.confidence ?? 0.8 };
      else if (key === "behaviour") answers[key] = { type: "noul", noul: script.behaviour ?? 0.9 };
      else if (key === "tests_cover") answers[key] = { type: "noul", noul: script.testsCover ?? 0.1 };
      else answers[key] = { type: "noul", noul: script.areas?.[key.replace(/^area_/, "")] ?? 0.05 };
    }
    return new Response(JSON.stringify({ model: "jev-test", answers }), { status: 200 });
  };
}

function classifierWith(fetch: FetchLike): Classifier {
  const config: ClassifierConfig = { ...DEFAULT_CONFIG.classifier, enabled: true };
  return new Classifier({ config: () => config, keys: async () => "key", fetch, sleep: async () => {} });
}

test("Jev has the last word on the level, within the floors of what the changed lines touch", async () => {
  const sessionPath = change({ "src/auth/session-list.ts": { remove: ["return rows;"], add: ["return rows.slice(0, 50);"] } });
  const authLine = change({ "src/login.ts": { remove: ["if (!password) return;"], add: ["if (!password || password.length < 8) return;"] } });

  // A path that only names an area: the rules alone hold it at MEDIUM; Jev reading it as untouched lets it be what it is.
  assert.equal((await assessQaRisk(sessionPath)).risk, "medium");
  const plain = await assessQaRisk(sessionPath, classifierWith(jev({ risk: 1, areas: { security: 0.02 } })));
  assert.equal(plain.risk, "low", plain.reasoning);
  assert.equal(plain.source, "classifier");

  // A changed line that touches security stays HIGH when Jev confirms it, however small Jev reads it.
  const confirmed = await assessQaRisk(authLine, classifierWith(jev({ risk: 1, areas: { security: 0.9 } })));
  assert.equal(confirmed.risk, "high", confirmed.reasoning);

  // An area only Jev sees in the diff raises it too.
  const seen = await assessQaRisk(sessionPath, classifierWith(jev({ risk: 1, areas: { workflow: 0.8 } })));
  assert.equal(seen.risk, "high");
  assert.match(seen.riskFactors.join("\n"), /orchestration and state: Jev reads it in the diff/);

  // Tests that cover the change free QA from writing more.
  const covered = await assessQaRisk(change({ "src/report/build.ts": { add: lines(60) } }), classifierWith(jev({ risk: 2, testsCover: 0.9 })));
  assert.deepEqual([covered.risk, covered.testBudget, covered.existingTestsLikelySufficient], ["medium", { min: 0, max: 3 }, true]);

  // Jev is not asked about a change with nothing that runs, and a failing Jev leaves the rules' read.
  const calls: Array<Record<string, Question>> = [];
  assert.equal((await assessQaRisk(change({ "README.md": { add: ["More."] } }), classifierWith(jev({ risk: 3 }, calls)))).risk, "none");
  assert.equal(calls.length, 0);
  const down = await assessQaRisk(authLine, classifierWith(async () => new Response("down", { status: 500 })));
  assert.deepEqual([down.risk, down.source], ["high", "rules"]);
});
