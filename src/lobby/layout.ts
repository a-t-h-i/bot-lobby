/**
 * Pure layout helpers for the lobby: exact-width cells, wrapped paragraphs,
 * section rules, side-by-side columns and scroll windows. Every function takes
 * its widths and heights explicitly and never reads a clock or the terminal,
 * so each tab renders deterministically in tests.
 */
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { textWidth } from "../width.ts";

/** Colours the lobby uses; a subset of pi's theme so tests can pass a plain stub. */
export type LobbyColor =
  | "accent"
  | "text"
  | "muted"
  | "dim"
  | "success"
  | "warning"
  | "error"
  | "border"
  | "borderAccent"
  | "borderMuted"
  | "toolTitle"
  | "mdHeading"
  | "mdCode"
  | "userMessageText";

export interface LobbyTheme {
  fg(color: LobbyColor, text: string): string;
  bold(text: string): string;
  italic?(text: string): string;
  bg?(color: "selectedBg" | "searchMatchBg" | "userMessageBg", text: string): string;
  /** Render Markdown to styled lines; plain wrapping without it (tests). */
  markdown?(text: string, width: number, keep?: boolean): string[];
  /** Strike text through (an abandoned task's title); plain without it (tests). */
  strike?(text: string): string;
}

/** Paint only when a theme is present; tests without one get plain text. */
export function paint(theme: LobbyTheme | undefined, color: LobbyColor, text: string): string {
  return theme && text ? theme.fg(color, text) : text;
}

export function bold(theme: LobbyTheme | undefined, text: string): string {
  return theme && text ? theme.bold(text) : text;
}

export function italic(theme: LobbyTheme | undefined, text: string): string {
  return theme?.italic && text ? theme.italic(text) : text;
}

export function strike(theme: LobbyTheme | undefined, text: string): string {
  return theme?.strike && text ? theme.strike(text) : text;
}

/** `left` and `right` on one line of exactly `width` columns: the left side gives way first. */
export function spread(left: string, right: string, width: number): string {
  if (!right) return fit(left, width);
  const room = width - textWidth(right) - 1;
  if (room < 4) return fit(left, width);
  return `${fit(left, room)} ${right}`;
}

/** Exactly `width` columns: truncated with an ellipsis, or padded with spaces. */
export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  const cut = textWidth(text) > width ? truncateToWidth(text, width, "…") : text;
  const pad = width - textWidth(cut);
  return pad > 0 ? `${cut}${" ".repeat(pad)}` : cut;
}

/** Word-wrap text (ANSI-safe) to `width`, keeping blank lines; tabs become spaces. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  for (const raw of text.replace(/\t/g, "  ").split("\n")) {
    if (!raw.trim()) {
      lines.push("");
      continue;
    }
    lines.push(...wrapTextWithAnsi(raw, width));
  }
  return lines;
}

/** Wrap with a hanging indent: the first line carries `lead`, the rest align under it. */
export function wrapHanging(lead: string, text: string, width: number): string[] {
  const indent = textWidth(lead);
  const body = wrap(text, Math.max(1, width - indent));
  if (body.length === 0) return [lead];
  return body.map((line, index) => `${index === 0 ? lead : " ".repeat(indent)}${line}`);
}

/** `── Title ───────` spanning `width`; `right` sits at the far end when it fits. */
export function rule(width: number, title = "", theme?: LobbyTheme, right = "", color: LobbyColor = "borderMuted"): string {
  if (width <= 0) return "";
  const head = title ? `── ${title} ` : "";
  const tail = right ? ` ${right} ──` : "";
  const fill = width - textWidth(head) - textWidth(tail);
  if (fill < 1) return fit(paint(theme, color, head.trimEnd() || "─".repeat(width)), width);
  const titled = title ? `${paint(theme, color, "── ")}${bold(theme, paint(theme, "accent", title))}${paint(theme, color, " ")}` : "";
  const ending = right ? `${paint(theme, color, " ")}${paint(theme, "muted", right)}${paint(theme, color, " ──")}` : "";
  return `${titled}${paint(theme, color, "─".repeat(fill))}${ending}`;
}

/** Exactly `height` lines: extra lines dropped from the end, missing ones blank. */
export function fill(lines: readonly string[], height: number, width?: number): string[] {
  const out = lines.slice(0, Math.max(0, height));
  while (out.length < height) out.push("");
  return width === undefined ? out : out.map((line) => fit(line, width));
}

/** The last `height` lines, shifted up by `offset` lines of scrollback. */
export function tail(lines: readonly string[], height: number, offset = 0): string[] {
  if (height <= 0) return [];
  const end = Math.max(Math.min(lines.length, height), lines.length - Math.max(0, offset));
  return lines.slice(Math.max(0, end - height), end);
}

/** The largest useful scroll-back offset for `lines` in a window of `height`. */
export function maxOffset(lineCount: number, height: number): number {
  return Math.max(0, lineCount - height);
}

/** First index to show so `selected` stays visible in a window of `height` rows. */
export function windowStart(selected: number, count: number, height: number): number {
  if (height <= 0 || count <= height) return 0;
  const half = Math.floor(height / 2);
  return Math.max(0, Math.min(count - height, selected - half));
}

/** Two columns side by side, each cell fitted to its width, `gap` columns apart. */
export function columns(left: readonly string[], right: readonly string[], leftWidth: number, rightWidth: number, gap = " │ ", theme?: LobbyTheme): string[] {
  const rows = Math.max(left.length, right.length);
  const separator = paint(theme, "borderMuted", gap);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) out.push(`${fit(left[i] ?? "", leftWidth)}${separator}${fit(right[i] ?? "", rightWidth)}`);
  return out;
}

/** Split `width` into two columns plus a gap; the left gets `share` of the space. */
export function split(width: number, share: number, gap = 3, minRight = 24): [number, number] {
  const usable = Math.max(0, width - gap);
  const left = Math.max(10, Math.min(usable - minRight, Math.round(usable * share)));
  return [left, Math.max(0, usable - left)];
}

/** `12:04` in local time. */
export function clock(at: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Compact age: `now`, `45s`, `12m`, `3h`, `2d`. */
export function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 5_000) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** `just now` or `12m ago`. */
export function since(ms: number): string {
  const age = ago(ms);
  return age === "now" ? "just now" : `${age} ago`;
}

/** Highlight a selected row: the theme's selection background, or a leading marker without one. */
export function selectRow(theme: LobbyTheme | undefined, text: string, width: number, selected: boolean, focused = true): string {
  const cell = fit(text, width);
  if (!selected) return cell;
  if (theme?.bg && focused) return theme.bg("selectedBg", cell);
  return cell;
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function spinner(tick: number): string {
  return SPINNER[((tick % SPINNER.length) + SPINNER.length) % SPINNER.length]!;
}

/** Markdown for plans, reports and replies: the theme's renderer, or headings bold without their `#` and the rest wrapped. */
export function markdownLines(text: string, width: number, theme?: LobbyTheme, keep = true): string[] {
  if (theme?.markdown) return theme.markdown(text, width, keep);
  return text.split("\n").flatMap((line) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    return wrap(heading ? bold(theme, paint(theme, "mdHeading", heading[1]!)) : line, width);
  });
}

/** Markdown behind a hanging lead (`oracle ▸ `): the first line carries the lead, the rest align under it. */
export function markdownHanging(lead: string, text: string, width: number, theme?: LobbyTheme): string[] {
  const indent = textWidth(lead);
  const body = markdownLines(text, Math.max(1, width - indent), theme);
  if (body.length === 0) return [lead];
  return body.map((line, index) => (index === 0 ? `${lead}${line}` : line ? `${" ".repeat(indent)}${line}` : ""));
}

export interface BoxOptions {
  title?: string;
  /** Muted text at the right end of the top border. */
  right?: string;
  /** The box that has the keyboard: its border takes the accent colour. */
  focused?: boolean;
  theme?: LobbyTheme;
  /** Content longer than the box: `total` lines, the first shown at `start`; drawn as a thumb on the right border. */
  scroll?: { total: number; start: number };
}

/** An entry of a pane (a message, a thought, an activity line) and how many lines run from its first line to the pane's end. */
export interface PaneMark {
  entry: object;
  below: number;
}

/** A pane that measures what arrives below: its newest entry now, and the lines that arrived below the one marked the frame before. */
export interface PaneFollow {
  mark?: PaneMark;
  grew: number;
}

/** A scrollable pane as a render laid it out: its box in body cells, and its content against its rows. */
export interface PaneBox {
  top: number;
  left: number;
  width: number;
  height: number;
  /** Lines of content, and rows showing them at once. */
  total: number;
  rows: number;
  /**
   * Set by panes whose total is estimated: lines that arrived below since the
   * frame before, measured from an entry, not from the total (which moves as
   * scrolling draws more or fewer of the entries it estimates).
   */
  follow?: PaneFollow;
}

/** Scrollable panes by name, filled in by a tab's render so the lobby can clamp offsets and route the wheel. */
export type PaneLayout = Map<string, PaneBox>;

/** Record a pane that sits at `top`/`left` in the body, `width` × `height`, showing `total` lines. */
export function notePane(panes: PaneLayout | undefined, name: string, top: number, left: number, width: number, height: number, total: number, follow?: PaneFollow): void {
  panes?.set(name, { top, left, width, height, total, rows: Math.max(0, height - 2), ...(follow ? { follow } : {}) });
}

/** First line of a top-anchored pane scrolled `offset` lines down, stopping when its last line shows. */
export function detailWindow(total: number, rows: number, offset: number): number {
  return Math.max(0, Math.min(offset, total - Math.max(1, rows)));
}

/** `12–40/96`: the lines a pane shows out of all it holds. */
export function position(start: number, rows: number, total: number): string {
  return `${start + 1}–${Math.min(total, start + rows)}/${total}`;
}

/** The rows of a `rows`-tall track that the thumb covers, or undefined when everything fits. */
export function scrollThumb(total: number, rows: number, start: number): { from: number; to: number } | undefined {
  if (rows <= 0 || total <= rows) return undefined;
  const size = Math.max(1, Math.round((rows * rows) / total));
  const max = total - rows;
  const from = Math.round((Math.min(max, Math.max(0, start)) / max) * (rows - size));
  return { from, to: from + size };
}

/**
 * A rounded panel exactly `width` × `height`: the title set into the top
 * border, `content` inside with one column of padding, extra lines cut and
 * missing ones blank. Below 4 columns or 2 rows it degrades to plain lines.
 */
export function box(width: number, height: number, content: readonly string[], options: BoxOptions = {}): string[] {
  if (height <= 0) return [];
  if (width < 4 || height < 2) return fill(content, height, Math.max(0, width));
  const { theme, focused } = options;
  const edge = (text: string) => paint(theme, focused ? "borderAccent" : "borderMuted", text);
  const inner = width - 4;
  const title = options.title ? ` ${options.title} ` : "";
  const right = options.right ? ` ${options.right} ` : "";
  let room = width - 2 - textWidth(title) - textWidth(right);
  const shownRight = room >= 1 ? right : "";
  room = width - 2 - textWidth(title) - textWidth(shownRight);
  const titled = room >= 1 ? title : fit(title, Math.max(0, width - 3));
  const fillWidth = Math.max(0, width - 2 - textWidth(titled) - textWidth(shownRight));
  const paintedTitle = titled ? bold(theme, paint(theme, focused ? "accent" : "text", titled)) : "";
  const top = `${edge("╭")}${paintedTitle}${edge("─".repeat(fillWidth))}${shownRight ? paint(theme, "dim", shownRight) : ""}${edge("╮")}`;
  const thumb = options.scroll ? scrollThumb(options.scroll.total, height - 2, options.scroll.start) : undefined;
  const rightEdge = (row: number) => (thumb && row >= thumb.from && row < thumb.to ? paint(theme, focused ? "accent" : "muted", "┃") : edge("│"));
  const rows = fill(content, height - 2).map((line, row) => `${edge("│")} ${fit(line, inner)} ${rightEdge(row)}`);
  return [top, ...rows, `${edge("╰")}${edge("─".repeat(width - 2))}${edge("╯")}`];
}

/** Lay boxes out side by side, each already exactly its width and the same height. */
export function beside(panes: ReadonlyArray<readonly string[]>, gap = " "): string[] {
  const height = Math.max(0, ...panes.map((pane) => pane.length));
  return Array.from({ length: height }, (_, row) => panes.map((pane) => pane[row] ?? "").join(gap));
}

/** Escape sequences (CSI, OSC, APC) that take no columns. */
const ESCAPE = /\x1b(?:\[[0-9;?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|_[^\x07\x1b]*(?:\x07|\x1b\\))/y;

/**
 * Mark every case-insensitive occurrence of `query` in a styled line with
 * reverse video. Escape sequences are skipped when matching and kept intact,
 * and reverse video is switched off (not reset) so the line's own colours
 * carry on after each match.
 */
export function highlight(line: string, query: string): string {
  const needle = query.trim().toLowerCase();
  if (!needle) return line;
  // Visible characters with their raw offsets.
  const chars: Array<{ ch: string; at: number }> = [];
  for (let i = 0; i < line.length; ) {
    ESCAPE.lastIndex = i;
    const escape = ESCAPE.exec(line);
    if (escape) {
      i += escape[0].length;
      continue;
    }
    const point = line.codePointAt(i)!;
    const ch = String.fromCodePoint(point);
    chars.push({ ch, at: i });
    i += ch.length;
  }
  const visible = chars.map((entry) => entry.ch).join("").toLowerCase();
  const starts: Array<[number, number]> = [];
  for (let from = visible.indexOf(needle); from >= 0; from = visible.indexOf(needle, from + needle.length)) starts.push([from, from + needle.length]);
  if (starts.length === 0) return line;
  // Map visible string offsets back to char indexes (they differ only for astral characters).
  const charAt: number[] = [];
  chars.forEach((entry, index) => {
    for (let k = 0; k < entry.ch.length; k++) charAt.push(index);
  });
  let out = "";
  let cursor = 0;
  for (const [start, end] of starts) {
    const from = chars[charAt[start]!]!.at;
    const lastChar = chars[charAt[end - 1]!]!;
    const to = lastChar.at + lastChar.ch.length;
    out += `${line.slice(cursor, from)}\x1b[7m${line.slice(from, to)}\x1b[27m`;
    cursor = to;
  }
  return out + line.slice(cursor);
}

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** A horizontal bar `value / max` of `width` cells, with eighth-cell precision at its end. */
export function bar(value: number, max: number, width: number): string {
  if (width <= 0 || !Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return "";
  const cells = Math.min(width, (value / max) * width);
  const whole = Math.floor(cells);
  const part = EIGHTHS[Math.round((cells - whole) * 8)] ?? "";
  // A non-zero value always shows at least a sliver.
  return `${"█".repeat(whole)}${part}` || "▏";
}

/** A meter `fraction` full: filled cells over a dim track, exactly `width` wide. */
export function meter(fraction: number, width: number, fillPaint: (text: string) => string, trackPaint: (text: string) => string): string {
  if (width <= 0) return "";
  const safe = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const filled = Math.round(safe * width);
  return `${fillPaint("━".repeat(filled))}${trackPaint("─".repeat(width - filled))}`;
}

const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** A sparkline of the last `width` values, scaled between their min and max. */
export function sparkline(values: readonly number[], width: number): string {
  const shown = values.filter((value) => Number.isFinite(value)).slice(-Math.max(0, width));
  if (shown.length === 0) return "";
  const low = Math.min(...shown);
  const high = Math.max(...shown);
  const span = high - low;
  return shown.map((value) => SPARKS[span === 0 ? 3 : Math.min(7, Math.floor(((value - low) / span) * 8))]).join("");
}

/**
 * A part-to-whole bar: each segment's share of `width` cells in its own
 * colour, rounded so the segments always fill the bar exactly.
 */
export function stackedBar(segments: ReadonlyArray<{ value: number; paint: (text: string) => string }>, width: number): string {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (width <= 0 || total <= 0) return "";
  let used = 0;
  let acc = 0;
  return segments.map((segment) => {
    acc += Math.max(0, segment.value);
    const end = Math.round((acc / total) * width);
    const cells = end - used;
    used = end;
    return cells > 0 ? segment.paint("█".repeat(cells)) : "";
  }).join("");
}
