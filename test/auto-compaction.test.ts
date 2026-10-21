import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, SessionEntry, TurnEndEvent, compact } from "@earendil-works/pi-coding-agent";
import { compactionThreshold, registerAutoCompaction } from "../src/pi/auto-compaction.ts";

test("compaction leaves headroom on large and small windows and honours earlier reserves", () => {
  assert.equal(compactionThreshold(1_000_000), 64_000);
  assert.equal(compactionThreshold(200_000), 64_000);
  assert.equal(compactionThreshold(100_000, 30_000), 60_000);
  assert.equal(compactionThreshold(8_000), 4_000);
});

function harness(summarize: typeof compact, options: Parameters<typeof registerAutoCompaction>[2] = { enabled: () => true, share: () => "" }) {
  const handlers = new Map<string, (event: TurnEndEvent, ctx: ExtensionContext) => Promise<unknown>>();
  const notices: string[] = [];
  const pi = { on: (name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(name, handler), getSettings: () => ({ compaction: { reserveTokens: 16_384 }, retry: { enabled: false } }) } as unknown as ExtensionAPI;
  registerAutoCompaction(pi, summarize, options);
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

test("an agent compacts at the token count its settings set, not before", async () => {
  let calls = 0;
  const h = harness(async (preparation) => { calls += 1; return { summary: "x", firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: 0 }; }, { enabled: () => true, target: () => 80_000, share: () => "" });
  h.setTokens(70_000);
  assert.equal(await h.check(), undefined, "70K is under the 80K set, though past the built-in 60K");
  assert.equal(calls, 0);
});

test("an agent whose settings turn auto-compaction off is never compacted", async () => {
  let calls = 0;
  const h = harness(async (preparation) => { calls += 1; return { summary: "x", firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: 0 }; }, { enabled: () => false });
  assert.equal(await h.check(), undefined);
  assert.equal(calls, 0);
  assert.deepEqual(h.notices, []);
});

test("the oracle's checkpoint asks for knowledge by agent and shares what it lists", async () => {
  let instruction = "";
  const shared: unknown[] = [];
  const h = harness(async (preparation, _model, _key, _headers, custom) => {
    instruction = custom ?? "";
    return { summary: "## Decisions\n- kept\n\n## Knowledge to share\n- [designer:standard] Buttons are 32px tall.\n- [backend:knowledge] The API lives under /api/<group>.<action>.\n- [ops:knowledge] dropped", firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: preparation.tokensBefore };
  }, { enabled: () => true, share: (items) => { shared.push(...items); return "1 for the designer, 1 for backend"; } });
  await h.check();
  assert.match(instruction, /Knowledge to share/);
  assert.deepEqual(shared, [
    { agent: "designer", kind: "standard", text: "Buttons are 32px tall." },
    { agent: "backend", kind: "knowledge", text: "The API lives under /api/<group>.<action>." },
  ]);
  assert.equal(h.notices.at(-1), "Knowledge updated: 1 for the designer, 1 for backend");
});

test("compactions pi starts itself get the checkpoint, with any /compact instructions, from pi's preparation", async () => {
  let instruction = "";
  const shared: unknown[] = [];
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
  const pi = { on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) => handlers.set(name, handler), getSettings: () => ({ retry: { enabled: false } }) } as unknown as ExtensionAPI;
  registerAutoCompaction(pi, async (preparation, _model, _key, _headers, custom) => {
    instruction = custom ?? "";
    return { summary: "## Knowledge to share\n- [qa:knowledge] Run the dark project too.", firstKeptEntryId: preparation.firstKeptEntryId, tokensBefore: preparation.tokensBefore };
  }, { enabled: () => true, share: (items) => { shared.push(...items); return "1 for QA"; } });
  const notices: string[] = [];
  const ctx = { model: { id: "m", provider: "test", contextWindow: 100_000 }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) }, ui: { notify: (message: string) => notices.push(message) } } as unknown as ExtensionContext;
  const preparation = { firstKeptEntryId: "7", messagesToSummarize: [], turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 90_000, fileOps: { read: new Set(), written: new Set(), edited: new Set() }, settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 } };
  const result = await handlers.get("session_before_compact")!({ type: "session_before_compact", preparation, branchEntries: [], customInstructions: "Focus on the API", reason: "threshold", willRetry: false, signal: new AbortController().signal }, ctx) as { compaction: { firstKeptEntryId: string } };
  assert.equal(result.compaction.firstKeptEntryId, "7");
  assert.match(instruction, /Unfinished work/);
  assert.match(instruction, /Focus on the API$/);
  assert.deepEqual(shared, [{ agent: "qa", kind: "knowledge", text: "Run the dark project too." }]);
  assert.deepEqual(notices, ["Knowledge updated: 1 for QA"]);
});

test("a checkpoint that fails leaves pi's own summary in place", async () => {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
  const pi = { on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) => handlers.set(name, handler), getSettings: () => ({}) } as unknown as ExtensionAPI;
  registerAutoCompaction(pi, async () => { throw new Error("provider unavailable"); }, { enabled: () => true, share: () => "" });
  const notices: string[] = [];
  const ctx = { model: { id: "m", provider: "test", contextWindow: 100_000 }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) }, ui: { notify: (message: string) => notices.push(message) } } as unknown as ExtensionContext;
  const result = await handlers.get("session_before_compact")!({ type: "session_before_compact", preparation: { firstKeptEntryId: "1" }, branchEntries: [], reason: "overflow", willRetry: true, signal: new AbortController().signal }, ctx);
  assert.equal(result, undefined);
  assert.match(notices[0]!, /using pi's summary: provider unavailable/);
});
