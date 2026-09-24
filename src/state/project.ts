import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_CONFIG, resolveConfig, type DevHouseConfig } from "../schemas/configuration.ts";

const DEFAULT_CONFIG_DIR = ".pi";

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

/** Root of all per-project dev-house data: <root>/<configDir>/dev-house. */
export function dataRoot(root: string, configDir = DEFAULT_CONFIG_DIR): string {
  return join(root, configDir, "dev-house");
}

/**
 * Root of the user-global dev-house config. Config is global so one setup
 * applies to every project; tasks and knowledge stay per-project. Tests point
 * `DEV_HOUSE_CONFIG_DIR` at a temp directory.
 */
export function globalConfigDir(): string {
  return process.env.DEV_HOUSE_CONFIG_DIR ?? join(homedir(), ".pi", "dev-house");
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

/** Load the global config; fall back to defaults on any read/parse error. */
export function loadConfig(): DevHouseConfig {
  try {
    return resolveConfig(JSON.parse(readFileSync(globalConfigPath(), "utf8")));
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
