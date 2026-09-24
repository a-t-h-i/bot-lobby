import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_CONFIG, resolveConfig, type DevHouseConfig } from "../schemas/configuration.ts";

const DEFAULT_CONFIG_DIR = ".pi";

/** Legacy per-project tree name; read-only fallback for pre-rename data. */
const LEGACY_DATA_DIR = "dev-house";

/** Read `current`, or `legacy` when only the latter exists. Calls never write the legacy path. */
function legacyReadPath(current: string, legacy: string): string {
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

/** Walk up to the nearest ancestor holding a config dir or git root. */
export function detectProjectRoot(cwd: string, configDir = DEFAULT_CONFIG_DIR): string {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, configDir)) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

/** Root of all per-project dev-lobby data: <root>/<configDir>/dev-lobby. Every write targets it. */
export function dataRoot(root: string, configDir = DEFAULT_CONFIG_DIR): string {
  return join(root, configDir, "dev-lobby");
}

/** Pre-rename per-project data root: <root>/<configDir>/dev-house. Read-only. */
export function legacyDataRoot(root: string, configDir = DEFAULT_CONFIG_DIR): string {
  return join(root, configDir, LEGACY_DATA_DIR);
}

/**
 * Roots that merged reads walk, newest first: the dev-lobby tree always, plus
 * the legacy dev-house tree while it exists. Readers take the first root that
 * has a task id or a knowledge file, so pre-rename data stays visible per task
 * and per file instead of vanishing as soon as any dev-lobby data exists.
 */
export function readDataRoots(root: string, configDir = DEFAULT_CONFIG_DIR): string[] {
  const legacy = legacyDataRoot(root, configDir);
  return existsSync(legacy) ? [dataRoot(root, configDir), legacy] : [dataRoot(root, configDir)];
}

/**
 * Root of the user-global dev-lobby config. Config is global so one setup
 * applies to every project; tasks and knowledge stay per-project. Tests point
 * `DEV_LOBBY_CONFIG_DIR` at a temp directory.
 */
export function globalConfigDir(): string {
  return process.env.DEV_LOBBY_CONFIG_DIR ?? join(homedir(), ".pi", "dev-lobby");
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

/**
 * Config source for reads: the dev-lobby config when it exists, otherwise the
 * legacy dev-house one. Explicit `DEV_LOBBY_CONFIG_DIR` overrides (tests,
 * custom setups) never fall back, so the legacy dir stays out of hermetic tests.
 */
function configSourcePath(): string {
  if (process.env.DEV_LOBBY_CONFIG_DIR !== undefined) return globalConfigPath();
  return legacyReadPath(globalConfigPath(), join(homedir(), ".pi", LEGACY_DATA_DIR, "config.json"));
}

/** Load the global config; fall back to defaults on any read/parse error. */
export function loadConfig(): DevHouseConfig {
  try {
    return resolveConfig(JSON.parse(readFileSync(configSourcePath(), "utf8")));
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Persist the global config through a temp file + rename so a crash cannot truncate it. */
export function saveConfig(config: DevHouseConfig): void {
  mkdirSync(globalConfigDir(), { recursive: true });
  const target = globalConfigPath();
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(tmp, target);
}
