import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blocksConfiguredAction } from "../webui/src/app/keyGuards.ts";
import { initiallyCollapsed } from "../webui/src/lib/panePreference.ts";

const source = (path: string) => readFileSync(new URL(`../webui/src/${path}`, import.meta.url), "utf8");

test("configured actions work while typing, never behind an overlay, and plan save needs a plan", () => {
  const ready = { overlay: false, typing: false, saveAvailable: true };
  assert.equal(blocksConfiguredAction("thinking", ready), false);
  assert.equal(blocksConfiguredAction("thinking", { ...ready, typing: true }), false, "a chord types nothing, so it works from the message box");
  assert.equal(blocksConfiguredAction(undefined, { ...ready, typing: true }), false, "tab accelerators work from the message box");
  assert.equal(blocksConfiguredAction(undefined, { ...ready, overlay: true }), true, "but never behind a dialog");
  assert.equal(blocksConfiguredAction("savePlan", { ...ready, typing: true }), false, "editor save remains deliberate");
  assert.equal(blocksConfiguredAction("savePlan", { ...ready, saveAvailable: false }), true);
  assert.equal(blocksConfiguredAction("savePlan", { ...ready, overlay: true }), true);
});

test("Thinking starts minimized regardless of legacy preference; Activity still persists", () => {
  for (const stored of [undefined, null, "0", "1"]) assert.equal(initiallyCollapsed("lobby.thinking", stored), true);
  assert.equal(initiallyCollapsed("lobby.activity", "1"), true);
  assert.equal(initiallyCollapsed("lobby.activity", "0"), false);
  assert.equal(initiallyCollapsed("lobby.activity"), false);
  const thoughts = source("tabs/lobby/Thoughts.tsx");
  assert.match(thoughts, /latestThoughts\(thoughts\)/);
  assert.match(thoughts, /label="Thinking"/);
  assert.match(thoughts, /onCloseAutoFocus/);
  assert.doesNotMatch(thoughts, /Minimize|<header|<h2/, "the pane has no title bar and no minimize hint");
  assert.match(thoughts, /thoughtSteps\(thought\.text\)/);
  assert.match(source("index.css"), /prefers-reduced-motion: reduce\) \{\s*\.thinking-bubble/);
});

test("all five Settings sections remain mounted behind hidden wrappers", () => {
  const settings = source("tabs/settings/SettingsForm.tsx");
  for (const name of ["Agents", "Workflow", "Lobby", "Classifier", "Appearance & notifications"]) {
    assert.ok(settings.includes(`hidden={section !== "${name}"}`));
    assert.ok(settings.includes(`aria-hidden={section !== "${name}"}`));
  }
  assert.doesNotMatch(settings, /fallbackModel|fallbackThinking|chooseFallback/);
  assert.match(settings, /<ThemeGroup \/><NotificationsGroup \/><InstallGroup \/>/);
  assert.doesNotMatch(source("app/ProjectSwitcher.tsx"), /<select\b/);
});
