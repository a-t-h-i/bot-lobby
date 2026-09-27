/**
 * Markdown for the lobby: pi's own renderer (headings, emphasis, lists, code
 * with syntax highlighting, quotes, tables) under the session's theme, with
 * heading hashes dropped for a cleaner read. Renders are cached per theme,
 * width and text, since the lobby repaints several times a second.
 */
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, type MarkdownTheme } from "@earendil-works/pi-tui";

export type MarkdownRenderer = (text: string, width: number) => string[];

const CACHE_LIMIT = 96;

/** A heading line as pi renders it: optional styling, then `#`…`######` and a space. */
const HEADING_HASHES = /^((?:\x1b\[[0-9;]*m)*)#{1,6} ((?:\x1b\[[0-9;]*m)*)/;

/** Drop the `### ` pi keeps in front of headings, and make them bold. */
export function tidyHeading(line: string, bold: (text: string) => string): string {
  if (!/^#{1,6} /.test(stripTerminalSequences(line))) return line;
  const body = line.replace(HEADING_HASHES, "$1$2");
  return bold(body.trimEnd());
}

/**
 * A renderer bound to a theme provider. `theme()` is read on every call, so a
 * theme switch re-renders instead of serving stale colours from the cache.
 */
export function createMarkdownRenderer(theme: () => MarkdownTheme = getMarkdownTheme): MarkdownRenderer {
  const caches = new WeakMap<object, Map<string, string[]>>();
  return (text, width) => {
    const current = theme();
    let cache = caches.get(current);
    if (!cache) {
      cache = new Map();
      caches.set(current, cache);
    }
    const key = `${width}\0${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const lines = new Markdown(text, 0, 0, current).render(Math.max(1, width)).map((line) => tidyHeading(line.trimEnd(), current.bold));
    // Drop the blank lines pi pads the render with at either end.
    while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
    while (lines.length > 0 && !lines.at(-1)!.trim()) lines.pop();
    cache.set(key, lines);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return lines;
  };
}
