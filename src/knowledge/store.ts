import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { withFileLock } from "../desk/lock.ts";
import { knowledgeDir, STANDARDS_FILE, type KnowledgeAgent } from "./paths.ts";
import { annotate, readNotes } from "./notes.ts";
import { pinnedEntries, recordEvent, settleProposals } from "./ledger.ts";

/** The agent's name as the Knowledge page shows it. */
const AGENT_NAMES: Record<KnowledgeAgent, string> = { master: "Orchestrator", designer: "Designer", backend: "Backend", qa: "QA" };

export function readFileOr(path: string, fallback = ""): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

/** First existing file among `paths`, in order; merged legacy reads use it per file. */
export function readFirstExisting(paths: readonly string[], fallback = ""): string {
  for (const path of paths) if (existsSync(path)) return readFileOr(path, fallback);
  return fallback;
}

export function writeFileEnsured(path: string, content: string): void {
  writeFileAtomic(path, content);
}

/**
 * Atomic replacement: the content lands in a temp file beside the target,
 * then one rename swaps it in. A crash mid-write leaves the original file
 * intact and a harmless temp file behind — never a half-written active file.
 */
export function writeFileAtomic(path: string, content: string, expected?: string): boolean {
  return withFileLock(path, () => {
    if (expected !== undefined && readFileOr(path) !== expected) return false;
    writeFileAtomicUnlocked(path, content);
    return true;
  });
}

function existingStat(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

/** Only called while the target path's lock is held; metadata failures leave it intact. */
function writeFileAtomicUnlocked(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const original = existingStat(path);
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temp, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const created = statSync(temp);
    if (original && (original.uid !== created.uid || original.gid !== created.gid)) chownSync(temp, original.uid, original.gid);
    chmodSync(temp, original ? original.mode & 0o7777 : 0o666 & ~process.umask());
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Seed content for freshly created knowledge files (§21). */
export const DEFAULT_KNOWLEDGE_CONTENT: Record<string, string> = {
  "knowledge.md": "# Knowledge\n\nStable facts and useful patterns for this project.\n",
  "standards.md": "# Standards\n\nUniversal project rules.\n",
  "decisions.md": "# Decisions\n\nSignificant decisions and their rationale.\n",
  "completed-tasks.md": "# Completed Tasks\n\nShort operational history.\n",
  "design-language.md": "# Design Language\n\nVisual language, accessibility, and frontend conventions.\n",
  "engineering-standards.md": "# Engineering Standards\n\nBackend, API, and security standards.\n",
  "testing-standards.md": "# Testing Standards\n\nTesting conventions and definition of done.\n",
};

export function ensureFile(path: string, content: string): void {
  withFileLock(path, () => {
    if (!existsSync(path)) writeFileAtomicUnlocked(path, content);
  });
}

/** Append a line under a date heading, creating the heading when needed. */
function appendDatedEntry(path: string, line: string, now: Date): void {
  withFileLock(path, () => writeFileAtomicUnlocked(path, datedContent(readFileOr(path), line, now)));
}

function datedContent(content: string, line: string, now: Date): string {
  const header = `# ${now.toISOString().slice(0, 10)}`;
  const body = content.trimEnd();
  const updated = body.includes(header) ? `${body}\n${line}` : `${body}\n\n${header}\n\n${line}`;
  return `${updated.trimStart()}\n`;
}

/** Append one operational-history line to an agent's completed-tasks log. */
export function appendCompletedTask(dir: string, text: string, now = new Date()): void {
  appendDatedEntry(join(dir, "completed-tasks.md"), `- [x] ${text}`, now);
}

/** Append one decision to an agent's decisions log. */
export function appendDecision(dir: string, text: string, now = new Date()): void {
  appendDatedEntry(join(dir, "decisions.md"), `- ${text}`, now);
}

export type KnowledgeKind = "knowledge" | "standard" | "decision" | "completed";

/** The persistent file a knowledge kind belongs to for one agent (§21). */
export function knowledgeFilePath(dataRoot: string, agent: KnowledgeAgent, kind: KnowledgeKind): string {
  const dir = knowledgeDir(dataRoot, agent);
  if (kind === "knowledge") return join(dir, "knowledge.md");
  if (kind === "standard") return join(dir, STANDARDS_FILE[agent]);
  if (kind === "decision") return join(dir, "decisions.md");
  return join(dir, "completed-tasks.md");
}

export interface KnowledgeEntry {
  dataRoot: string;
  agent: KnowledgeAgent;
  kind: KnowledgeKind;
  text: string;
  now?: Date;
  /** Who wrote it and how, for the note's history on the Knowledge page ("Backend", "wrote this while working on task 8f3a21"). */
  by?: string;
  what?: string;
  source?: string;
}

/**
 * The only write path into persistent knowledge. Deduplicates before writing,
 * so re-accepting the same insight cannot bloat the file.
 */
export function applyKnowledge(entry: KnowledgeEntry): { path: string; result: "added" | "duplicate" | "empty" } {
  const text = entry.text.trim();
  if (!text) return { path: "", result: "empty" };
  const path = knowledgeFilePath(entry.dataRoot, entry.agent, entry.kind);
  const now = entry.now ?? new Date();
  const added = withFileLock(path, () => addKnowledgeUnlocked(path, text, entry.kind, now));
  if (!added) return { path, result: "duplicate" };
  auditKnowledge(entry, path, text, now);
  return { path, result: "added" };
}

function addKnowledgeUnlocked(path: string, text: string, kind: KnowledgeKind, now: Date): boolean {
  const existing = readFileOr(path);
  if (existing.toLowerCase().includes(text.toLowerCase())) return false;
  const dated = kind === "decision" || kind === "completed";
  const line = kind === "completed" ? `- [x] ${text}` : `- ${text}`;
  writeFileAtomicUnlocked(path, dated ? datedContent(existing, line, now) : `${existing.trimEnd()}\n\n${text}\n`);
  return true;
}

function auditKnowledge(entry: KnowledgeEntry, path: string, text: string, now: Date): void {
  if (entry.kind !== "completed") {
    const file = basename(path);
    const by = entry.by ?? AGENT_NAMES[entry.agent];
    try {
      recordEvent(entry.dataRoot, { agent: entry.agent, file, entry: text, by, what: entry.what ?? "wrote this", ...(entry.source ? { source: entry.source } : {}) }, now);
      settleProposals(entry.dataRoot, entry.agent, text);
    } catch {
      // The history is a nicety; the knowledge itself is saved.
    }
  }
}

/** Read an agent's knowledge slices for prompt context selection (§23). */
export function readKnowledgeSlices(
  dirs: readonly string[],
  standardsFile: string,
): { knowledge: string; standards: string; decisions: string; completed: string } {
  const file = (name: string) => readFirstExisting(dirs.map((dir) => join(dir, name)));
  return {
    knowledge: file("knowledge.md"),
    standards: file(standardsFile),
    decisions: file("decisions.md"),
    completed: file("completed-tasks.md"),
  };
}

/**
 * Read an agent's knowledge by agent key; bot-lobby dirs win per file over the
 * pre-rename ones. The user's notes on entries (Knowledge tab) sit right under
 * the entries they are about, so every agent reads them with the knowledge.
 */
export function readAgentKnowledge(roots: readonly string[], agent: KnowledgeAgent) {
  const slices = readKnowledgeSlices(roots.map((root) => knowledgeDir(root, agent)), STANDARDS_FILE[agent]);
  const notes = readNotes(roots[0]).filter((note) => note.agent === agent);
  const about = (file: string) => notes.filter((note) => note.file === file);
  // Pinned notes load first: repeated at the top of their file, so a trimmed slice still carries them.
  const shaped = (content: string, file: string) => pinFirst(notes.length ? annotate(content, about(file)) : content, pinnedEntries(roots[0], agent, file));
  return {
    knowledge: shaped(slices.knowledge, "knowledge.md"),
    standards: shaped(slices.standards, STANDARDS_FILE[agent]),
    decisions: shaped(slices.decisions, "decisions.md"),
    completed: shaped(slices.completed, "completed-tasks.md"),
  };
}

/** The pins still in the file, as a "Pinned" list above it. */
function pinFirst(content: string, pins: readonly string[]): string {
  const lines = content.split("\n").map((line) => line.trim());
  const kept = pins.filter((pin) => lines.includes(pin.trim()));
  if (kept.length === 0) return content;
  return `## Pinned (always loaded first)\n\n${kept.map((pin) => (/^[-*+]\s/.test(pin.trim()) ? pin.trim() : `- ${pin.trim()}`)).join("\n")}\n\n${content}`;
}
