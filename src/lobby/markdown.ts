/**
 * Markdown for the lobby: pi's own renderer (headings, emphasis, lists, code
 * with syntax highlighting, quotes, tables) under the session's theme, with
 * heading hashes dropped for a cleaner read. Renders are cached per width and
 * text, since the lobby repaints many times a second.
 */
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences, type DefaultTextStyle, type MarkdownOptions, type MarkdownTheme } from "@earendil-works/pi-tui";

/**
 * Whose words a piece of Markdown is, which sets how its plain text reads, as
 * pi draws the same things: an agent's reply in the theme's text colour, your
 * own words in yours (list markers and backslash escapes kept as typed), a
 * thought dimmed and in italics.
 */
export type MarkdownStyle = "reply" | "you" | "thought";

/** The plain-text look of each style but a reply; the lobby takes them from the session's theme. */
export type MarkdownStyles = Partial<Record<Exclude<MarkdownStyle, "reply">, DefaultTextStyle>>;

/** Markdown rendered to lines at a width; `keep: false` for text seen once (a reply still streaming), so it does not crowd the cache. */
export type MarkdownRenderer = (text: string, width: number, keep?: boolean, style?: MarkdownStyle) => string[];

/** How pi renders what you write: your ordered-list markers and backslash escapes stay as you typed them. */
const YOUR_WORDS: MarkdownOptions = { preserveOrderedListMarkers: true, preserveBackslashEscapes: true };

/**
 * Line breaks a model wrote out as `\n` (text escaped twice on its way here,
 * so a whole plan arrives as one line): made real when the text has no real
 * line break at all, outside inline code, where `\n` is usually meant.
 */
export function unescapeBreaks(text: string): string {
  if (text.includes("\n") || !text.includes("\\n")) return text;
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/(?:\\r)?\\n/g, "\n")))
    .join("");
}

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
export function createMarkdownRenderer(theme: MarkdownTheme = getMarkdownTheme(), styles: MarkdownStyles = {}): MarkdownRenderer {
  const cache = new Map<string, string[]>();
  return (text, width, keep = true, style = "reply") => {
    const key = `${style}\0${width}\0${text}`;
    const hit = cache.get(key);
    if (hit) {
      // Most recently used last, so the oldest is the one dropped.
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const look = style === "reply" ? undefined : styles[style];
    const lines = new Markdown(unescapeBreaks(text), 0, 0, theme, look, style === "you" ? YOUR_WORDS : undefined)
      .render(Math.max(1, width))
      .map((line) => tidyHeading(line.trimEnd(), theme.bold));
    // Drop the blank lines pi pads the render with at either end.
    while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
    while (lines.length > 0 && !lines.at(-1)!.trim()) lines.pop();
    if (!keep) return lines;
    cache.set(key, lines);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return lines;
  };
}

/** A fenced code block's opening or closing line. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A list item's first line: after a blank line it continues the list above, so blocks never split there. */
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

/**
 * Markdown split into blocks that render, one by one, into the same lines as
 * the whole (each block's lines, a blank line between blocks, blocks that
 * render to nothing left out). A split falls on a blank line outside code
 * fences that is followed by an unindented line that does not start a list
 * item — the only places where one block can never run into the next. A
 * streaming reply can then keep its finished blocks rendered and render only
 * the one still being written.
 */
export function markdownBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let fence: string | undefined;
  let start = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence || line.trim() || index === 0) continue;
    const next = lines[index + 1];
    if (next === undefined || !/^\S/.test(next) || LIST_ITEM.test(next)) continue;
    const block = lines.slice(start, index).join("\n");
    if (block.trim()) blocks.push(block);
    start = index + 1;
  }
  const last = lines.slice(start).join("\n");
  if (last.trim()) blocks.push(last);
  return blocks;
}
