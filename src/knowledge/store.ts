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

/** Read an agent's knowledge slices for prompt context selection (§23). */
export function readKnowledgeSlices(
  dir: string,
  standardsFile: string,
): { knowledge: string; standards: string; decisions: string; completed: string } {
  return {
    knowledge: readFileOr(join(dir, "knowledge.md")),
    standards: readFileOr(join(dir, standardsFile)),
    decisions: readFileOr(join(dir, "decisions.md")),
    completed: readFileOr(join(dir, "completed-tasks.md")),
  };
}

/** Read an agent's knowledge by agent key (convenience over directory paths). */
export function readAgentKnowledge(dataRoot: string, agent: KnowledgeAgent) {
  return readKnowledgeSlices(knowledgeDir(dataRoot, agent), STANDARDS_FILE[agent]);
}
