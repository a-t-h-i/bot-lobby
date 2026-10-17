import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blocksConfiguredAction } from "../webui/src/app/keyGuards.ts";
import { initiallyCollapsed } from "../webui/src/lib/panePreference.ts";
import { sessionEntries } from "../webui/src/app/sessionList.ts";

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

test("the sidebar remembers the user's pick and, unpicked, folds only on a narrow window", () => {
  assert.equal(initiallyCollapsed("app.sidebar", "1"), true);
  assert.equal(initiallyCollapsed("app.sidebar", "0"), false);
  const media = (globalThis as { matchMedia?: unknown }).matchMedia;
  try {
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: true });
    assert.equal(initiallyCollapsed("app.sidebar"), true);
    assert.equal(initiallyCollapsed("app.sidebar", "0"), false, "a pick wins over the width");
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
    assert.equal(initiallyCollapsed("app.sidebar", null), false);
  } finally {
    (globalThis as { matchMedia?: unknown }).matchMedia = media;
  }
});

test("the sidebar lists this window first, then its background sessions, then other terminals, each once", () => {
  const background = [
    { key: "S2", name: "Old run", status: "exited", busy: false, alive: false, sessionId: "s-old", waiting: 0, dialogs: [] },
    { key: "S1", name: "Fix the parser", status: "working", busy: true, alive: true, sessionId: "s-bg", waiting: 2, dialogs: [] },
    { key: "S3", name: "Mirror of here", status: "idle", busy: false, alive: true, sessionId: "s-here", waiting: 0, dialogs: [] },
  ] as never[];
  const live = [
    { sessionId: "s-bg", pid: 1, mode: "rpc" },
    { sessionId: "s-tui", pid: 2, name: "Terminal two", mode: "tui" },
    { sessionId: "s-here", pid: 3, mode: "tui" },
  ] as never[];
  const entries = sessionEntries({ sessionId: "s-here", sessionName: "main", busy: true }, { background, live });
  assert.deepEqual(entries.map((entry) => [entry.name, entry.where, entry.state]), [
    ["main", "here", "working"],
    ["Fix the parser", "background", "asking"],
    ["Old run", "background", "exited"],
    ["Terminal two", "elsewhere", "idle"],
  ]);
  assert.equal(sessionEntries(undefined, undefined)[0]!.name, "This window");
});
