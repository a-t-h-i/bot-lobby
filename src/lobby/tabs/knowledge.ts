/**
 * The Knowledge tab: everything each agent knows about the project — its
 * knowledge, standards, decisions and completed tasks — with the file on the
 * left and its entries on the right, one of them picked. The picked entry can
 * be edited, deleted or commented on; the notes sit right under the entries
 * they are about, as every agent reads them.
 */
import type { KnowledgeNote } from "../../knowledge/notes.ts";
import { AGENT_DIR_NAMES, type KnowledgeAgent } from "../../knowledge/paths.ts";
import { AGENT_LABELS, type KnowledgeFileInfo, type KnowledgeView } from "../knowledge.ts";
import { bold, columns, fill, markdownLines, paint, rule, selectRow, spread, split, windowStart, wrap, wrapHanging, type LobbyTheme } from "../layout.ts";

export interface KnowledgeLayout {
  /** The first line of the entries shown, as the last frame drew them. */
  offset: number;
  /** How many lines the entries take, and how many the pane shows. */
  total: number;
  rows: number;
}

export interface KnowledgeTabInput {
  files: readonly KnowledgeFileInfo[];
  selected: number;
  /** The selected file, read. */
  view?: KnowledgeView;
  /** The picked entry, an index into the file's entries. */
  cursor: number;
  focus: "list" | "detail";
  /** The first line to show, unless the picked entry needs another. */
  offset: number;
  layout: KnowledgeLayout;
}

export const KNOWLEDGE_COLUMNS_MIN = 90;

/** `812`, `1.2k`, `24k`. */
export function sizeWords(chars: number): string {
  if (chars < 1000) return String(chars);
  const thousands = chars / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
}

function fileRow(info: KnowledgeFileInfo, width: number, selected: boolean, focused: boolean, theme?: LobbyTheme): string {
  const facts = [
    info.over ? paint(theme, "warning", `${sizeWords(info.chars)} · over`) : paint(theme, "dim", sizeWords(info.chars)),
    info.notes > 0 ? paint(theme, "accent", `✎ ${info.notes}`) : "",
  ].filter(Boolean).join(" ");
  return selectRow(theme, spread(selected ? bold(theme, info.label) : info.label, facts, width - 2), width, selected, focused);
}

/** The files, grouped by agent, the selected one in view. */
export function listLines(files: readonly KnowledgeFileInfo[], selected: number, width: number, height: number, focused: boolean, theme?: LobbyTheme): string[] {
  const lines: string[] = [];
  let at = 0;
  let previous: KnowledgeAgent | undefined;
  files.forEach((info, index) => {
    if (info.agent !== previous) {
      previous = info.agent;
      if (lines.length > 0) lines.push("");
      const notes = files.filter((file) => file.agent === info.agent).reduce((total, file) => total + file.notes, 0);
      lines.push(rule(width, AGENT_LABELS[info.agent], theme, notes > 0 ? `✎ ${notes}` : ""));
    }
    if (index === selected) at = lines.length;
    lines.push(fileRow(info, width, index === selected, focused, theme));
  });
  return lines.slice(windowStart(at, lines.length, height));
}

/** One note under its entry. */
function noteLines(note: KnowledgeNote, width: number, theme?: LobbyTheme, about?: string): string[] {
  const lead = paint(theme, "accent", "  ✎ ");
  const text = about ? `about “${about.replace(/\s+/g, " ").trim().slice(0, 50)}”: ${note.text}` : note.text;
  return wrapHanging(lead, paint(theme, "muted", text), width);
}

/** The entries of the open file, each drawn once, with where the picked one sits. */
export function entryLines(view: KnowledgeView, cursor: number, width: number, focused: boolean, theme?: LobbyTheme): { lines: string[]; from: number; to: number } {
  const lines: string[] = [];
  let from = 0;
  let to = 0;
  let previousEnd = 0;
  view.entries.forEach((entry, index) => {
    if (index > 0 && entry.start > previousEnd) lines.push("");
    previousEnd = entry.end;
    const picked = index === cursor;
    const body = markdownLines(entry.text, Math.max(8, width - 2), theme);
    if (picked) from = lines.length;
    body.forEach((line, row) => {
      const mark = picked ? paint(theme, "accent", row === 0 ? "▸ " : "  ") : "  ";
      lines.push(picked ? selectRow(theme, `${mark}${line}`, width, true, focused) : `${mark}${line}`);
    });
    for (const note of view.attached.filter((candidate) => candidate.entry === entry.text)) lines.push(...noteLines(note, width, theme));
    if (picked) to = lines.length;
  });
  if (view.detached.length > 0) {
    lines.push("", rule(width, "Notes on entries that changed", theme, String(view.detached.length)));
    for (const note of view.detached) lines.push(...noteLines(note, width, theme, note.entry));
  }
  return { lines, from, to };
}

export function renderKnowledge(input: KnowledgeTabInput, width: number, height: number, theme?: LobbyTheme): string[] {
  if (height <= 0) return [];
  if (input.files.length === 0) return fill([rule(width, "Knowledge", theme), ...wrap(paint(theme, "dim", "No knowledge files yet."), width)], height, width);
  const selected = Math.min(Math.max(0, input.selected), input.files.length - 1);
  const wide = width >= KNOWLEDGE_COLUMNS_MIN;
  const [listWidth, detailWidth] = wide ? split(width, 0.34, 3, 44) : [width, width];
  const total = input.files.reduce((sum, info) => sum + info.notes, 0);
  const listPane = fill([rule(listWidth, "Knowledge", theme, total > 0 ? `✎ ${total}` : ""), ...listLines(input.files, selected, listWidth, height - 1, input.focus === "list", theme)], height);
  const info = input.files[selected]!;
  const view = input.view && input.view.agent === info.agent && input.view.file === info.file ? input.view : undefined;
  const title = `${AGENT_DIR_NAMES[info.agent]} · ${info.file}${input.focus === "detail" ? " ◂" : ""}`;
  const head: string[] = [rule(detailWidth, title, theme, view ? `${view.entries.length} entr${view.entries.length === 1 ? "y" : "ies"} · ${sizeWords(view.chars)} chars` : "")];
  if (view?.over) head.push(...wrap(paint(theme, "warning", `over the compaction threshold — ask the oracle to compact ${info.file}`), detailWidth));
  const rows = Math.max(1, height - head.length);
  let body: string[];
  if (!view) body = [paint(theme, "dim", "reading…")];
  else if (view.entries.length === 0 && view.detached.length === 0) body = wrap(paint(theme, "dim", "Nothing here yet. n adds the first entry."), detailWidth);
  else {
    const drawn = entryLines(view, Math.min(input.cursor, Math.max(0, view.entries.length - 1)), detailWidth, input.focus === "detail", theme);
    let start = Math.max(0, Math.min(input.offset, Math.max(0, drawn.lines.length - rows)));
    // The picked entry stays in view (an entry taller than the pane shows its first lines).
    if (input.focus === "detail" && view.entries.length > 0) {
      if (drawn.from < start) start = drawn.from;
      else if (drawn.to > start + rows) start = Math.min(drawn.from, drawn.to - rows);
    }
    input.layout.offset = start;
    input.layout.total = drawn.lines.length;
    input.layout.rows = rows;
    body = drawn.lines.slice(start);
  }
  const detailPane = fill([...head, ...body], height);
  if (!wide) return fill(input.focus === "detail" ? detailPane : listPane, height, width);
  return fill(columns(listPane, detailPane, listWidth, detailWidth, " │ ", theme), height, width);
}
