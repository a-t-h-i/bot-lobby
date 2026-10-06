/**
 * The colour themes the user saved, and which theme is chosen, kept in the
 * user-global config folder (`themes.json` beside `config.json`): every pi
 * session and every project's lobby page reads the same list, whatever port
 * or folder it runs from. A theme is checked on the way in and on the way out
 * with the same filter as an import, so the file can only ever recolour the
 * page.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { globalConfigDir } from "./project.ts";
import { cleanVars, PRESETS, type Vars } from "../webui/palette-core.ts";

export interface SavedTheme {
  /** `saved-…`: never one of the page's own theme ids. */
  id: string;
  name: string;
  light?: Vars;
  dark?: Vars;
  savedAt: string;
}

export interface ThemeStore {
  themes: SavedTheme[];
  /** The chosen theme: one of the page's own or a saved one; absent means the default. */
  active?: string;
}

/** Saved themes kept; saving one more lets the oldest go. */
export const MAX_SAVED_THEMES = 24;
export const MAX_THEME_NAME = 40;
const SAVED_ID = /^saved-[a-z0-9]{6,20}$/;

export function themesPath(): string {
  return join(globalConfigDir(), "themes.json");
}

/** A theme name as kept: one line, trimmed, at most 40 characters; empty is refused. */
export function themeName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_THEME_NAME).trim();
  if (!name) throw new Error("a theme needs a name");
  return name;
}

function cleanTheme(value: unknown): SavedTheme | undefined {
  const theme = value as Partial<SavedTheme> | undefined;
  if (!theme || typeof theme.id !== "string" || !SAVED_ID.test(theme.id) || typeof theme.name !== "string") return undefined;
  const light = cleanVars(theme.light);
  const dark = cleanVars(theme.dark);
  if (!light && !dark) return undefined;
  let name: string;
  try {
    name = themeName(theme.name);
  } catch {
    return undefined;
  }
  return { id: theme.id, name, ...(light ? { light } : {}), ...(dark ? { dark } : {}), savedAt: typeof theme.savedAt === "string" ? theme.savedAt : new Date(0).toISOString() };
}

function knownId(store: ThemeStore, id: string): boolean {
  return PRESETS.some((preset) => preset.id === id) || store.themes.some((theme) => theme.id === id);
}

/** The saved themes and the chosen one; a missing or torn file reads as none. */
export function readThemes(): ThemeStore {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(themesPath(), "utf8"));
  } catch {
    return { themes: [] };
  }
  const value = raw as { themes?: unknown; active?: unknown };
  const seen = new Set<string>();
  const themes = (Array.isArray(value.themes) ? value.themes : []).map(cleanTheme).filter((theme): theme is SavedTheme => {
    if (!theme || seen.has(theme.id)) return false;
    seen.add(theme.id);
    return true;
  }).slice(-MAX_SAVED_THEMES);
  const store: ThemeStore = { themes };
  if (typeof value.active === "string" && knownId(store, value.active)) store.active = value.active;
  return store;
}

function writeThemes(store: ThemeStore): ThemeStore {
  const path = themesPath();
  mkdirSync(globalConfigDir(), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return store;
}

/** Save a theme under a name and choose it; returns the saved theme. */
export function saveTheme(input: { name: string; light?: unknown; dark?: unknown }, now = new Date()): SavedTheme {
  const light = cleanVars(input.light);
  const dark = cleanVars(input.dark);
  if (!light && !dark) throw new Error("that theme sets no colours the page can use");
  const theme: SavedTheme = { id: `saved-${randomBytes(6).toString("hex")}`, name: themeName(input.name), ...(light ? { light } : {}), ...(dark ? { dark } : {}), savedAt: now.toISOString() };
  const store = readThemes();
  writeThemes({ themes: [...store.themes, theme].slice(-MAX_SAVED_THEMES), active: theme.id });
  return theme;
}

export function renameTheme(id: string, name: string): SavedTheme {
  const store = readThemes();
  const theme = store.themes.find((entry) => entry.id === id);
  if (!theme) throw new Error("no such saved theme");
  theme.name = themeName(name);
  writeThemes(store);
  return theme;
}

/** Remove a saved theme; the page's default comes back if it was the chosen one. */
export function removeTheme(id: string): ThemeStore {
  const store = readThemes();
  if (!store.themes.some((theme) => theme.id === id)) throw new Error("no such saved theme");
  const themes = store.themes.filter((theme) => theme.id !== id);
  return writeThemes({ themes, ...(store.active && store.active !== id ? { active: store.active } : {}) });
}

/** Choose a theme for every page, in every session. */
export function chooseTheme(id: string): ThemeStore {
  const store = readThemes();
  if (!knownId(store, id)) throw new Error("no such theme");
  return writeThemes({ ...store, active: id });
}
