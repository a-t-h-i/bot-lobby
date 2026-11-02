import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { KnowledgeAgent } from "./paths.ts";
import { AGENT_DIR_NAMES, KNOWLEDGE_FILES, historyDir, knowledgeDir } from "./paths.ts";
import { refreshCatalogue } from "./catalogue.ts";
import { readNotes } from "./notes.ts";
import { pinnedEntries } from "./ledger.ts";
import { withFileLock } from "../desk/lock.ts";
import { readFirstExisting, readFileOr, writeFileAtomic } from "./store.ts";

export interface OversizedFile {
  agent: KnowledgeAgent;
  file: string;
  chars: number;
}

/** Knowledge files past the configured compaction threshold, sized from the merged read roots. */
export function overThreshold(roots: readonly string[], threshold: number): OversizedFile[] {
  const oversized: OversizedFile[] = [];
  for (const agent of Object.keys(AGENT_DIR_NAMES) as KnowledgeAgent[]) {
    for (const file of KNOWLEDGE_FILES[agent]) {
      const paths = roots.map((root) => join(knowledgeDir(root, agent), file));
      const chars = readFirstExisting(paths).length;
      if (chars > threshold) oversized.push({ agent, file, chars });
    }
  }
  return oversized.sort((a, b) => b.chars - a.chars);
}

function archiveDir(dataRoot: string, agent: KnowledgeAgent): string {
  return join(dataRoot, "archive", AGENT_DIR_NAMES[agent]);
}

function pruneArchives(dir: string, file: string, keep: number): void {
  const prefix = `${file}.`;
  const backups = readdirSync(dir)
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".bak"))
    .sort();
  for (const stale of backups.slice(0, Math.max(0, backups.length - keep))) {
    rmSync(join(dir, stale), { force: true });
  }
}

/**
 * §24: archive the current file outside the retrieval paths, then replace it
 * with the compacted version the Master approved.
 */
export function compactKnowledgeFile(entry: {
  dataRoot: string;
  agent: KnowledgeAgent;
  file: string;
  content: string;
  backupCount: number;
  now?: Date;
}): { archive: string; before: number; after: number } {
  if (!KNOWLEDGE_FILES[entry.agent].includes(entry.file)) {
    throw new Error(`"${entry.file}" is not a knowledge file for ${entry.agent}`);
  }
  const path = join(knowledgeDir(entry.dataRoot, entry.agent), entry.file);
  const previous = readFileOr(path);
  const dir = archiveDir(entry.dataRoot, entry.agent);
  mkdirSync(dir, { recursive: true });
  const stamp = (entry.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const archive = join(dir, `${basename(entry.file)}.${stamp}.bak`);
  writeFileSync(archive, previous, "utf8");
  writeFileAtomic(path, `${entry.content.trim()}\n`);
  pruneArchives(dir, entry.file, Math.max(1, entry.backupCount));
  return { archive, before: previous.length, after: entry.content.trim().length };
}

/**
 * Permanent, searchable history: a `history/` sibling of the rotating
 * `archive/` backups. Backup rotation only ever prunes `archive/<Agent>/*.bak`;
 * nothing under `history/` is pruned, so archived material stays findable.
 * The directory itself lives in paths.ts, where the catalogue can index it.
 */
export function historyPath(dataRoot: string, agent: KnowledgeAgent, file: string): string {
  return join(historyDir(dataRoot, agent), basename(file));
}

/** The material being removed, appended to permanent history under a dated heading before anything is replaced. */
function appendHistory(dataRoot: string, agent: KnowledgeAgent, file: string, material: string, now: Date): string {
  const path = historyPath(dataRoot, agent, file);
  const heading = `# Archived from ${basename(file)} · ${now.toISOString()}`;
  withFileLock(path, () => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `\n\n${heading}\n\n${material.trim()}\n`, "utf8");
  });
  return path;
}

/** A heading line with everything until the next heading of the same or higher level. */
interface Section {
  heading: string;
  body: string;
}

/** Split markdown into heading-led sections; leading text before the first heading is its own section. */
function splitIntoSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const line of lines) {
    if (/^#{1,6} /.test(line)) {
      if (current) sections.push(current);
      current = { heading: line, body: "" };
    } else if (current) {
      current.body += `${line}\n`;
    } else {
      current = { heading: "", body: `${line}\n` };
    }
  }
  if (current) sections.push(current);
  return sections;
}

function renderSections(sections: readonly Section[]): string {
  return sections.map((section) => `${section.heading}\n${section.body}`.trim()).join("\n\n");
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Actual pinned entries and matching user annotations always survive. */
function isProtectedSection(section: Section, protectedEntries: readonly string[]): boolean {
  const text = `${section.heading}\n${section.body}`;
  return text.includes("> Note from the user")
    || protectedEntries.some((entry) => entry.trim().length > 0 && text.includes(entry));
}

/** A section that says it was superseded is clearly historical; age alone never archives. */
function isSuperseded(section: Section): boolean {
  const text = `${section.heading}\n${section.body}`;
  if (/\b(?:unresolved|pending)\b|\b(?:not(?:\s+been|\s+yet)?|never)\s+superseded\b/i.test(text)) return false;
  return /^#{1,6}\s+Superseded(?:\s|$)/i.test(section.heading)
    || /^Status:\s*superseded\s*$/im.test(section.body);
}

export interface MaintenancePlan {
  /** What stays in the active file. */
  keep: string;
  /** What leaves the active file for permanent history. */
  removed: string;
}

/**
 * The conservative maintenance policy: only exact duplicate sections and
 * clearly historical material (completed-task logs, sections explicitly marked
 * superseded) leave the active file. Pinned rules, user annotations, the
 * title section and anything ambiguous stay; age alone never archives.
 */
export function planMaintenance(file: string, content: string, protectedEntries: readonly string[] = []): MaintenancePlan {
  const sections = splitIntoSections(content);
  const completed = basename(file) === "completed-tasks.md";
  const seen = new Set<string>();
  const keep: Section[] = [];
  const removed: Section[] = [];
  sections.forEach((section, index) => {
    const text = `${section.heading}\n${section.body}`;
    const duplicate = normalized(text).length > 0 && seen.has(normalized(text));
    seen.add(normalized(text));
    const historical = completed ? index > 0 : isSuperseded(section);
    if (index === 0 || isProtectedSection(section, protectedEntries) || (!duplicate && !historical)) keep.push(section);
    else removed.push(section);
  });
  return { keep: renderSections(keep), removed: renderSections(removed) };
}

export type MaintenanceStatus = "maintained" | "busy" | "unchanged" | "failed";

export interface MaintenanceResult {
  agent: KnowledgeAgent;
  file: string;
  status: MaintenanceStatus;
  before: number;
  after: number;
  /** The permanent history entry that received the removed material. */
  history: string;
  error?: string;
}

export interface MaintenanceEntry {
  dataRoot: string;
  agent: KnowledgeAgent;
  file: string;
  backupCount: number;
  now?: Date;
  /** A rewritten active file to keep (the Master's compact semantics); absent plans maintenance from the conservative policy. */
  content?: string;
  /** Test seam: called after the history copy is durable, before the active file is replaced. */
  afterArchive?: () => void | Promise<void>;
}

/** One maintenance run per file at a time: a second run on an in-flight file is blocked, never interleaved. */
const inFlight = new Set<string>();

/**
 * Safe automatic maintenance of one knowledge file. The material being
 * removed — the whole previous version — is written to permanent history
 * BEFORE the active file is replaced, and the replacement itself is atomic
 * (temp file + rename), so an interrupted run leaves either the old file or
 * the fully-written new one, and never loses the history copy. The catalogue
 * is refreshed afterwards; a crashed run simply re-indexes on next use.
 */
export async function maintainKnowledgeFile(entry: MaintenanceEntry): Promise<MaintenanceResult> {
  if (!KNOWLEDGE_FILES[entry.agent].includes(entry.file)) {
    throw new Error(`"${entry.file}" is not a knowledge file for ${entry.agent}`);
  }
  const key = join(entry.dataRoot, AGENT_DIR_NAMES[entry.agent], entry.file);
  if (inFlight.has(key)) return { ...maintenanceBase(entry), status: "busy" };
  inFlight.add(key);
  try {
    return await maintainSnapshot(entry);
  } finally {
    inFlight.delete(key);
  }
}

function maintenanceBase(entry: MaintenanceEntry) {
  return { agent: entry.agent, file: entry.file, before: 0, after: 0, history: historyPath(entry.dataRoot, entry.agent, entry.file) };
}

async function maintainSnapshot(entry: MaintenanceEntry): Promise<MaintenanceResult> {
  const path = join(knowledgeDir(entry.dataRoot, entry.agent), entry.file);
  const previous = readFileOr(path);
  const keep = entry.content ?? planMaintenance(entry.file, previous, maintenanceProtections(entry)).keep;
  const base = { ...maintenanceBase(entry), before: previous.length, after: keep.trim().length };
  if (previous.trim() === keep.trim()) return { ...base, status: "unchanged" };
  appendHistory(entry.dataRoot, entry.agent, entry.file, previous, entry.now ?? new Date());
  await entry.afterArchive?.();
  if (!writeFileAtomic(path, `${keep.trim()}\n`, previous)) {
    return { ...base, after: readFileOr(path).length, status: "failed", error: "Knowledge changed during maintenance; retry on the current file." };
  }
  refreshMaintenanceCatalogue(entry.dataRoot);
  return { ...base, status: "maintained" };
}

function refreshMaintenanceCatalogue(dataRoot: string): void {
  try {
    refreshCatalogue([dataRoot]);
  } catch {
    // Recoverable: the next catalogue use re-indexes the current files.
  }
}

function maintenanceProtections(entry: MaintenanceEntry): string[] {
  const notes = readNotes(entry.dataRoot).filter((note) => note.agent === entry.agent && note.file === entry.file);
  return [...pinnedEntries(entry.dataRoot, entry.agent, entry.file), ...notes.map((note) => note.entry)];
}

export interface MaintenanceSchedule {
  /** Resolves with the maintenance outcome; never rejects (a failure is a "failed" result). */
  done: Promise<MaintenanceResult>;
}

/**
 * Schedule maintenance to run after the current response, outside the
 * response-critical path: the caller proceeds immediately, the file work
 * happens on the next event-loop turn, and failures resolve (not reject) so
 * an unobserved failure can never surface as an unhandled rejection.
 */
export function scheduleKnowledgeMaintenance(entry: MaintenanceEntry): MaintenanceSchedule {
  const done = new Promise<MaintenanceResult>((resolve) => {
    setImmediate(() => {
      maintainKnowledgeFile(entry).then(resolve, (error: unknown) => {
        resolve({ agent: entry.agent, file: entry.file, status: "failed", before: 0, after: 0, history: historyPath(entry.dataRoot, entry.agent, entry.file), error: error instanceof Error ? error.message : String(error) });
      });
    });
  });
  return { done };
}
