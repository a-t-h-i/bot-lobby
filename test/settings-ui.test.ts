import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { SelectItem } from "@earendil-works/pi-tui";
import { initTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { SearchPicker, filterItems, modelItems } from "../src/pi/settings-ui.ts";

// The suite can run inside a subagent process (BOT_LOBBY_SUBAGENT=1); park the
// ambient flag so module import-time reads are deterministic, and restore it.
let ambientSubagent: string | undefined;
before(() => {
  ambientSubagent = process.env.BOT_LOBBY_SUBAGENT;
  delete process.env.BOT_LOBBY_SUBAGENT;
});
after(() => {
  if (ambientSubagent === undefined) delete process.env.BOT_LOBBY_SUBAGENT;
  else process.env.BOT_LOBBY_SUBAGENT = ambientSubagent;
});

const INHERIT: SelectItem = { value: "__inherit__", label: "inherit", description: "Use the session's current model" };
const ANTHROPIC: SelectItem = { value: "anthropic/claude-sonnet-4", label: "anthropic/claude-sonnet-4" };
const OPENAI: SelectItem = { value: "openai/gpt-5", label: "openai/gpt-5" };
const GOOGLE: SelectItem = { value: "google/gemini-2.5-pro", label: "google/gemini-2.5-pro" };
const CUSTOM: SelectItem = { value: "__custom__", label: "custom…", description: "Type a provider/model id" };
const ITEMS: SelectItem[] = [INHERIT, ANTHROPIC, OPENAI, GOOGLE, CUSTOM];

test("filterItems matches a provider substring", () => {
  assert.deepEqual(filterItems(ITEMS, "anthro"), [ANTHROPIC]);
  assert.deepEqual(filterItems(ITEMS, "google/gemini"), [GOOGLE]);
});

test("filterItems matches a model name", () => {
  assert.deepEqual(filterItems(ITEMS, "sonnet"), [ANTHROPIC]);
  assert.deepEqual(filterItems(ITEMS, "gpt-5"), [OPENAI]);
});

test("filterItems is case-insensitive", () => {
  assert.deepEqual(filterItems(ITEMS, "ANTHRO"), [ANTHROPIC]);
  assert.deepEqual(filterItems(ITEMS, "GeMiNi"), [GOOGLE]);
});

test("a blank query returns every item unchanged and in order", () => {
  assert.equal(filterItems(ITEMS, ""), ITEMS);
  assert.equal(filterItems(ITEMS, "   "), ITEMS);
  assert.deepEqual(filterItems(ITEMS, ""), ITEMS);
});

test("a query with no match returns an empty list", () => {
  assert.deepEqual(filterItems(ITEMS, "zzqzzq"), []);
});

test("inherit and custom… stay reachable by search and when cleared", () => {
  assert.deepEqual(filterItems(ITEMS, "inherit"), [INHERIT]);
  assert.deepEqual(filterItems(ITEMS, "custom"), [CUSTOM]);
  assert.ok(filterItems(ITEMS, "").includes(INHERIT));
  assert.ok(filterItems(ITEMS, "").includes(CUSTOM));
});

function ctxWithModels(models: unknown[]): ExtensionContext {
  return { scopedModels: models.map((model) => ({ model })), modelRegistry: { getAvailable: () => [] } } as unknown as ExtensionContext;
}

test("modelItems exposes a distinct display name as a searchable description", () => {
  const items = modelItems(ctxWithModels([{ provider: "anthropic", id: "claude-3-opus-20240229", name: "Opus Zephyr" }]), "");
  const item = items.find((entry) => entry.value === "anthropic/claude-3-opus-20240229");
  assert.ok(item);
  assert.equal(item.description, "Opus Zephyr");
  assert.deepEqual(filterItems(items, "zephyr"), [item]);
});

test("modelItems omits the description when the display name equals the value", () => {
  const items = modelItems(ctxWithModels([{ provider: "openai", id: "gpt-5", name: "openai/gpt-5" }]), "");
  const item = items.find((entry) => entry.value === "openai/gpt-5");
  assert.ok(item);
  assert.equal(item.description, undefined);
});

before(() => initTheme());

const THEME = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;

function pickerHarness(): { picker: SearchPicker; results: (string | undefined)[] } {
  const results: (string | undefined)[] = [];
  const picker = new SearchPicker("Model", ITEMS, THEME, (value) => results.push(value), () => {});
  return { picker, results };
}

function typeQuery(picker: SearchPicker, text: string): void {
  for (const char of text) picker.handleInput(char);
}

function clearQuery(picker: SearchPicker, length: number): void {
  for (let i = 0; i < length; i++) picker.handleInput("\x7f");
}

test("typing a query narrows the list and enter selects the filtered item", () => {
  const { picker, results } = pickerHarness();
  typeQuery(picker, "gemini");
  picker.handleInput("\r");
  assert.deepEqual(results, [GOOGLE.value]);
});

test("down arrow selects the second item and confirm picks it", () => {
  const { picker, results } = pickerHarness();
  picker.handleInput("\x1b[B");
  picker.handleInput("\r");
  assert.deepEqual(results, [ANTHROPIC.value]);
});

test("a cursor-only key keeps the highlighted item after the query is cleared", () => {
  const { picker, results } = pickerHarness();
  typeQuery(picker, "openai");
  clearQuery(picker, "openai".length);
  picker.handleInput("\x1b[B");
  picker.handleInput("\x1b[C");
  picker.handleInput("\r");
  assert.deepEqual(results, [ANTHROPIC.value]);
});

test("up arrow from the top wraps to the last item", () => {
  const { picker, results } = pickerHarness();
  picker.handleInput("\x1b[A");
  picker.handleInput("\r");
  assert.deepEqual(results, [CUSTOM.value]);
});

test("escape cancels the picker", () => {
  const { picker, results } = pickerHarness();
  picker.handleInput("\x1b");
  assert.deepEqual(results, [undefined]);
});

test("a no-match query is not selectable and clearing restores inherit and custom…", () => {
  const { picker, results } = pickerHarness();
  typeQuery(picker, "zzqzzq");
  picker.handleInput("\r");
  assert.deepEqual(results, []);
  clearQuery(picker, "zzqzzq".length);
  const rendered = picker.render(60).join("\n");
  assert.match(rendered, /inherit/);
  assert.match(rendered, /custom/);
  picker.handleInput("\r");
  assert.deepEqual(results, [INHERIT.value]);
});

test("render shows the no-match text for a zero-match query", () => {
  const { picker } = pickerHarness();
  typeQuery(picker, "zzqzzq");
  assert.match(picker.render(60).join("\n"), /No matching commands/);
});

// --- profiles: scouts have fixed thinking, subagents never inherit a model ---

import { entryItems, patchEntry, prefillModels, thinkingItems } from "../src/pi/settings-ui.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";

test("the scout entry offers model and time limit but no thinking choice", () => {
  const values = entryItems("scout", { model: "p/fast", timeoutMs: 480_000 }).map((item) => item.value);
  assert.ok(values.includes("model") && values.includes("timeout"));
  assert.ok(!values.includes("thinking"));
  assert.ok(values.includes("fixed"), "the fixed level is still shown");
  for (const kind of ["master", "designer", "backend", "qa", "researcher"] as const) {
    assert.ok(entryItems(kind, { model: "m", thinking: "medium" }).some((item) => item.value === "thinking"), kind);
  }
});

test("patchEntry never stores a thinking level on scouts", () => {
  const next = patchEntry(DEFAULT_CONFIG, "scout", { model: "p/fast", thinking: "max" });
  assert.deepEqual(next.scout, { model: "p/fast", timeoutMs: DEFAULT_CONFIG.scout.timeoutMs });
  assert.equal(patchEntry(DEFAULT_CONFIG, "researcher", { thinking: "high" }).researcher.thinking, "high");
  assert.equal(DEFAULT_CONFIG.researcher.thinking, "low", "the input is not mutated");
});

test("prefillModels pins every unset subagent model to the session model and leaves set ones", () => {
  const config = resolveConfig({ agents: { qa: { model: "p/qa" } } });
  const { config: next, filled } = prefillModels(config, "p/session");
  assert.deepEqual(filled, ["designer", "backend", "scout", "researcher"]);
  assert.equal(next.agents.qa.model, "p/qa");
  assert.equal(next.agents.designer.model, "p/session");
  assert.equal(next.scout.model, "p/session");
  assert.equal(next.master.model, "inherit", "the master is the session itself");
  assert.deepEqual(prefillModels(config, undefined).filled, []);
});

test("thinking choices are the supported levels with the current one ticked", () => {
  const items = thinkingItems(["off", "low", "high"], "low");
  assert.deepEqual(items.map((item) => item.value), ["off", "low", "high"]);
  assert.equal(items[1]!.label, "low ✓");
});

test("subagent model pickers do not offer inherit", () => {
  const ctx = ctxWithModels([{ provider: "p", id: "m", name: "m" }]);
  assert.ok(!modelItems(ctx, "p/m", false).some((item) => item.value === "inherit"));
  assert.ok(modelItems(ctx, "p/m").some((item) => item.value === "inherit"));
});
