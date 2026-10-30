/**
 * What the Knowledge page shows beside the files themselves: which notes are
 * pinned, where each note came from and how it changed (with the text before
 * each edit, so an earlier version can be restored), and the Inbox of notes
 * finished work proposed and nobody has accepted yet. One JSON file per
 * project, next to the knowledge directories; the knowledge files stay plain
 * Markdown that agents read and rewrite.
 *
 * Notes are tied to their entry by its text, like the user's comments: an
 * edit from the Knowledge page carries its pins and history to the new text.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempName, withFileLock } from "../desk/lock.ts";
import type { KnowledgeAgent } from "./paths.ts";

export interface LedgerPin {
  agent: KnowledgeAgent;
  file: string;
  entry: string;
  at: string;
}

/** One thing that happened to a note: who did it, in words, and the text before when it changed. */
export interface LedgerEvent {
  id: string;
  agent: KnowledgeAgent;
  file: string;
  /** The note's text after the event. */
  entry: string;
  /** "you", or the agent that wrote it. */
  by: string;
  /** What happened, as a sentence without its subject ("wrote this while working on task 8f3a21"). */
  what: string;
  /** Where it came from, short ("Task 8f3a21", "Chat with you", "Compaction"). */
  source?: string;
  /** The text before an edit: restoring the event puts it back. */
  before?: string;
  at: string;
}

/** A note finished work proposed, waiting in the Inbox. */
export interface LedgerProposal {
  id: string;
  agent: KnowledgeAgent;
  kind: "knowledge" | "standard" | "decision";
  text: string;
  source: string;
  /** 0–100, when the proposer said how sure it is. */
  confidence?: number;
  /** The note it would replace, by its text. */
  replaces?: string;
  taskId?: string;
  at: string;
}

interface LedgerFile {
  version: 1;
  pins: LedgerPin[];
  events: LedgerEvent[];
  proposals: LedgerProposal[];
}

const MAX_EVENTS = 3000;
const MAX_PROPOSALS = 200;

export function ledgerPath(dataRoot: string): string {
  return join(dataRoot, "knowledge-ledger.json");
}

/** A note's text without its list marker, for matching across bullets and plain lines. */
export function plainEntry(text: string): string {
  return text.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ x]\]\s+)?/i, "").trim().toLowerCase();
}

function empty(): LedgerFile {
  return { version: 1, pins: [], events: [], proposals: [] };
}

export function readLedger(dataRoot: string | undefined): LedgerFile {
  if (!dataRoot) return empty();
  const path = ledgerPath(dataRoot);
  if (!existsSync(path)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LedgerFile>;
    return {
      version: 1,
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    };
  } catch {
    return empty();
  }
}

function update<T>(dataRoot: string, change: (ledger: LedgerFile) => T): T {
  const path = ledgerPath(dataRoot);
  return withFileLock(path, () => {
    const ledger = readLedger(dataRoot);
    const result = change(ledger);
    ledger.events = ledger.events.slice(-MAX_EVENTS);
    ledger.proposals = ledger.proposals.slice(-MAX_PROPOSALS);
    const temp = tempName(path);
    writeFileSync(temp, `${JSON.stringify(ledger, null, 1)}\n`, "utf8");
    renameSync(temp, path);
    return result;
  });
}

const same = (a: { agent: string; file: string; entry: string }, agent: string, file: string, entry: string) =>
  a.agent === agent && a.file === file && plainEntry(a.entry) === plainEntry(entry);

/** Note what happened to an entry. */
export function recordEvent(dataRoot: string, event: Omit<LedgerEvent, "id" | "at">, now = new Date()): void {
  update(dataRoot, (ledger) => {
    ledger.events.push({ ...event, id: randomUUID().slice(0, 8), at: now.toISOString() });
  });
}

/** Pin a note to the top, or unpin it. */
export function setPin(dataRoot: string, agent: KnowledgeAgent, file: string, entry: string, on: boolean, now = new Date()): void {
  update(dataRoot, (ledger) => {
    ledger.pins = ledger.pins.filter((pin) => !same(pin, agent, file, entry));
    if (on) ledger.pins.push({ agent, file, entry, at: now.toISOString() });
  });
}

/** An entry changed text (or moved file): its pins and history follow it. */
export function moveEntry(dataRoot: string, from: { agent: KnowledgeAgent; file: string; entry: string }, to: { agent: KnowledgeAgent; file: string; entry: string }): void {
  update(dataRoot, (ledger) => {
    for (const pin of ledger.pins) if (same(pin, from.agent, from.file, from.entry)) Object.assign(pin, to);
    for (const event of ledger.events) if (same(event, from.agent, from.file, from.entry)) Object.assign(event, to);
  });
}

/** An entry was deleted: its pin goes (its history stays, unseen). */
export function dropEntry(dataRoot: string, agent: KnowledgeAgent, file: string, entry: string): void {
  update(dataRoot, (ledger) => {
    ledger.pins = ledger.pins.filter((pin) => !same(pin, agent, file, entry));
  });
}

/** Add a note to the Inbox; one already waiting with the same text is kept instead. */
export function propose(dataRoot: string, proposal: Omit<LedgerProposal, "id" | "at">, now = new Date()): boolean {
  return update(dataRoot, (ledger) => {
    const key = plainEntry(proposal.text);
    if (!key || ledger.proposals.some((one) => one.agent === proposal.agent && plainEntry(one.text) === key)) return false;
    ledger.proposals.push({ ...proposal, id: randomUUID().slice(0, 8), at: now.toISOString() });
    return true;
  });
}

/** Take a proposal out of the Inbox (accepted or dismissed); the one taken, when it was there. */
export function takeProposal(dataRoot: string, id: string): LedgerProposal | undefined {
  return update(dataRoot, (ledger) => {
    const found = ledger.proposals.find((one) => one.id === id);
    ledger.proposals = ledger.proposals.filter((one) => one.id !== id);
    return found;
  });
}

/** Proposals a write made moot: the same text, now saved for that agent. */
export function settleProposals(dataRoot: string, agent: KnowledgeAgent, text: string): void {
  const key = plainEntry(text);
  if (!key || !existsSync(ledgerPath(dataRoot))) return;
  update(dataRoot, (ledger) => {
    ledger.proposals = ledger.proposals.filter((one) => !(one.agent === agent && plainEntry(one.text) === key));
  });
}

/** The pinned entries of one agent's file, in pin order, for the prompt. */
export function pinnedEntries(dataRoot: string | undefined, agent: KnowledgeAgent, file: string): string[] {
  return readLedger(dataRoot).pins.filter((pin) => pin.agent === agent && pin.file === file).map((pin) => pin.entry);
}

/** `- [kind] text — 90%` or `… (replaces: old text)`: a proposal's confidence and what it replaces, read off its line. */
export function proposalParts(text: string): { text: string; confidence?: number; replaces?: string } {
  let rest = text.trim();
  let replaces: string | undefined;
  const replacing = /\s*\((?:replaces|supersedes):\s*(.+)\)\s*$/i.exec(rest);
  if (replacing) {
    replaces = replacing[1]!.replace(/^["“]|["”]$/g, "").trim();
    rest = rest.slice(0, replacing.index).trim();
  }
  let confidence: number | undefined;
  const sure = /\s*(?:[—–-]|\()\s*(\d{1,3})\s*%\s*(?:confident|confidence)?\)?\s*$/i.exec(rest);
  if (sure) {
    confidence = Math.min(100, Number(sure[1]));
    rest = rest.slice(0, sure.index).trim();
  }
  return { text: rest, ...(confidence !== undefined ? { confidence } : {}), ...(replaces ? { replaces } : {}) };
}
