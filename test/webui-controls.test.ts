import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blocksConfiguredAction } from "../webui/src/app/keyGuards.ts";
import { initiallyCollapsed } from "../webui/src/lib/panePreference.ts";

const source = (path: string) => readFileSync(new URL(`../webui/src/${path}`, import.meta.url), "utf8");

test("configured actions respect text entry, overlays and disabled plan save", () => {
  const ready = { overlay: false, typing: false, saveAvailable: true };
  assert.equal(blocksConfiguredAction("thinking", ready), false);
  assert.equal(blocksConfiguredAction("thinking", { ...ready, typing: true }), true);
  assert.equal(blocksConfiguredAction(undefined, { ...ready, typing: true }), true, "tab accelerators do not steal typing");
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
  assert.match(thoughts, /Minimize <kbd/);
  assert.match(source("index.css"), /prefers-reduced-motion: reduce\) \{ \.thinking-bubble/);
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
