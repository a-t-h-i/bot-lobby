/**
 * The user's comments on knowledge: notes about one entry of an agent's
 * knowledge file ("outdated, we moved to Redis"). They live in one
 * append-only JSON-lines log per project, never inside the knowledge files
 * (agents rewrite those when they compact them), and reach every agent that
 * reads the knowledge: `annotate` puts each note right under its entry, so it
 * travels with the entry into the prompt and the agent weighs it there.
 *
 * A note is tied to its entry by the entry's exact text. Editing the entry
 * from the Knowledge tab moves its notes to the new text; a note whose entry
 * changed some other way is kept, and shown under the file as detached.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { KnowledgeAgent } from "./paths.ts";
import { parseEntries } from "./edit.ts";

export interface KnowledgeNote {
  id: string;
  agent: KnowledgeAgent;
  /** The knowledge file, e.g. `decisions.md`. */
  file: string;
  /** The exact text of the entry it is about. */
  entry: string;
  text: string;
  createdAt: string;
  /** The pi session that wrote it, when known. */
  by?: string;
}

type NoteEvent =
  | { kind: "note"; id: string; agent: KnowledgeAgent; file: string; entry: string; text: string; at: string; by?: string }
  | { kind: "move"; id: string; entry: string; at: string }
  | { kind: "remove"; id: string; at: string };

/** Longest note kept; agents read it verbatim. */
export const MAX_NOTE_CHARS = 2000;

export function notesPath(dataRoot: string): string {
  return join(dataRoot, "knowledge-comments.jsonl");
}

function append(dataRoot: string, event: NoteEvent): void {
  const path = notesPath(dataRoot);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

/** The notes as they stand, oldest first. A torn line from a crashed writer is skipped. */
export function readNotes(dataRoot: string | undefined): KnowledgeNote[] {
  if (!dataRoot) return [];
  const path = notesPath(dataRoot);
  if (!existsSync(path)) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const notes = new Map<string, KnowledgeNote>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event: NoteEvent;
    try {
      event = JSON.parse(line) as NoteEvent;
    } catch {
      continue;
    }
    if (!event || typeof event.id !== "string") continue;
    if (event.kind === "note" && !notes.has(event.id) && typeof event.text === "string" && typeof event.entry === "string") {
      notes.set(event.id, { id: event.id, agent: event.agent, file: event.file, entry: event.entry, text: event.text, createdAt: event.at, ...(event.by ? { by: event.by } : {}) });
    } else if (event.kind === "move" && typeof event.entry === "string") {
      const note = notes.get(event.id);
      if (note) note.entry = event.entry;
    } else if (event.kind === "remove") notes.delete(event.id);
  }
  return [...notes.values()];
}

/** Leave a note on an entry. */
export function addNote(dataRoot: string, note: { agent: KnowledgeAgent; file: string; entry: string; text: string; by?: string }, now = new Date()): KnowledgeNote {
  const text = note.text.trim().slice(0, MAX_NOTE_CHARS);
  if (!text) throw new Error("a note needs some words");
  if (!note.entry.trim()) throw new Error("a note needs an entry to be about");
  const id = randomUUID().slice(0, 8);
  const at = now.toISOString();
  append(dataRoot, { kind: "note", id, agent: note.agent, file: note.file, entry: note.entry, text, at, ...(note.by ? { by: note.by } : {}) });
  return { id, agent: note.agent, file: note.file, entry: note.entry, text, createdAt: at, ...(note.by ? { by: note.by } : {}) };
}

export function removeNote(dataRoot: string, id: string, now = new Date()): void {
  append(dataRoot, { kind: "remove", id, at: now.toISOString() });
}

/** Move every note on `from` to `to`: the entry was edited, its notes stay with it. Returns how many moved. */
export function moveNotes(dataRoot: string, agent: KnowledgeAgent, file: string, from: string, to: string, now = new Date()): number {
  if (from === to) return 0;
  const moving = readNotes(dataRoot).filter((note) => note.agent === agent && note.file === file && note.entry === from);
  for (const note of moving) append(dataRoot, { kind: "move", id: note.id, entry: to, at: now.toISOString() });
  return moving.length;
}

/** Drop every note on `entry`: the entry was deleted. Returns how many went. */
export function removeNotesOn(dataRoot: string, agent: KnowledgeAgent, file: string, entry: string, now = new Date()): number {
  const going = readNotes(dataRoot).filter((note) => note.agent === agent && note.file === file && note.entry === entry);
  for (const note of going) removeNote(dataRoot, note.id, now);
  return going.length;
}

/** `> Note from the user: …` with every line of a longer note quoted. */
function noteLines(note: KnowledgeNote, about?: string): string[] {
  const [first = "", ...rest] = note.text.split("\n");
  const lead = about ? `Note from the user about "${about}": ` : "Note from the user: ";
  return [`> ${lead}${first}`, ...rest.map((line) => `> ${line}`)];
}

/**
 * A file's text with each note under the entry it is about, as the agents
 * read it. A note whose entry is gone is added at the end, naming the entry it
 * was about, so what the user said is never lost. Notes the text already
 * carries (an agent copied them in when it compacted the file) are not added twice.
 */
export function annotate(content: string, notes: readonly KnowledgeNote[]): string {
  if (notes.length === 0) return content;
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const entries = parseEntries(content);
  const carried = (note: KnowledgeNote) => content.includes(noteLines(note)[0]!);
  const pending = notes.filter((note) => !carried(note));
  const detached: KnowledgeNote[] = [];
  const under = new Map<number, KnowledgeNote[]>();
  for (const note of pending) {
    const entry = entries.find((candidate) => candidate.text === note.entry);
    if (!entry) detached.push(note);
    else under.set(entry.end, [...(under.get(entry.end) ?? []), note]);
  }
  // Bottom-up, so earlier positions stay where they are.
  for (const at of [...under.keys()].sort((a, b) => b - a)) lines.splice(at, 0, ...under.get(at)!.flatMap((note) => noteLines(note)));
  const body = lines.join("\n").replace(/\n+$/, "");
  if (detached.length === 0) return body;
  const about = (note: KnowledgeNote) => note.entry.replace(/\s+/g, " ").trim().slice(0, 60);
  return `${body}\n\n${detached.flatMap((note) => noteLines(note, about(note))).join("\n")}`;
}
