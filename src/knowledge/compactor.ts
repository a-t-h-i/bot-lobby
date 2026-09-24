import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { KnowledgeAgent } from "./paths.ts";
import { AGENT_DIR_NAMES, KNOWLEDGE_FILES, knowledgeDir } from "./paths.ts";
import { readFileOr, writeFileEnsured } from "./store.ts";

export interface KnowledgeAnalysis {
  /** Lines that say the same thing twice. */
  duplicates: string[];
  /** Lines with hedging or unresolved wording. */
  ambiguity: string[];
  /** Different statements sharing a subject: candidates for conflict review. */
  conflictCandidates: { subject: string; statements: string[] }[];
}

const AMBIGUITY = /\bmaybe|possibly|probably|tbd|todo|unclear|not sure|some kind|etc\.|approximately\b/i;
const HEDGE_STOPWORDS = new Set(["this", "that", "with", "from", "into", "when", "they", "have", "will", "should", "must"]);

function significantLines(content: string, minLength = 12): string[] {
  return content
    .split("\n")
    .map((line) => line.replace(/^[-*#>\s]+/, "").trim())
    .filter((line) => line.length >= minLength);
}

function normalize(line: string): string {
  return line
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function subjectKey(line: string): string {
  return normalize(line)
    .split(" ")
    .filter((word) => word.length > 3 && !HEDGE_STOPWORDS.has(word))
    .slice(0, 2)
    .join(" ");
}

function findDuplicates(lines: string[]): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const line of lines) {
    const key = normalize(line);
    if (seen.has(key)) duplicates.push(line);
    else seen.set(key, line);
  }
  return duplicates;
}

function findConflicts(lines: string[]): { subject: string; statements: string[] }[] {
  const groups = new Map<string, Set<string>>();
  for (const line of lines) {
    const key = subjectKey(line);
    if (key.split(" ").length < 2) continue;
    const statements = groups.get(key) ?? new Set<string>();
    statements.add(line);
    groups.set(key, statements);
  }
  return [...groups.entries()]
    .filter(([, statements]) => statements.size > 1)
    .map(([subject, statements]) => ({ subject, statements: [...statements] }));
}

/** Mechanical candidates that help the Master decide what to compact (§24). */
export function analyzeKnowledge(content: string): KnowledgeAnalysis {
  const lines = significantLines(content);
  return {
    duplicates: findDuplicates(lines),
    ambiguity: lines.filter((line) => AMBIGUITY.test(line)),
    conflictCandidates: findConflicts(lines),
  };
}

export interface OversizedFile {
  agent: KnowledgeAgent;
  file: string;
  chars: number;
}

/** Knowledge files that have grown past the configured compaction threshold. */
export function overThreshold(dataRoot: string, threshold: number): OversizedFile[] {
  const oversized: OversizedFile[] = [];
  for (const agent of Object.keys(AGENT_DIR_NAMES) as KnowledgeAgent[]) {
    for (const file of KNOWLEDGE_FILES[agent]) {
      const chars = readFileOr(join(knowledgeDir(dataRoot, agent), file)).length;
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
  writeFileEnsured(path, `${entry.content.trim()}\n`);
  pruneArchives(dir, entry.file, Math.max(1, entry.backupCount));
  return { archive, before: previous.length, after: entry.content.trim().length };
}
