/**
 * Shared scripts for a step. Jev reads each script's name and purpose against
 * the step (one yes/no per script) and the ones that do part of it are put in
 * the agent's prompt with how to run them, so the agent runs the script rather
 * than working the job out again. A library longer than Jev is asked about is
 * narrowed by shared words first. Off, failed or out of time, shared words
 * decide (`scripts/pick.ts`).
 */
import type { Classifier } from "./classifier.ts";
import { noul, yesOf, type SystemOneRequest } from "./client.ts";
import { clip } from "./limits.ts";
import { score, tokenize } from "../knowledge/selector.ts";
import { keywordScripts, MAX_SUGGESTED, type ScriptPicker } from "../scripts/pick.ts";
import { nameWords, type ScriptEntry } from "../scripts/library.ts";

/** Scripts Jev is asked about for one step. */
export const MAX_CANDIDATES = 40;
/** The step waits this long for Jev, then goes with shared words. */
export const SCRIPTS_BUDGET_MS = 1500;

export interface ScriptCall {
  request: SystemOneRequest;
  /** The script each question key stands for. */
  keys: Map<string, ScriptEntry>;
}

/** The scripts to ask about: all of them, or the `MAX_CANDIDATES` that share the most words with the step. */
export function candidateScripts(step: string, entries: readonly ScriptEntry[]): ScriptEntry[] {
  if (entries.length <= MAX_CANDIDATES) return [...entries];
  const tokens = tokenize(step);
  return entries
    .map((entry, index) => ({ entry, index, hits: score(`${nameWords(entry.name)} ${entry.purpose}`, tokens) }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .slice(0, MAX_CANDIDATES)
    .map((scored) => scored.entry);
}

/** One request that asks, for each script, whether it does part of the step. */
export function scriptRequest(step: string, entries: readonly ScriptEntry[]): ScriptCall {
  const scripts: Record<string, string> = {};
  const questions: SystemOneRequest["questions"] = {};
  const keys = new Map<string, ScriptEntry>();
  entries.forEach((entry, position) => {
    const key = `k${position + 1}`;
    scripts[key] = clip(`${entry.name}: ${entry.purpose}`, 300);
    questions[key] = noul(`Does the script \`scripts.${key}\` (its file name and purpose) do all or part of \`task\`, so an agent doing the task should run it instead of doing that work by hand? Yes when running it is a step the task needs; no when it is about something else or only shares words with it.`);
    keys.set(key, entry);
  });
  return { request: { state: { task: clip(step, 3000), scripts }, questions }, keys };
}

/**
 * A picker on Jev: the scripts it judges to do part of the step, most likely
 * first. Shared words decide when it is off or cannot judge.
 */
export function scriptPicker(classifier: Classifier, log?: (text: string) => void): ScriptPicker {
  return {
    async pick(step, entries, options = {}) {
      if (entries.length === 0) return [];
      if (!step.trim() || !classifier.enabled("scripts")) return keywordScripts(step, entries);
      const call = scriptRequest(step, candidateScripts(step, entries));
      const result = await classifier.ask("scripts", call.request, { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: Math.min(classifier.config.timeoutMs, SCRIPTS_BUDGET_MS) });
      if (!result) return keywordScripts(step, entries);
      const judged = [...call.keys].map(([key, entry]) => ({ entry, yes: yesOf(result.answers, key) }));
      // An answer to none of the questions says nothing: shared words decide.
      if (judged.every((entry) => entry.yes === undefined)) return keywordScripts(step, entries);
      const picked = judged
        .filter((entry) => (entry.yes ?? 0) >= classifier.config.thresholds.scriptRelevantAt)
        .sort((a, b) => b.yes! - a.yes!)
        .slice(0, MAX_SUGGESTED)
        .map((entry) => entry.entry);
      log?.(`scripts: ${picked.length > 0 ? picked.map((entry) => entry.name).join(", ") : "none"} fit the step (of ${entries.length}) · ${result.ms} ms`);
      return picked;
    },
  };
}
