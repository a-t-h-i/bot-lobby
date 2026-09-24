import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProjectRoot,
  dataRoot,
  legacyDataRoot,
  readDataRoots,
  globalConfigDir,
  globalConfigPath,
  loadConfig,
  saveConfig,
} from "../src/state/project.ts";
import { DEFAULT_CONFIG, INHERIT_THINKING, inheritThinking, resolveConfig } from "../src/schemas/configuration.ts";

/** Point the global config at a temp dir for the duration of one test. */
function withConfig(dir: string, run: () => void): void {
  const previous = process.env.DEV_LOBBY_CONFIG_DIR;
  process.env.DEV_LOBBY_CONFIG_DIR = dir;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.DEV_LOBBY_CONFIG_DIR;
    else process.env.DEV_LOBBY_CONFIG_DIR = previous;
  }
}

test("detectProjectRoot finds the nearest git/config root", () => {
  const root = mkdtempSync(join(tmpdir(), "dh-root-"));
  mkdirSync(join(root, ".git"));
  const nested = join(root, "a", "b");
  mkdirSync(nested, { recursive: true });
  assert.equal(detectProjectRoot(nested, ".pi"), root);
});

test("detectProjectRoot returns cwd when cwd itself is the root", () => {
  const root = mkdtempSync(join(tmpdir(), "dh-root2-"));
  mkdirSync(join(root, ".pi"));
  assert.equal(detectProjectRoot(root, ".pi"), root);
});

test("dataRoot points at <root>/<configDir>/dev-lobby", () => {
  assert.equal(dataRoot("/proj", ".pi"), "/proj/.pi/dev-lobby");
});

test("legacyDataRoot points at the pre-rename tree", () => {
  assert.equal(legacyDataRoot("/proj", ".pi"), "/proj/.pi/dev-house");
});

test("readDataRoots merges the legacy tree only while it exists", () => {
  const root = mkdtempSync(join(tmpdir(), "dh-roots-"));
  assert.deepEqual(readDataRoots(root, ".pi"), [join(root, ".pi", "dev-lobby")]);
  mkdirSync(join(root, ".pi", "dev-house"), { recursive: true });
  assert.deepEqual(readDataRoots(root, ".pi"), [join(root, ".pi", "dev-lobby"), join(root, ".pi", "dev-house")]);
});

test("global config points at the dev-lobby config dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-gcfg-"));
  withConfig(dir, () => {
    assert.equal(globalConfigDir(), dir);
    assert.equal(globalConfigPath(), join(dir, "config.json"));
  });
});

test("loadConfig reads the legacy dev-house config until a dev-lobby one exists", () => {
  const home = mkdtempSync(join(tmpdir(), "dh-home-"));
  const legacyDir = join(home, ".pi", "dev-house");
  const newDir = join(home, ".pi", "dev-lobby");
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ master: { thinking: "low" } }));
  const previousHome = process.env.HOME;
  const previousOverride = process.env.DEV_LOBBY_CONFIG_DIR;
  delete process.env.DEV_LOBBY_CONFIG_DIR;
  process.env.HOME = home;
  try {
    assert.equal(loadConfig().master.thinking, "low");
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, "config.json"), JSON.stringify({ master: { thinking: "max" } }));
    assert.equal(loadConfig().master.thinking, "max");
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousOverride !== undefined) process.env.DEV_LOBBY_CONFIG_DIR = previousOverride;
  }
});

test("loadConfig merges partial user config over defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-cfg-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    workflow: { maxReviewIterations: 5 },
    agents: { backend: { thinking: "low", instructions: "Prefer pure functions." } },
  }));
  withConfig(dir, () => {
    const cfg = loadConfig();
    assert.equal(cfg.workflow.maxReviewIterations, 5);
    assert.equal(cfg.workflow.maxParallelScouts, DEFAULT_CONFIG.workflow.maxParallelScouts);
    assert.equal(cfg.agents.backend.thinking, "low");
    assert.equal(cfg.agents.backend.model, "inherit");
    assert.equal(cfg.agents.backend.instructions, "Prefer pure functions.");
    assert.equal(cfg.agents.designer.thinking, DEFAULT_CONFIG.agents.designer.thinking);
    assert.equal(cfg.agents.designer.instructions, "");
  });
});

test("loadConfig rejects an unknown thinking level", () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-cfg-bad-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ master: { thinking: "turbo" }, agents: { qa: { thinking: "turbo" } } }));
  withConfig(dir, () => {
    const cfg = loadConfig();
    assert.equal(cfg.master.thinking, DEFAULT_CONFIG.master.thinking);
    assert.equal(cfg.agents.qa.thinking, DEFAULT_CONFIG.agents.qa.thinking);
  });
});

test("loadConfig falls back to defaults on malformed or missing config", () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-cfg2-"));
  withConfig(dir, () => assert.deepEqual(loadConfig(), DEFAULT_CONFIG));
  writeFileSync(join(dir, "config.json"), "{not json");
  withConfig(dir, () => assert.deepEqual(loadConfig(), DEFAULT_CONFIG));
});

test("saveConfig round-trips through loadConfig", () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-cfg3-"));
  withConfig(dir, () => {
    const config = resolveConfig({
      master: { model: "deepseek/deepseek-v4-pro", thinking: "max", instructions: "Be terse." },
    });
    saveConfig(config);
    assert.deepEqual(loadConfig(), config);
  });
});

test("resolveConfig keeps the inherit thinking sentinel but still rejects unknown levels", () => {
  const cfg = resolveConfig({ agents: { designer: { thinking: INHERIT_THINKING }, backend: { thinking: "turbo" } } });
  assert.equal(cfg.agents.designer.thinking, INHERIT_THINKING);
  assert.equal(DEFAULT_CONFIG.agents.designer.thinking, INHERIT_THINKING);
  assert.equal(cfg.agents.backend.thinking, DEFAULT_CONFIG.agents.backend.thinking);
});

test("inheritThinking resolves inherit agents from the live session level", () => {
  const cfg = inheritThinking(DEFAULT_CONFIG, "low");
  assert.equal(cfg.agents.designer.thinking, "low");
  assert.equal(cfg.agents.backend.thinking, "low");
  assert.equal(cfg.agents.qa.thinking, "low");
  assert.equal(cfg.master.thinking, DEFAULT_CONFIG.master.thinking);
  assert.equal(DEFAULT_CONFIG.agents.designer.thinking, INHERIT_THINKING, "input is not mutated");
  assert.notEqual(cfg.agents, DEFAULT_CONFIG.agents);
  assert.notEqual(cfg.agents.designer, DEFAULT_CONFIG.agents.designer);
});

test("inheritThinking omits the flag for a missing or invalid level and leaves explicit levels alone", () => {
  for (const level of [undefined, "turbo"]) {
    const cfg = inheritThinking(DEFAULT_CONFIG, level);
    assert.equal(cfg.agents.designer.thinking, "");
    assert.equal(cfg.agents.qa.thinking, "");
  }
  const explicit = resolveConfig({ agents: { qa: { thinking: "max" } } });
  assert.equal(inheritThinking(explicit, "low").agents.qa.thinking, "max");
});
