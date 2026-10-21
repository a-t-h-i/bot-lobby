import { test } from "node:test";
import assert from "node:assert/strict";
import { ANSWERED_ELSEWHERE, TAB_IDS, TAB_LABELS, visibleTabs } from "../src/lobby/prompts.ts";
import { keyMap, keyLabel, LOBBY_ACTIONS } from "../src/lobby/keys.ts";

test("TAB_IDS keeps the lobby's tab order", () => {
  assert.deepEqual([...TAB_IDS], ["lobby", "tasks", "plan", "git", "knowledge"]);
});

test("TAB_LABELS keeps the lobby's tab names", () => {
  assert.deepEqual({ ...TAB_LABELS }, {
    lobby: "Lobby",
    tasks: "Tasks",
    plan: "Plan",
    git: "Git",
    knowledge: "Knowledge",
  });
});

test("Git remains visible while Issues is switched off", () => {
  assert.deepEqual(visibleTabs(false), ["lobby", "tasks", "plan", "git", "knowledge"]);
  assert.deepEqual(visibleTabs(true), [...TAB_IDS]);
});

test("the key map cycles tabs with alt+[ / alt+] and honours overrides", () => {
  const map = keyMap();
  assert.equal(map.nextTab, "alt+]");
  assert.equal(map.prevTab, "alt+[");
  assert.equal(keyMap({ nextTab: "ctrl+x" }).nextTab, "ctrl+x");
  assert.equal(keyMap({ nextTab: "ctrl+x" }).prevTab, "alt+[");
  assert.equal(keyMap({ bogus: "ctrl+y" } as never).help, LOBBY_ACTIONS.help.key, "unknown actions are ignored");
  assert.equal(keyLabel("alt+]"), "Alt+]");
  assert.equal(keyLabel("shift+tab"), "Shift+Tab");
});

test("the shared notice is plain wording", () => {
  assert.ok(ANSWERED_ELSEWHERE.length > 0);
});
