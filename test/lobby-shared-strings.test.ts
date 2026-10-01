import { test } from "node:test";
import assert from "node:assert/strict";
import { Key } from "@earendil-works/pi-tui";
import { ANSWERED_IN_TERMINAL, NARROW_WINDOW, PI_ASKING_IN_TERMINAL, TAB_IDS, TAB_LABELS, visibleTabs } from "../src/lobby/prompts.ts";
import { TAB_IDS as VIEW_TAB_IDS, TAB_LABELS as VIEW_TAB_LABELS, visibleTabs as viewVisibleTabs } from "../src/lobby/view.ts";
import { keyMap, tabJumpKey, webKeyMap } from "../src/lobby/keys.ts";

test("TAB_IDS keeps the lobby's tab order", () => {
  assert.deepEqual([...TAB_IDS], ["lobby", "tasks", "plan", "quickfix", "issues", "metrics", "git", "knowledge", "excalidraw"]);
});

test("TAB_LABELS keeps the lobby's tab names", () => {
  assert.deepEqual({ ...TAB_LABELS }, {
    lobby: "Lobby",
    tasks: "Tasks",
    plan: "Plan",
    quickfix: "Quick fix",
    issues: "Issues",
    metrics: "Metrics",
    git: "Git",
    knowledge: "Knowledge",
    excalidraw: "Excalidraw",
  });
});

test("visibleTabs hides only Issues while it is switched off", () => {
  assert.deepEqual(visibleTabs(false), ["lobby", "tasks", "plan", "quickfix", "metrics", "git", "knowledge", "excalidraw"]);
  assert.deepEqual(visibleTabs(true), [...TAB_IDS]);
});

test("view.ts re-exports the shared tab metadata", () => {
  assert.deepEqual(VIEW_TAB_IDS, TAB_IDS);
  assert.deepEqual(VIEW_TAB_LABELS, TAB_LABELS);
  assert.deepEqual(viewVisibleTabs(false), visibleTabs(false));
  assert.deepEqual(viewVisibleTabs(true), visibleTabs(true));
});

test("tabJumpKey yields the TUI's Alt+digit key", () => {
  for (let index = 0; index < TAB_IDS.length; index++) {
    assert.equal(tabJumpKey(index), Key.alt(String(index + 1) as "1"));
  }
});

test("webKeyMap keeps every default and cycles tabs with alt+[ / alt+]", () => {
  const base = keyMap();
  const web = webKeyMap();
  for (const [action, key] of Object.entries(base)) {
    if (action === "nextTab" || action === "prevTab") continue;
    assert.equal(web[action as keyof typeof web], key);
  }
  assert.equal(web.nextTab, "alt+]");
  assert.equal(web.prevTab, "alt+[");
});

test("webKeyMap honours user overrides", () => {
  assert.equal(webKeyMap({ nextTab: "ctrl+x" }).nextTab, "ctrl+x");
  assert.equal(webKeyMap({ prevTab: "ctrl+y" }).prevTab, "ctrl+y");
  assert.equal(webKeyMap({ nextTab: "ctrl+x" }).prevTab, "alt+[");
});

test("shared status lines are plain wording", () => {
  assert.equal(typeof ANSWERED_IN_TERMINAL, "string");
  assert.equal(typeof PI_ASKING_IN_TERMINAL, "string");
  assert.equal(typeof NARROW_WINDOW, "string");
  assert.ok(ANSWERED_IN_TERMINAL.length > 0 && PI_ASKING_IN_TERMINAL.length > 0 && NARROW_WINDOW.length > 0);
});
