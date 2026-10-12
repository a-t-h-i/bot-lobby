/**
 * Which of the library's scripts fit a step, and how an agent's prompt shows
 * them. Jev judges each script against the step when it is on (see
 * `classifier/scripts.ts`); without it, or when it fails, a script fits when
 * its name or purpose shares words with the step. Either way the prompt names
 * the library, so an agent can look for itself.
 */
import { score, tokenize } from "../knowledge/selector.ts";
import { listScripts, nameWords, scriptsDir, type ScriptEntry } from "./library.ts";

/** Most scripts one prompt suggests. */
export const MAX_SUGGESTED = 6;
/** Most scripts the oracle's prompt lists. */
export const MAX_LISTED = 40;

/** The scripts whose name or purpose shares the most words with the step, best first. */
export function keywordScripts(step: string, entries: readonly ScriptEntry[], limit = MAX_SUGGESTED): ScriptEntry[] {
  const tokens = tokenize(step);
  return entries
    .map((entry, index) => ({ entry, index, hits: score(`${nameWords(entry.name)} ${entry.purpose}`, tokens) }))
    .filter((scored) => scored.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .slice(0, limit)
    .map((scored) => scored.entry);
}

/** Picks the scripts that fit a step. */
export interface ScriptPicker {
  pick(step: string, entries: readonly ScriptEntry[], options?: { signal?: AbortSignal }): Promise<ScriptEntry[]>;
}

/** The picker that goes by shared words alone. */
export const keywordPicker: ScriptPicker = { pick: async (step, entries) => keywordScripts(step, entries) };

function line(entry: ScriptEntry): string {
  return `- \`${entry.name}\` — ${entry.purpose}\n  run: \`${entry.usage}\``;
}

/**
 * The Scripts layer of a worker's, scout's or QA agent's prompt: the scripts
 * that fit this step and how to run each, then where the rest are. "" while
 * the library is empty.
 */
export function scriptsBlock(dataRoot: string, entries: readonly ScriptEntry[], picked: readonly ScriptEntry[]): string {
  if (entries.length === 0) return "";
  const where = `The shared scripts library (${entries.length} script${entries.length === 1 ? "" : "s"}) is \`${scriptsDir(dataRoot)}\`; each file's first lines say what it does and how to run it.`;
  if (picked.length === 0) return `None of the shared scripts fits this step. ${where}`;
  return [
    "These shared scripts do part of this step: run one instead of doing its work by hand, and check its output as you would your own.",
    ...picked.map(line),
    where,
  ].join("\n");
}

/** The oracle's view of the library: every script by name and purpose, so it can point a brief at one. */
export function libraryBlock(dataRoot: string, entries: readonly ScriptEntry[] = listScripts(dataRoot)): string {
  const dir = scriptsDir(dataRoot);
  if (entries.length === 0) return `The shared scripts library (\`${dir}\`) is empty.`;
  const shown = entries.slice(0, MAX_LISTED).map((entry) => `- \`${entry.name}\` — ${entry.purpose}`);
  const more = entries.length > MAX_LISTED ? [`…and ${entries.length - MAX_LISTED} more in \`${dir}\`.`] : [];
  return [`Shared scripts (\`${dir}\`):`, ...shown, ...more].join("\n");
}

/**
 * The Scripts layer for one agent's step: the library read, the picker's
 * choice (shared words when it fails), and the block. "" with no scripts.
 */
export async function scriptsFor(dataRoot: string | undefined, step: string, picker: ScriptPicker = keywordPicker, signal?: AbortSignal): Promise<string> {
  if (!dataRoot) return "";
  const entries = listScripts(dataRoot);
  if (entries.length === 0) return "";
  let picked: ScriptEntry[];
  try {
    picked = await picker.pick(step, entries, signal ? { signal } : {});
  } catch {
    picked = keywordScripts(step, entries);
  }
  return scriptsBlock(dataRoot, entries, picked.slice(0, MAX_SUGGESTED));
}
