/**
 * The web lobby's shortcuts in one table: every action has a default key, a
 * line for the help overlay, and can be rebound under `lobby.keys` in the
 * config (`{ "search": "alt+f" }`). Chords are written `alt+k`,
 * `ctrl+f`, `shift+tab`; the page matches them on the physical key.
 */

export const LOBBY_ACTIONS = {
  help: { key: "alt+h", help: "show or hide this list" },
  settings: { key: "alt+s", help: "settings: each agent's model and effort" },
  savePlan: { key: "ctrl+s", help: "save the plan from the Plan tab" },
  sidebar: { key: "alt+b", help: "fold or open the sidebar (on a phone, open it)" },
  activity: { key: "alt+a", help: "open or fold every step in the Lobby conversation" },
  thinking: { key: "alt+t", help: "show or hide Thinking on the Lobby" },
  terminal: { key: "ctrl+`", help: "show or hide the terminal" },
  nextTab: { key: "alt+]", help: "next tab" },
  prevTab: { key: "alt+[", help: "previous tab" },
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

/** `alt+k` reads `Alt+K` in hints and help. */
export function keyLabel(key: string): string {
  return key
    .split("+")
    .map((part) => (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join("+");
}
