import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");
const cache = new Map<string, string>();

/** Load a prompt layer by filename from the extension's prompts/ directory. */
export function loadPrompt(file: string): string {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const content = readFileSync(join(PROMPTS_DIR, file), "utf8").trim();
  cache.set(file, content);
  return content;
}

/** Drop memoized prompts so prompt edits are picked up without a restart. */
export function clearPromptCache(): void {
  cache.clear();
}
