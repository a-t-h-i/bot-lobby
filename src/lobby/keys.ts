/**
 * The lobby's shortcuts in one table: every action has a default key, a line
 * for the help overlay, and can be rebound under `lobby.keys` in the config
 * (`{ "toggleThinking": "alt+t" }`). They work in typing and browsing mode
 * alike, so each default is a key that never types a character.
 */
import { matchesKey, type KeyId } from "@earendil-works/pi-tui";

export const LOBBY_ACTIONS = {
  hide: { key: "alt+l", help: "hide the lobby (back to pi)" },
  help: { key: "alt+h", help: "show or hide these keys" },
  search: { key: "ctrl+f", help: "search the current tab" },
  nextTab: { key: "tab", help: "next tab" },
  prevTab: { key: "shift+tab", help: "previous tab" },
  toggleScene: { key: "alt+z", help: "show or hide the zen scene" },
  toggleConversation: { key: "alt+c", help: "show or hide the conversation" },
  toggleActivity: { key: "alt+a", help: "show or hide the activity log" },
  toggleThinking: { key: "alt+k", help: "show or hide thinking" },
  scrollUp: { key: "pageUp", help: "scroll up a page" },
  scrollDown: { key: "pageDown", help: "scroll down a page" },
} as const;

export type LobbyAction = keyof typeof LOBBY_ACTIONS;

export type KeyMap = Record<LobbyAction, string>;

/** Defaults with the config's overrides on top; unknown action names are ignored. */
export function keyMap(overrides: Readonly<Record<string, string>> = {}): KeyMap {
  const map = Object.fromEntries(Object.entries(LOBBY_ACTIONS).map(([action, entry]) => [action, entry.key])) as KeyMap;
  for (const [action, key] of Object.entries(overrides)) {
    if (action in map && key.trim()) map[action as LobbyAction] = key.trim().toLowerCase();
  }
  return map;
}

/** The action `data` triggers under `map`, if any. */
export function actionFor(data: string, map: KeyMap): LobbyAction | undefined {
  for (const action of Object.keys(map) as LobbyAction[]) {
    if (matchesKey(data, map[action] as KeyId)) return action;
  }
  return undefined;
}

/** `alt+k` reads `Alt+K` in hints and help. */
export function keyLabel(key: string): string {
  return key
    .split("+")
    .map((part) => (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join("+");
}
