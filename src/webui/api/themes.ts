/**
 * The colour themes over HTTP: the saved list and the chosen one, shared by
 * every pi session and project (src/state/themes.ts). Each action answers with
 * the whole store, so the page shows exactly what was kept.
 */
import { chooseTheme, readThemes, removeTheme, renameTheme, saveTheme, type ThemeStore } from "../../state/themes.ts";
import { fail } from "./index.ts";

function guarded<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    return fail(400, "bad_request", (error as Error).message);
  }
}

export function themesGet(): ThemeStore {
  return readThemes();
}

export function themesSave(body: { name: string; light?: Record<string, string>; dark?: Record<string, string> }): ThemeStore & { id: string } {
  const theme = guarded(() => saveTheme(body));
  return { ...readThemes(), id: theme.id };
}

export function themesRename(body: { id: string; name: string }): ThemeStore {
  guarded(() => renameTheme(body.id, body.name));
  return readThemes();
}

export function themesRemove(body: { id: string }): ThemeStore {
  return guarded(() => removeTheme(body.id));
}

export function themesChoose(body: { id: string }): ThemeStore {
  return guarded(() => chooseTheme(body.id));
}
