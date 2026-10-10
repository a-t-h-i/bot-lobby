import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, SessionEntry, TurnEndEvent, compact } from "@earendil-works/pi-coding-agent";
import { compactionThreshold, registerAutoCompaction } from "../src/pi/auto-compaction.ts";

test("compaction leaves headroom on large and small windows and honours earlier reserves", () => {
  assert.equal(compactionThreshold(1_000_000), 250_000);
  assert.equal(compactionThreshold(200_000), 160_000);
  assert.equal(compactionThreshold(100_000, 30_000), 70_000);
  assert.equal(compactionThreshold(8_000), 4_000);
});

function harness(summarize: typeof compact) {
  const handlers = new Map<string, (event: TurnEndEvent, ctx: ExtensionContext) => Promise<unknown>>();
  const notices: string[] = [];
  const pi = { on: (name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(name, handler), getSettings: () => ({ compaction: { reserveTokens: 16_384 }, retry: { enabled: false } }) } as unknown as ExtensionAPI;
  registerAutoCompaction(pi, summarize);
  const entries = Array.from({ length: 50 }, (_, index) => ({ type: "message", id: String(index), parentId: index ? String(index - 1) : null, timestamp: new Date(index).toISOString(), message: { role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text: "x".repeat(5_000) }], timestamp: index } })) as SessionEntry[];
  let tokens = 90_000;
  let leaf = "49";
  const ctx = { model: { id: "m", provider: "test", contextWindow: 100_000 }, getSystemPrompt: () => "", getContextUsage: () => ({ tokens }), compact: () => { throw new Error("Manual compaction must never abort the turn"); }, sessionManager: { getLeafId: () => leaf, getBranch: () => entries, buildContextEntries: () => entries }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) }, ui: { notify: (message: string) => notices.push(message) } } as unknown as ExtensionContext;
  const event = { entries: [], context: { contextMessages: entries.flatMap((entry) => entry.type === "message" ? [entry.message] : []), canContinue: true } } as unknown as TurnEndEvent;
  return { check: () => handlers.get("turn_end")!(event, ctx), notices, entries, setTokens: (value: number) => { tokens = value; }, setLeaf: (value: string) => { leaf = value; } };
}

test("compaction proposes a persisted boundary, retains recent messages and leaves raw history intact", async () => {
  let calls = 0;
  const h = harness(async (preparation) => {
    calls += 1;
    assert.ok(preparation.messagesToSummarize.length > 0);
    assert.ok(Number(preparation.firstKeptEntryId) > 0);
    return { summary: "Goals, constraints, outstanding children and verification", firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: preparation.tokensBefore };
  });
  const before = JSON.stringify(h.entries);
  const result = await h.check() as { entries: Array<{ type: string; summary: string; firstKeptEntryId: string }> };
  assert.equal(result.entries[0]?.type, "compaction");
  assert.match(result.entries[0]!.summary, /outstanding children/);
  assert.equal(JSON.stringify(h.entries), before);
  await h.check();
  assert.equal(calls, 1, "same boundary cannot compact twice");
  assert.deepEqual(h.notices, ["Compacting agent context", "Agent context compacted"]);
});

test("failed summaries preserve history and cannot loop at the same boundary", async () => {
  let calls = 0;
  const h = harness(async () => { calls += 1; throw new Error("provider unavailable"); });
  const before = JSON.stringify(h.entries);
  assert.equal(await h.check(), undefined);
  assert.equal(await h.check(), undefined);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(h.entries), before);
  assert.match(h.notices.at(-1)!, /provider unavailable/);
});
