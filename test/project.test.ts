import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectRoot, dataRoot, configPath, loadConfig } from "../src/state/project.ts";
import { DEFAULT_CONFIG } from "../src/schemas/configuration.ts";

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

test("dataRoot and configPath point inside <root>/<configDir>/dev-house", () => {
  assert.equal(dataRoot("/proj", ".pi"), "/proj/.pi/dev-house");
  assert.equal(configPath("/proj", ".pi"), "/proj/.pi/dev-house/config.json");
});

test("loadConfig merges partial user config over defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "dh-cfg-"));
  mkdirSync(join(root, ".pi", "dev-house"), { recursive: true });
  writeFileSync(join(root, ".pi", "dev-house", "config.json"), JSON.stringify({
    workflow: { maxReviewIterations: 5 },
    agents: { backend: { thinking: "low" } },
  }));
  const cfg = loadConfig(root, ".pi");
  assert.equal(cfg.workflow.maxReviewIterations, 5);
  assert.equal(cfg.workflow.maxParallelScouts, DEFAULT_CONFIG.workflow.maxParallelScouts);
  assert.equal(cfg.agents.backend.thinking, "low");
  assert.equal(cfg.agents.backend.model, "inherit");
  assert.equal(cfg.agents.designer.thinking, DEFAULT_CONFIG.agents.designer.thinking);
});

test("loadConfig falls back to defaults on malformed or missing config", () => {
  const root = mkdtempSync(join(tmpdir(), "dh-cfg2-"));
  assert.deepEqual(loadConfig(root, ".pi"), DEFAULT_CONFIG);
  mkdirSync(join(root, ".pi", "dev-house"), { recursive: true });
  writeFileSync(join(root, ".pi", "dev-house", "config.json"), "{not json");
  assert.deepEqual(loadConfig(root, ".pi"), DEFAULT_CONFIG);
});
