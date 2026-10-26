/**
 * Which of the library's scripts fit a step, and how an agent's prompt shows
 * them. Jev judges each script against the step when it is on (see
 * `classifier/scripts.ts`); without it, or when it fails, a script fits when
 * its name or purpose shares words with the step. Either way the prompt names
 * the library, so an agent can look for itself.
 */
import { score, tokenize } from "../knowledge/selector.ts";
import { allScripts, BUILTIN_SCRIPTS_DIR, nameWords, scriptsDir, type ScriptEntry } from "./library.ts";

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

/** The built-ins not already suggested, by name, in one line: always in reach, never a long list. */
function builtinLine(entries: readonly ScriptEntry[], picked: readonly ScriptEntry[]): string {
  const rest = entries.filter((entry) => entry.builtin && !picked.includes(entry));
  if (rest.length === 0) return "";
  return `Built-in scripts (read-only; \`node ${BUILTIN_SCRIPTS_DIR}<name>.mjs --help\` shows what each does and how to run it): ${rest.map((entry) => entry.name.replace(/\.mjs$/, "")).join(", ")}. Prefer them to working the same thing out by hand: find_symbol over rounds of grep, outline_file before reading a long file, run_changed_tests and check_changed over whole suites.`;
}

/**
 * The Scripts layer of a worker's, scout's or QA agent's prompt: the scripts
 * that fit this step and how to run each, where the project's own are, and
 * the built-ins. "" with no scripts at all.
 */
export function scriptsBlock(dataRoot: string, entries: readonly ScriptEntry[], picked: readonly ScriptEntry[]): string {
  if (entries.length === 0) return "";
  const own = entries.filter((entry) => !entry.builtin).length;
  const where = own > 0 ? `The shared scripts library (${own} script${own === 1 ? "" : "s"}) is \`${scriptsDir(dataRoot)}\`; each file's first lines say what it does and how to run it.` : "";
  const builtins = builtinLine(entries, picked);
  if (picked.length === 0) return [`None of the shared scripts fits this step exactly.`, where, builtins].filter(Boolean).join(" ");
  return [
    "These shared scripts do part of this step: run one instead of doing its work by hand, and check its output as you would your own.",
    ...picked.map(line),
    where,
    builtins,
  ].filter(Boolean).join("\n");
}

/** The oracle's view of the library: every project script by name and purpose, and the built-ins, so it can point a brief at one. */
export function libraryBlock(dataRoot: string, entries: readonly ScriptEntry[] = allScripts(dataRoot)): string {
  const dir = scriptsDir(dataRoot);
  const own = entries.filter((entry) => !entry.builtin);
  const builtin = entries.filter((entry) => entry.builtin);
  const shown = own.slice(0, MAX_LISTED).map((entry) => `- \`${entry.name}\` — ${entry.purpose}`);
  const more = own.length > MAX_LISTED ? [`…and ${own.length - MAX_LISTED} more in \`${dir}\`.`] : [];
  return [
    own.length === 0 ? `The project's scripts library (\`${dir}\`) is empty.` : `Shared scripts (\`${dir}\`):`,
    ...shown,
    ...more,
    ...(builtin.length > 0 ? [`Built-in scripts every agent can run (\`${BUILTIN_SCRIPTS_DIR}\`): ${builtin.map((entry) => entry.name).join(", ")}. Name one in a brief when it does part of the step.`] : []),
  ].join("\n");
}

/**
 * The Scripts layer for one agent's step: the library read (built-ins
 * included), the picker's choice (shared words when it fails), and the block.
 */
export async function scriptsFor(dataRoot: string | undefined, step: string, picker: ScriptPicker = keywordPicker, signal?: AbortSignal): Promise<string> {
  if (!dataRoot) return "";
  const entries = allScripts(dataRoot);
  if (entries.length === 0) return "";
  let picked: ScriptEntry[];
  try {
    picked = await picker.pick(step, entries, signal ? { signal } : {});
  } catch {
    picked = keywordScripts(step, entries);
  }
  return scriptsBlock(dataRoot, entries, picked.slice(0, MAX_SUGGESTED));
}
