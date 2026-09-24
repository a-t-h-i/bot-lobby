import { existsSync, readFileSync } from "node:fs";
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

/** Root of all dev-house data for a project: <root>/<configDir>/dev-house. */
export function dataRoot(root: string, configDir = DEFAULT_CONFIG_DIR): string {
  return join(root, configDir, "dev-house");
}

export function configPath(root: string, configDir = DEFAULT_CONFIG_DIR): string {
  return join(dataRoot(root, configDir), "config.json");
}

/** Load and resolve config; fall back to defaults on any read/parse error. */
export function loadConfig(root: string, configDir = DEFAULT_CONFIG_DIR): DevHouseConfig {
  try {
    return resolveConfig(JSON.parse(readFileSync(configPath(root, configDir), "utf8")));
  } catch {
    return DEFAULT_CONFIG;
  }
}
