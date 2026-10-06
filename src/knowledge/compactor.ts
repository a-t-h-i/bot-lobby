import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { KnowledgeAgent } from "./paths.ts";
import { AGENT_DIR_NAMES, KNOWLEDGE_FILES, knowledgeDir } from "./paths.ts";
import { readFirstExisting, readFileOr, writeFileEnsured } from "./store.ts";

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
  writeFileEnsured(path, `${entry.content.trim()}\n`);
  pruneArchives(dir, entry.file, Math.max(1, entry.backupCount));
  return { archive, before: previous.length, after: entry.content.trim().length };
}
