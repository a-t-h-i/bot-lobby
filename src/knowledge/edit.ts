/**
 * Knowledge files as entries the user can pick, edit, add and delete from the
 * Knowledge tab. An entry is what reads as one item: a heading, a bullet with
 * its wrapped and nested lines, or a paragraph. Everything here is pure text
 * in, text out; the tab finds an entry again by its exact text (and which of
 * several identical ones it is), so an edit made after the file changed on
 * disk is refused rather than landing on the wrong line.
 */

export type EntryKind = "heading" | "bullet" | "text";

export interface KnowledgeEntry {
  /** The entry's lines exactly as the file has them. */
  text: string;
  /** First line, and the line after the last (indexes into the file's lines). */
  start: number;
  end: number;
  kind: EntryKind;
  /** Which of the entries with this same text it is (0 for the first). */
  occurrence: number;
}

const HEADING = /^#{1,6}\s/;
const BULLET = /^(?:[-*+]|\d+[.)])\s+\S/;

/** The entries of a knowledge file, in order; blank lines separate them and belong to none. */
export function parseEntries(content: string): KnowledgeEntry[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const found: Array<{ start: number; end: number; kind: EntryKind }> = [];
  let current: { start: number; end: number; kind: EntryKind } | undefined;
  const close = () => {
    if (current) found.push(current);
    current = undefined;
  };
  lines.forEach((line, index) => {
    if (!line.trim()) return close();
    if (HEADING.test(line)) {
      close();
      found.push({ start: index, end: index + 1, kind: "heading" });
      return;
    }
    if (BULLET.test(line)) {
      close();
      current = { start: index, end: index + 1, kind: "bullet" };
      return;
    }
    // A wrapped or indented line joins the item above it; anything else starts a paragraph.
    if (current) current.end = index + 1;
    else current = { start: index, end: index + 1, kind: "text" };
  });
  close();
  const seen = new Map<string, number>();
  return found.map(({ start, end, kind }) => {
    const text = lines.slice(start, end).join("\n");
    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    return { text, start, end, kind, occurrence };
  });
}

/** The entry with this exact text (the `occurrence`-th one), or undefined when the file no longer has it. */
export function findEntry(content: string, text: string, occurrence = 0): KnowledgeEntry | undefined {
  return parseEntries(content).find((entry) => entry.text === text && entry.occurrence === occurrence);
}

function linesOf(content: string): string[] {
  const text = content.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return text ? text.split("\n") : [];
}

/** `text` as a bullet: its first line after `- `, the rest indented under it; text that already is a bullet or heading stays as written. */
export function bulletOf(text: string): string {
  const trimmed = text.replace(/^\s*\n+|\s+$/g, "");
  if (!trimmed.trim()) return "";
  if (BULLET.test(trimmed) || HEADING.test(trimmed)) return trimmed;
  const [first = "", ...rest] = trimmed.split("\n");
  return [`- ${first}`, ...rest.map((line) => (line.trim() ? `  ${line.trimStart()}` : ""))].join("\n");
}

/** The file with `entry` replaced by `text`, exactly as written (a blank text removes it). */
export function replaceEntry(content: string, entry: KnowledgeEntry, text: string): string {
  const body = text.replace(/\s+$/, "");
  if (!body.trim()) return removeEntry(content, entry);
  const lines = linesOf(content);
  lines.splice(entry.start, entry.end - entry.start, ...body.split("\n"));
  return `${lines.join("\n")}\n`;
}

/** The file without `entry`; the blank line it leaves doubled up is dropped with it. */
export function removeEntry(content: string, entry: KnowledgeEntry): string {
  const lines = linesOf(content);
  lines.splice(entry.start, entry.end - entry.start);
  const before = lines[entry.start - 1];
  const after = lines[entry.start];
  if (entry.start < lines.length && after !== undefined && !after.trim() && (before === undefined || !before.trim())) lines.splice(entry.start, 1);
  else if (entry.start >= lines.length && lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** The file with a new bullet after `entry` (at the end without one); after a paragraph it gets a blank line first. */
export function insertAfter(content: string, entry: KnowledgeEntry | undefined, text: string): string {
  const added = bulletOf(text);
  if (!added.trim()) return content;
  const lines = linesOf(content);
  const at = entry ? entry.end : lines.length;
  const addition = entry?.kind === "text" || (!entry && lines.length > 0 && lines[lines.length - 1]!.trim() && !BULLET.test(lines[lines.length - 1]!)) ? ["", ...added.split("\n")] : added.split("\n");
  lines.splice(at, 0, ...addition);
  return `${lines.join("\n")}\n`;
}
