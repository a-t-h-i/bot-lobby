/**
 * Triage: what the classifier makes of a request when a task starts — its
 * size, which domains it touches, whether it needs outside facts or a
 * clarifying question, and what kind of work it is — in one call. The Master
 * reads the answers as hints (so it can skip reasoning them out and skip
 * scouts it does not need); nothing here becomes a workflow rule. The same
 * size question holds back a quick fix that is really a task, and a clarify
 * question whose recommended option is clearly right is answered here.
 */
import type { Domain } from "../schemas/agent.ts";
import type { TaskTriage, TriageSize } from "../schemas/task.ts";
import type { Classifier } from "./classifier.ts";
import { choice, choiceOf, noul, score, scoreOf, yesOf, type SystemOneRequest } from "./client.ts";
import { clip } from "./limits.ts";
import { autoAnswer, type AutoAnswer } from "./answers.ts";
import { ANY_RELEVANT_FLOOR, indexFiles, likelyFiles, type FileScope, type IndexedFile } from "./files.ts";
import { DOMAIN_SPECS } from "../agents/registry.ts";
import { DOMAINS } from "../schemas/agent.ts";

export const TRIAGE_SIZES: readonly TriageSize[] = ["trivial", "small", "medium", "large"];

const SIZE_LEVELS = [
  "trivial: one small, mechanical edit in one file (a rename, a copy change, a one-line fix)",
  "small: a few files in one area, following an existing pattern",
  "medium: several files or two areas (for example an endpoint and its screen), with some design decisions",
  "large: a cross-cutting feature, a new subsystem, a migration or an architecture change",
];

export const TRIAGE_KINDS: Record<string, string> = {
  feature: "New capability or behaviour",
  bugfix: "Existing behaviour is wrong, crashes or differs from what it should do",
  refactor: "Restructure code without changing behaviour",
  tests: "Add or fix tests only",
  docs: "Documentation only",
  chore: "Configuration, dependencies, build, tooling or cleanup",
  investigation: "Understand, explain or diagnose something; no change requested yet",
};

export interface TriageInput {
  request: string;
  /** Top-level layout of the repository, e.g. `src (80 files)`. */
  layout?: readonly string[];
  /** What each domain owns, for the domain questions. */
  domains: ReadonlyArray<{ domain: Domain; owns: string }>;
}

function sizeQuestion(subject: string) {
  return score(`How big is the change ${subject} asks for, judged by what it would take to build and verify in this repository?`, SIZE_LEVELS);
}

export function triageRequest(input: TriageInput): SystemOneRequest {
  const questions: SystemOneRequest["questions"] = {
    size: sizeQuestion("`request`"),
    needs_research: noul(
      "Does building `request` depend on facts from outside the repository — library or API versions, third-party services, standards, current documentation?",
      "Yes: a decision needs outside evidence that cannot be read from the code.",
      "No: the repository and the request are enough.",
    ),
    ambiguous: noul(
      "Would building `request` as written probably produce the wrong thing without first asking the user a question?",
      "Yes: a decision that changes what gets built is missing or contradictory.",
      "No: a competent engineer could build it as written, deciding details from the codebase.",
    ),
    kind: choice("What kind of work does `request` ask for?", TRIAGE_KINDS),
  };
  for (const { domain, owns } of input.domains) {
    questions[`domain_${domain}`] = noul(`Does building \`request\` require changes in this area: ${owns}?`);
  }
  return {
    state: { request: clip(input.request, 6000), ...(input.layout && input.layout.length > 0 ? { repository_layout: input.layout.join(", ") } : {}) },
    questions,
  };
}

/** The request's triage, or undefined when the classifier is off or fails. */
export async function triageTask(classifier: Classifier, input: TriageInput, signal?: AbortSignal): Promise<TaskTriage | undefined> {
  if (!classifier.enabled("triage") || !input.request.trim()) return undefined;
  const result = await classifier.ask("triage", triageRequest(input), signal ? { signal } : {});
  if (!result) return undefined;
  const size = scoreOf(result.answers, "size");
  if (!size) return undefined;
  const domains: Partial<Record<Domain, number>> = {};
  for (const { domain } of input.domains) {
    const probability = yesOf(result.answers, `domain_${domain}`);
    if (probability !== undefined) domains[domain] = probability;
  }
  const kind = choiceOf(result.answers, "kind");
  return {
    size: TRIAGE_SIZES[Math.max(0, Math.min(TRIAGE_SIZES.length - 1, size.level))]!,
    sizeConfidence: size.confidence,
    domains,
    research: yesOf(result.answers, "needs_research") ?? 0,
    ambiguous: yesOf(result.answers, "ambiguous") ?? 0,
    ...(kind ? { kind: kind.choice, kindProbability: kind.probability } : {}),
    at: new Date().toISOString(),
  };
}

/** The repository's top level: directories with their file counts, then a few root files. */
export function repositoryLayout(files: readonly IndexedFile[], max = 14): string[] {
  const dirs = new Map<string, number>();
  const rootFiles: string[] = [];
  for (const { path } of files) {
    const slash = path.indexOf("/");
    if (slash < 0) rootFiles.push(path);
    else dirs.set(path.slice(0, slash), (dirs.get(path.slice(0, slash)) ?? 0) + 1);
  }
  const listed = [...dirs].sort((a, b) => b[1] - a[1]).map(([dir, count]) => `${dir}/ (${count} files)`);
  return [...listed, ...rootFiles.slice(0, 8)].slice(0, max);
}

/**
 * Triage a new task's request with the repository's layout, and attach the
 * likely files when file hints are on. Undefined when triage is off or fails.
 */
export async function triageWithContext(classifier: Classifier, scope: FileScope, request: string, signal?: AbortSignal): Promise<TaskTriage | undefined> {
  if (!classifier.enabled("triage")) return undefined;
  let layout: string[] = [];
  try {
    layout = repositoryLayout(await indexFiles(scope, classifier.config.exclude));
  } catch {
    layout = [];
  }
  const domains = DOMAINS.map((domain) => ({ domain, owns: DOMAIN_SPECS[domain].scoutFocus }));
  const [triage, likely] = await Promise.all([
    triageTask(classifier, { request, layout, domains }, signal),
    likelyFiles(classifier, scope, request, { topK: 6, budgetMs: classifier.config.fileHints.budgetMs, ...(signal ? { signal } : {}) }),
  ]);
  if (!triage) return undefined;
  const files = likely && likely.anyRelevant >= ANY_RELEVANT_FLOOR ? likely.files.map((file) => file.path) : [];
  return files.length > 0 ? { ...triage, likelyFiles: files } : triage;
}

/** The size of a quick fix prompt, or undefined when the classifier is off or fails. */
export async function quickFixSize(classifier: Classifier, prompt: string, signal?: AbortSignal): Promise<{ size: TriageSize; confidence: number } | undefined> {
  if (!classifier.enabled("triage")) return undefined;
  const largeAt = classifier.config.thresholds.quickFixLargeAt;
  const result = await classifier.ask("triage", { state: { prompt: clip(prompt, 6000) }, questions: { size: sizeQuestion("`prompt`") } }, {
    ...(signal ? { signal } : {}),
    saved: (answers) => {
      const sized = scoreOf(answers, "size");
      return sized && sized.level >= TRIAGE_SIZES.length - 1 && sized.confidence >= largeAt ? 1 : 0;
    },
  });
  const size = scoreOf(result?.answers, "size");
  if (!size) return undefined;
  return { size: TRIAGE_SIZES[Math.max(0, Math.min(TRIAGE_SIZES.length - 1, size.level))]!, confidence: size.confidence };
}

const HINT = 0.5;

/** The one-line path the triage suggests to the Master. */
export function suggestedPath(triage: TaskTriage): string {
  const touched = Object.entries(triage.domains).filter(([, probability]) => (probability ?? 0) >= HINT).map(([domain]) => domain);
  if (triage.ambiguous >= HINT) return "clarify first: the request as written probably misses a decision.";
  const smallish = (triage.size === "trivial" || triage.size === "small") && triage.sizeConfidence >= 0.6;
  const steps: string[] = [];
  if (smallish && touched.length === 1) steps.push(`fast track (${touched[0]}): no scouts, proposal or plan; delegate straight away`);
  else if (touched.length > 0) steps.push(`scout only ${touched.join(", ")}`);
  if (triage.research >= HINT) steps.push("summon the researcher for the outside facts");
  return steps.length > 0 ? `${steps.join("; ")}.` : "no strong signal; decide from the request.";
}

/**
 * The Master's hint block, while the task is still being shaped. Hints only:
 * the Master decides, and the engine enforces nothing from them.
 */
export function triageContext(triage: TaskTriage | undefined): string {
  if (!triage) return "";
  const domains = Object.entries(triage.domains)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([domain, probability]) => `${domain} ${(probability ?? 0).toFixed(2)}`)
    .join(" · ");
  return [
    "Classifier triage (hints from a fast model; you decide):",
    `- Size: ${triage.size} (confidence ${triage.sizeConfidence.toFixed(2)})`,
    domains ? `- Domains touched: ${domains}` : "",
    `- Outside research: ${triage.research >= HINT ? "likely needed" : "not needed"} (${triage.research.toFixed(2)})`,
    `- ${triage.ambiguous >= HINT ? "Probably ambiguous as written" : "Clear as written"} (${triage.ambiguous.toFixed(2)})`,
    triage.kind ? `- Kind: ${triage.kind}${triage.kindProbability !== undefined ? ` (${triage.kindProbability.toFixed(2)})` : ""}` : "",
    triage.likelyFiles && triage.likelyFiles.length > 0 ? `- Likely files: ${triage.likelyFiles.join(", ")}` : "",
    `- Suggested path: ${suggestedPath(triage)}`,
  ].filter(Boolean).join("\n");
}

/** A one-line summary for the activity log. */
export function triageLine(triage: TaskTriage): string {
  const touched = Object.entries(triage.domains).filter(([, probability]) => (probability ?? 0) >= HINT).map(([domain]) => domain);
  return `triage: ${triage.size} (${triage.sizeConfidence.toFixed(2)}) · ${touched.length > 0 ? touched.join(", ") : "no clear domain"}${triage.research >= HINT ? " · research" : ""}${triage.ambiguous >= HINT ? " · ambiguous" : ""}${triage.kind ? ` · ${triage.kind}` : ""}`;
}

/**
 * A clarify question the classifier can answer: its pick must be the
 * recommended option (marked `(Recommended)`, else the first), confident and
 * clearly ahead; otherwise the question goes to the user as before.
 */
export async function answerClarify(classifier: Classifier, question: string, options: readonly string[], context: { request: string; notes: string; proposal?: string }, signal?: AbortSignal): Promise<AutoAnswer | undefined> {
  if (options.length < 2 || !classifier.enabled("answers")) return undefined;
  const labels = options.map((option) => option.replace(/\s*\(recommended\)\s*/i, " ").trim());
  const marked = options.findIndex((option) => /\(recommended\)/i.test(option));
  const decided = await autoAnswer(classifier, [{ index: 0, from: "MASTER", text: question, options: labels.map((label) => ({ label, description: "" })), recommended: labels[marked >= 0 ? marked : 0]! }], { request: context.request, conversation: context.notes, ...(context.proposal ? { draft: context.proposal } : {}) }, signal);
  return decided?.[0];
}
