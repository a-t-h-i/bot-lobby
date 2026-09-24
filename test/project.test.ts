import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProjectRoot,
  dataRoot,
  globalConfigDir,
  globalConfigPath,
  loadConfig,
  saveConfig,
} from "../src/state/project.ts";
import { DEFAULT_CONFIG, resolveConfig } from "../src/schemas/configuration.ts";

/** Point the global config at a temp dir for the duration of one test. */
function withConfig(dir: string, run: () => void): void {
  const previous = process.env.DEV_HOUSE_CONFIG_DIR;
  process.env.DEV_HOUSE_CONFIG_DIR = dir;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.DEV_HOUSE_CONFIG_DIR;
    else process.env.DEV_HOUSE_CONFIG_DIR = previous;
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

test("dataRoot stays inside <root>/<configDir>/dev-house", () => {
  assert.equal(dataRoot("/proj", ".pi"), "/proj/.pi/dev-house");
});

test("global config points at the dev-house config dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "dh-gcfg-"));
  withConfig(dir, () => {
    assert.equal(globalConfigDir(), dir);
    assert.equal(globalConfigPath(), join(dir, "config.json"));
  });
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
