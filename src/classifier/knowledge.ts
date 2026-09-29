/**
 * Relevant knowledge. An agent's knowledge, standards and decisions are put in
 * its prompt, not looked up, so a gate ("does this step need the knowledge
 * base?") would have to guess before the agent knows what it needs, and a wrong
 * "no" is silent. What Jev does safely instead is the ranking the keyword
 * selector does badly: when a file is longer than the prompt has room for, Jev
 * judges each of its sections against the step (one yes/no per section) and the
 * ones that bear on it stay. A file that fits goes in whole and costs nothing.
 *
 * Whatever is left out is said so, with the file's path, so an agent that does
 * need it reads the rest itself. Any failure, timeout or switch-off keeps the
 * keyword selection, which is what agents got before.
 */
import { basename } from "node:path";
import { score, selectRelevant, splitSections, tokenize, type KnowledgeInput, type KnowledgeSelection } from "../knowledge/selector.ts";
import type { Classifier } from "./classifier.ts";
import { noul, yesOf, type SystemOneRequest } from "./client.ts";
import { clip } from "./limits.ts";

/** How many characters of each knowledge file a prompt has room for. */
export const KNOWLEDGE_BUDGET_CHARS = 4000;
/** A section is judged on its first characters; the whole section is kept when it stays. */
export const SECTION_EXCERPT_CHARS = 700;
/** Sections judged per file; a longer file is narrowed by keywords first. */
export const MAX_SECTIONS = 60;
/** The step waits this long for Jev, then goes with keywords. */
export const KNOWLEDGE_BUDGET_MS = 1500;

/** The three files a prompt carries: `knowledge`, `standards` and `decisions`. */
export type KnowledgeSlice = keyof KnowledgeSelection;
export type KnowledgePaths = Partial<Record<KnowledgeSlice, string>>;

export interface SectionCall {
  request: SystemOneRequest;
  /** The section each question key stands for, by index into the file's sections. */
  keys: Map<string, number>;
}

/** One request that asks about each candidate section of a file. */
export function sectionRequest(task: string, sections: readonly string[], candidates: readonly number[]): SectionCall {
  const entries: Record<string, string> = {};
  const questions: SystemOneRequest["questions"] = {};
  const keys = new Map<string, number>();
  candidates.forEach((index, position) => {
    const key = `s${position + 1}`;
    entries[key] = clip(sections[index]!, SECTION_EXCERPT_CHARS);
    questions[key] = noul(`Does \`sections.${key}\` hold a fact, rule or decision that an agent doing \`task\` should have in front of it? Yes when it bears on the code, files, conventions or choices the task touches; no when it is about something else or only shares words with it.`);
    keys.set(key, index);
  });
  return { request: { state: { task: clip(task, 3000), sections: entries }, questions }, keys };
}

/** The sections to judge: all of them, or the `MAX_SECTIONS` that share the most words with the task. */
export function candidateSections(task: string, sections: readonly string[]): number[] {
  const all = sections.map((_, index) => index);
  if (sections.length <= MAX_SECTIONS) return all;
  const tokens = tokenize(task);
  const scored = all.map((index) => ({ index, hits: score(sections[index]!, tokens) }));
  scored.sort((a, b) => b.hits - a.hits || b.index - a.index);
  return scored.slice(0, MAX_SECTIONS).map((entry) => entry.index).sort((a, b) => a - b);
}

/** What was kept of a file: its text and how many of its sections that was. */
export interface Kept {
  text: string;
  kept: number;
  total: number;
}

/**
 * The most relevant sections that fit `budget`, in the order of the file. A
 * section too long to fit on its own is cut to fit when nothing else is kept.
 */
export function keepSections(sections: readonly string[], relevance: ReadonlyMap<number, number>, floor: number, budget: number): Kept {
  const wanted = [...relevance].filter(([, value]) => value >= floor).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const chosen: number[] = [];
  const texts = new Map<number, string>();
  let used = 0;
  for (const [index] of wanted) {
    const text = sections[index]!;
    if (used + text.length <= budget) {
      chosen.push(index);
      texts.set(index, text);
      used += text.length + 2;
    } else if (chosen.length === 0) {
      chosen.push(index);
      texts.set(index, clip(text, budget));
      used = budget;
    }
  }
  chosen.sort((a, b) => a - b);
  return { text: chosen.map((index) => texts.get(index)!).join("\n\n").trim(), kept: chosen.length, total: sections.length };
}

/** The line that tells an agent what it was not given, and where all of it is. */
export function leftOutNote(kept: Kept, name: string, path?: string): string {
  const where = path ? ` The whole file is ${path}.` : "";
  return kept.kept === 0
    ? `_No section of ${name} bears on this step (${kept.total} sections).${where}_`
    : `_Kept ${kept.kept} of ${kept.total} sections of ${name} for this step.${where}_`;
}

/** Picks what an agent's prompt carries of its knowledge files. */
export interface KnowledgePicker {
  select(task: string, files: KnowledgeInput, options?: { signal?: AbortSignal; paths?: KnowledgePaths }): Promise<KnowledgeSelection>;
}

const SLICES: readonly KnowledgeSlice[] = ["knowledge", "standards", "decisions"];

/**
 * Jev's picks for one file over the budget, or undefined when it cannot judge
 * (off, failed, out of time, no key): the caller then uses keywords.
 */
async function rank(classifier: Classifier, task: string, content: string, budget: number, options: { signal?: AbortSignal }): Promise<{ kept: Kept; sections: string[]; ms: number } | undefined> {
  const sections = splitSections(content.trim());
  if (sections.length < 2) return undefined;
  const call = sectionRequest(task, sections, candidateSections(task, sections));
  const result = await classifier.ask("knowledge", call.request, { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: Math.min(classifier.config.timeoutMs, KNOWLEDGE_BUDGET_MS) });
  if (!result) return undefined;
  const relevance = new Map<number, number>();
  for (const [key, index] of call.keys) {
    const value = yesOf(result.answers, key);
    if (value !== undefined) relevance.set(index, value);
  }
  // An answer to none of the questions says nothing: keywords decide.
  if (relevance.size === 0) return undefined;
  return { kept: keepSections(sections, relevance, classifier.config.thresholds.knowledgeRelevantAt, budget), sections, ms: result.ms };
}

/**
 * A picker on Jev. Files that fit the prompt are untouched; a longer one keeps
 * the sections Jev judges to bear on the step, with a note of what was left
 * out. Standards are the exception to an empty result: they are rules for all
 * work, so when Jev sees none that applies the keyword selection stands.
 */
export function knowledgePicker(classifier: Classifier, log?: (text: string) => void, budget = KNOWLEDGE_BUDGET_CHARS): KnowledgePicker {
  return {
    async select(task, files, options = {}) {
      const plain = (kind: KnowledgeSlice) => selectRelevant(task, files[kind] ?? "", budget);
      const picked = await Promise.all(SLICES.map(async (kind): Promise<string> => {
        const content = files[kind] ?? "";
        if (content.trim().length <= budget || !task.trim() || !classifier.enabled("knowledge")) return plain(kind);
        try {
          const ranked = await rank(classifier, task, content, budget, options.signal ? { signal: options.signal } : {});
          if (!ranked) return plain(kind);
          const path = options.paths?.[kind];
          const name = path ? basename(path) : kind;
          if (ranked.kept.kept === 0 && kind === "standards") return plain(kind);
          log?.(`knowledge: kept ${ranked.kept.kept} of ${ranked.kept.total} sections of ${name} · ${ranked.ms} ms`);
          return [ranked.kept.text, leftOutNote(ranked.kept, name, path)].filter(Boolean).join("\n\n");
        } catch {
          return plain(kind);
        }
      }));
      return { knowledge: picked[0]!, standards: picked[1]!, decisions: picked[2]! };
    },
  };
}
