/**
 * Markdown for the lobby: pi's own renderer (headings, emphasis, lists, code
 * with syntax highlighting, quotes, tables) under the session's theme, with
 * heading hashes dropped for a cleaner read. Renders are cached per width and
 * text, since the lobby repaints many times a second.
 */
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, type MarkdownTheme } from "@earendil-works/pi-tui";

export type MarkdownRenderer = (text: string, width: number) => string[];

/** A heading line as pi renders it: optional styling, then `#`…`######` and a space. */
const HEADING_HASHES = /^((?:\x1b\[[0-9;]*m)*)#{1,6} ((?:\x1b\[[0-9;]*m)*)/;

/** Drop the `### ` pi keeps in front of headings, and make them bold. */
export function tidyHeading(line: string, bold: (text: string) => string): string {
  if (!/^#{1,6} /.test(stripTerminalSequences(line))) return line;
  const body = line.replace(HEADING_HASHES, "$1$2");
  return bold(body.trimEnd());
}

/** Rendered Markdown kept per renderer: the most recently used survive. */
export const CACHE_LIMIT = 512;

/**
 * A renderer for one Markdown theme. Renders are kept per width and text, the
 * least recently used dropped first. pi's `getMarkdownTheme()` builds a new
 * theme object on every call, so the theme is taken once, here: a theme
 * switch makes a new renderer (the lobby keeps one per pi theme).
 */
export function createMarkdownRenderer(theme: MarkdownTheme = getMarkdownTheme()): MarkdownRenderer {
  const cache = new Map<string, string[]>();
  return (text, width) => {
    const key = `${width}\0${text}`;
    const hit = cache.get(key);
    if (hit) {
      // Most recently used last, so the oldest is the one dropped.
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const lines = new Markdown(text, 0, 0, theme).render(Math.max(1, width)).map((line) => tidyHeading(line.trimEnd(), theme.bold));
    // Drop the blank lines pi pads the render with at either end.
    while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
    while (lines.length > 0 && !lines.at(-1)!.trim()) lines.pop();
    cache.set(key, lines);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return lines;
  };
}
