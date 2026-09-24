import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
