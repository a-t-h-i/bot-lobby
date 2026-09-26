/**
 * Pure layout helpers for the lobby: exact-width cells, wrapped paragraphs,
 * section rules, side-by-side columns and scroll windows. Every function takes
 * its widths and heights explicitly and never reads a clock or the terminal,
 * so each tab renders deterministically in tests.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

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
  | "mdCode";

export interface LobbyTheme {
  fg(color: LobbyColor, text: string): string;
  bold(text: string): string;
  italic?(text: string): string;
  bg?(color: "selectedBg", text: string): string;
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

/** Exactly `width` columns: truncated with an ellipsis, or padded with spaces. */
export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  const cut = visibleWidth(text) > width ? truncateToWidth(text, width) : text;
  const pad = width - visibleWidth(cut);
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
  const indent = visibleWidth(lead);
  const body = wrap(text, Math.max(1, width - indent));
  if (body.length === 0) return [lead];
  return body.map((line, index) => `${index === 0 ? lead : " ".repeat(indent)}${line}`);
}

/** `── Title ───────` spanning `width`; `right` sits at the far end when it fits. */
export function rule(width: number, title = "", theme?: LobbyTheme, right = "", color: LobbyColor = "borderMuted"): string {
  if (width <= 0) return "";
  const head = title ? `── ${title} ` : "";
  const tail = right ? ` ${right} ──` : "";
  const fill = width - visibleWidth(head) - visibleWidth(tail);
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

/** Light Markdown for plans and reports: headings bold without their `#`, everything else wrapped as written. */
export function markdownLines(text: string, width: number, theme?: LobbyTheme): string[] {
  return text.split("\n").flatMap((line) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    return wrap(heading ? bold(theme, paint(theme, "mdHeading", heading[1]!)) : line, width);
  });
}
