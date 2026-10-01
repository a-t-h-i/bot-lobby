/**
 * The Knowledge page's wording and grouping, copied from
 * `src/lobby/tabs/knowledge.ts`, `src/lobby/knowledge.ts` and
 * `src/knowledge/paths.ts` (which the page cannot import: they draw through
 * the terminal layout and read the disk). Pure and DOM-free.
 */
import type { EntryRefInfo, KnowledgeEntryInfo, KnowledgeFileInfo } from "@protocol"

export type KnowledgeAgentName = KnowledgeFileInfo["agent"]

export const AGENT_ORDER: readonly KnowledgeAgentName[] = ["master", "designer", "backend", "qa"]

export const AGENT_LABELS: Record<KnowledgeAgentName, string> = {
  master: "Master (oracle)",
  designer: "Designer",
  backend: "Backend",
  qa: "QA",
}

export const AGENT_DIR_NAMES: Record<KnowledgeAgentName, string> = {
  master: "Master",
  designer: "Designer",
  backend: "Backend",
  qa: "QA",
}

export const ARCHIVE_HINT = "Every write archives the version before it."

/** `812`, `1.2k`, `24k` (the terminal's `sizeWords`). */
export function sizeWords(chars: number): string {
  if (chars < 1000) return String(chars)
  const thousands = chars / 1000
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`
}

/** The warning above a file past its compaction threshold. */
export function overWarning(file: string): string {
  return `over the compaction threshold — ask the oracle to compact ${file}`
}

/** The picked entry as the server finds it again: its text and which duplicate it is. */
export function entryRef(entry: KnowledgeEntryInfo): EntryRefInfo {
  return { text: entry.text, occurrence: entry.occurrence }
}

export interface FileGroup {
  agent: KnowledgeAgentName
  files: KnowledgeFileInfo[]
  notes: number
}

/** Files grouped by agent in tab order, each group carrying its note count. */
export function groupFiles(files: readonly KnowledgeFileInfo[]): FileGroup[] {
  return AGENT_ORDER.map((agent) => {
    const own = files.filter((file) => file.agent === agent)
    return { agent, files: own, notes: own.reduce((total, file) => total + file.notes, 0) }
  }).filter((group) => group.files.length > 0)
}
