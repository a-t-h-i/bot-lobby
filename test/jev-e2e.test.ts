/**
 * Live checks against the real Jev API. Skipped unless BOT_LOBBY_JEV_E2E=1:
 * they need a key and network access to the host. With the default host
 * (auto), an OpenCode key uses OpenCode Zen's free Jev, else a TypeSafe key;
 * BOT_LOBBY_JEV_HOST=opencode|typesafe|openrouter|vercel picks one.
 *
 *   BOT_LOBBY_JEV_E2E=1 OPENCODE_API_KEY=... node --test test/jev-e2e.test.ts
 *   BOT_LOBBY_JEV_E2E=1 TYPESAFE_API_KEY=ts_... node --test test/jev-e2e.test.ts
 *
 * Assertions are about shape and plausibility, not exact probabilities.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Classifier } from "../src/classifier/classifier.ts";
import { chooseSeats } from "../src/classifier/seats.ts";
import { likelyFiles } from "../src/classifier/files.ts";
import { triageTask, TRIAGE_SIZES } from "../src/classifier/triage.ts";
import { scoreEffort, EFFORT_LEVELS } from "../src/classifier/effort.ts";
import { DEFAULT_CONFIG, JEV_HOSTS, type JevHostName } from "../src/schemas/configuration.ts";

const enabled = process.env.BOT_LOBBY_JEV_E2E === "1";
const host = (JEV_HOSTS as readonly string[]).includes(process.env.BOT_LOBBY_JEV_HOST ?? "") ? process.env.BOT_LOBBY_JEV_HOST as JevHostName : "auto";

function live(): Classifier {
  // No pi key store here: the host's environment variable supplies the key.
  return new Classifier({ config: () => ({ ...DEFAULT_CONFIG.classifier, enabled: true, provider: host, timeoutMs: 15_000 }), warn: (message) => console.warn(message) });
}

test("the connection test reaches Jev", { skip: !enabled, timeout: 60_000 }, async () => {
  const result = await live().test();
  assert.ok(result.ok, result.ok ? "" : result.error);
});

test("a backend-only idea seats DEV and not DESIGN", { skip: !enabled, timeout: 60_000 }, async () => {
  const decision = await chooseSeats(live(), {
    round: 1,
    idea: "Add rate limiting (100 requests per minute per API key) to the POST /api/export endpoint; respond 429 with a Retry-After header.",
    latest: "",
    candidates: [
      { member: "backend", label: "DEV", owns: "APIs and contracts, data, errors, security, performance" },
      { member: "designer", label: "DESIGN", owns: "screens, flows, copy, visual language, accessibility" },
    ],
  });
  assert.ok(decision, "the classifier answered");
  assert.ok(decision.seat.has("backend"), `DEV ${decision.probabilities.get("backend")}`);
  assert.ok((decision.probabilities.get("backend") ?? 0) > (decision.probabilities.get("designer") ?? 1));
});

test("triage and effort read a small bugfix as small and simple", { skip: !enabled, timeout: 60_000 }, async () => {
  const jev = live();
  const triage = await triageTask(jev, { request: "Fix the typo 'recieve' in the README's install section.", domains: [{ domain: "backend", owns: "APIs" }, { domain: "designer", owns: "screens" }, { domain: "qa", owns: "tests" }] });
  assert.ok(triage, "the classifier answered");
  assert.ok(TRIAGE_SIZES.includes(triage.size));
  assert.ok(triage.size === "trivial" || triage.size === "small", triage.size);
  const effort = await scoreEffort(jev, "Rename the local variable `tmp` to `total` in src/sum.ts", undefined);
  assert.ok(effort && EFFORT_LEVELS.includes(effort.level));
  assert.ok(effort.level === "trivial" || effort.level === "simple", effort.level);
});

test("file ranking finds the planner for a question about planning rounds in this repository", { skip: !enabled, timeout: 120_000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), "bl-jev-e2e-"));
  const result = await likelyFiles(live(), { cwd: process.cwd(), root: data, configDir: ".pi" }, "where the planning panel's round limit decides the final round", { topK: 8 });
  assert.ok(result, "the classifier answered");
  assert.ok(result.files.some((file) => file.path === "src/lobby/planner.ts"), result.files.map((file) => `${file.path} ${file.relevance}`).join(", "));
});
