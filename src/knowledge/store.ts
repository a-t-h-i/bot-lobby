import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { knowledgeDir, STANDARDS_FILE, type KnowledgeAgent } from "./paths.ts";

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
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
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
  if (!existsSync(path)) writeFileEnsured(path, content);
}

/** Append a line under a date heading, creating the heading when needed. */
function appendDatedEntry(path: string, line: string, now: Date): void {
  const date = now.toISOString().slice(0, 10);
  const header = `# ${date}`;
  const body = readFileOr(path, "").trimEnd();
  const updated = body.includes(header) ? `${body}\n${line}` : `${body}\n\n${header}\n\n${line}`;
  writeFileEnsured(path, `${updated.trimStart()}\n`);
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
}

/**
 * The only write path into persistent knowledge. Deduplicates before writing,
 * so re-accepting the same insight cannot bloat the file.
 */
export function applyKnowledge(entry: KnowledgeEntry): { path: string; result: "added" | "duplicate" | "empty" } {
  const text = entry.text.trim();
  if (!text) return { path: "", result: "empty" };
  const path = knowledgeFilePath(entry.dataRoot, entry.agent, entry.kind);
  const existing = readFileOr(path);
  if (existing.toLowerCase().includes(text.toLowerCase())) return { path, result: "duplicate" };
  const now = entry.now ?? new Date();
  if (entry.kind === "decision") appendDecision(dirname(path), text, now);
  else if (entry.kind === "completed") appendCompletedTask(dirname(path), text, now);
  else writeFileEnsured(path, `${existing.trimEnd()}\n\n${text}\n`);
  return { path, result: "added" };
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

/** Read an agent's knowledge by agent key; bot-lobby dirs win per file over the pre-rename ones. */
export function readAgentKnowledge(roots: readonly string[], agent: KnowledgeAgent) {
  return readKnowledgeSlices(roots.map((root) => knowledgeDir(root, agent)), STANDARDS_FILE[agent]);
}
