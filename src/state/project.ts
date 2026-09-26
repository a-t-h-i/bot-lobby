import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_CONFIG, resolveConfig, type BotLobbyConfig } from "../schemas/configuration.ts";

const DEFAULT_CONFIG_DIR = ".pi";

/** Live per-project tree name; every write targets it. */
const DATA_DIR = "bot-lobby";

/** Pre-rename per-project tree names, newest first; read-only fallbacks. */
const LEGACY_DATA_DIRS = ["dev-lobby", "dev-house"] as const;

type LegacyDataDir = (typeof LEGACY_DATA_DIRS)[number];

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

/** Root of all per-project bot-lobby data: <root>/<configDir>/bot-lobby. Every write targets it. */
export function dataRoot(root: string, configDir = DEFAULT_CONFIG_DIR): string {
  return join(root, configDir, DATA_DIR);
}

/** One pre-rename per-project root by tree name; read-only. */
export function legacyDataRoot(root: string, configDir = DEFAULT_CONFIG_DIR, name: LegacyDataDir = LEGACY_DATA_DIRS[0]): string {
  return join(root, configDir, name);
}

/** Pre-rename trees that exist on disk, newest first. */
function existingLegacyRoots(root: string, configDir: string): string[] {
  return LEGACY_DATA_DIRS.map((name) => legacyDataRoot(root, configDir, name)).filter((dir) => existsSync(dir));
}

/**
 * Roots that merged reads walk, newest first: the bot-lobby tree always, then
 * every existing pre-rename tree (dev-lobby, then dev-house). Readers take the
 * first root that has a task id or a knowledge file, so pre-rename data stays
 * visible per task and per file instead of vanishing as soon as any bot-lobby
 * data exists.
 */
export function readDataRoots(root: string, configDir = DEFAULT_CONFIG_DIR): string[] {
  return [dataRoot(root, configDir), ...existingLegacyRoots(root, configDir)];
}

/** Newest existing pre-rename tree, if any; seeding reads it, writes never touch it. */
export function firstLegacyDataRoot(root: string, configDir = DEFAULT_CONFIG_DIR): string | undefined {
  return existingLegacyRoots(root, configDir)[0];
}

/**
 * Root of the user-global bot-lobby config. Config is global so one setup
 * applies to every project; tasks and knowledge stay per-project. Tests point
 * `BOT_LOBBY_CONFIG_DIR` at a temp directory.
 */
export function globalConfigDir(): string {
  return process.env.BOT_LOBBY_CONFIG_DIR ?? join(homedir(), ".pi", "bot-lobby");
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

/**
 * Config source for reads: the bot-lobby config when it exists, otherwise the
 * newest existing pre-rename one (dev-lobby, then dev-house). An explicit
 * `BOT_LOBBY_CONFIG_DIR` overrides (tests, custom setups) and never falls back,
 * so legacy dirs stay out of hermetic tests.
 */
function configSourcePath(): string {
  if (process.env.BOT_LOBBY_CONFIG_DIR !== undefined) return globalConfigPath();
  const candidates = [globalConfigPath(), ...LEGACY_DATA_DIRS.map((dir) => join(homedir(), ".pi", dir, "config.json"))];
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}

/** The config file as written, unresolved; undefined when missing or unreadable. */
export function readRawConfig(): unknown {
  try {
    return JSON.parse(readFileSync(configSourcePath(), "utf8"));
  } catch {
    return undefined;
  }
}

/** Load the global config; fall back to defaults on any read/parse error. */
export function loadConfig(): BotLobbyConfig {
  try {
    return resolveConfig(JSON.parse(readFileSync(configSourcePath(), "utf8")));
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Persist the global config through a temp file + rename so a crash cannot truncate it. */
export function saveConfig(config: BotLobbyConfig): void {
  mkdirSync(globalConfigDir(), { recursive: true });
  const target = globalConfigPath();
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(tmp, target);
}
