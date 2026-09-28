/**
 * pi's theme as bot-lobby draws with it (the lobby, the questionnaire), plus
 * Markdown rendering; one wrapper (and one Markdown renderer with its cache)
 * per theme, so caches stay warm and a theme switch starts fresh.
 */
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { LobbyTheme } from "./layout.ts";
import { createMarkdownRenderer } from "./markdown.ts";

const lobbyThemes = new WeakMap<Theme, LobbyTheme>();

export function lobbyTheme(theme: Theme): LobbyTheme {
  let wrapped = lobbyThemes.get(theme);
  if (!wrapped) {
    wrapped = {
      fg: (color, text) => theme.fg(color, text),
      bold: (text) => theme.bold(text),
      italic: (text) => theme.italic(text),
      bg: (color, text) => theme.bg(color, text),
      // The same looks pi gives your messages and the thinking it shows.
      markdown: createMarkdownRenderer(getMarkdownTheme(), {
        you: { color: (text) => theme.fg("accent", text) },
        thought: { color: (text) => theme.fg("thinkingText", text), italic: true },
      }),
      strike: (text) => theme.strikethrough(text),
    };
    lobbyThemes.set(theme, wrapped);
  }
  return wrapped;
}
