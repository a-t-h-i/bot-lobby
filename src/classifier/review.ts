/**
 * Jev's quick read of a pull request, for the Git tab: how big the change is,
 * how likely it is risky, to break callers, to touch security-sensitive code
 * or to change behaviour without tests, and what kind of change it is — in
 * one call, in a moment, without writing a word. It is a triage, not a review:
 * it says whether a full review by an agent is worth its tokens.
 */
import type { Classifier } from "./classifier.ts";
import { choice, choiceOf, noul, score, scoreOf, yesOf, type SystemOneRequest } from "./client.ts";
import { clip } from "./limits.ts";
import { TRIAGE_SIZES } from "./triage.ts";
import type { TriageSize } from "../schemas/task.ts";

const SIZE_LEVELS = [
  "trivial: a one-line or mechanical change (a rename, a typo, a version bump)",
  "small: a few files in one area, following an existing pattern",
  "medium: several files or two areas, with some design decisions",
  "large: a cross-cutting change, a new subsystem, a migration or an architecture change",
];

const KINDS: Record<string, string> = {
  feature: "New capability or behaviour",
  bugfix: "Existing behaviour was wrong and is fixed",
  refactor: "Restructures code without changing behaviour",
  tests: "Adds or fixes tests only",
  docs: "Documentation only",
  dependency: "Upgrades or changes dependencies",
  chore: "Configuration, build, tooling or cleanup",
};

/** The pull request as Jev reads it. */
export interface PullInput {
  title: string;
  body: string;
  /** Changed files with their line counts, e.g. `src/a.ts (+12 −3)`. */
  files: readonly string[];
  diff: string;
}

/** What Jev made of a pull request. */
export interface PullRead {
  size: TriageSize;
  sizeConfidence: number;
  /** Probabilities of yes, 0 to 1. */
  risky: number;
  breaking: number;
  security: number;
  testsMissing: number;
  kind?: string;
  kindProbability?: number;
  model: string;
  ms: number;
}

/** Characters of diff sent: the rest is what the agent's review is for. */
export const READ_DIFF_CHARS = 80_000;

export function pullRequest(input: PullInput): SystemOneRequest {
  return {
    state: {
      title: clip(input.title, 300),
      description: clip(input.body, 3000),
      changed_files: clip(input.files.join("\n"), 4000),
      diff: clip(input.diff, READ_DIFF_CHARS),
    },
    questions: {
      size: score("How big is the change in `diff`, judged by what it would take to review and verify?", SIZE_LEVELS),
      risky: noul(
        "Could merging `diff` break existing behaviour or cause harm: data loss, corrupted state, wrong results, concurrency bugs, performance cliffs, or an outage?",
        "Yes: there is a plausible way this breaks something that works today.",
        "No: it is low-risk, well contained, or purely additive.",
      ),
      breaking: noul(
        "Does `diff` change a public API, a config or file format, a database schema or a command-line interface in a way that breaks existing callers or users?",
        "Yes: something outside this change has to adapt.",
        "No: existing callers and data keep working as they are.",
      ),
      security: noul(
        "Does `diff` touch authentication, authorisation, secrets, input validation, cryptography, or other security-sensitive code?",
        "Yes: a mistake here could be a vulnerability.",
        "No: nothing in it is security-relevant.",
      ),
      tests_missing: noul(
        "Does `diff` change behaviour without adding or updating tests that cover the change?",
        "Yes: the behaviour changes and no test in the diff covers it.",
        "No: it adds or updates tests for what it changes, or it changes no behaviour.",
      ),
      kind: choice("What kind of change is `diff`?", KINDS),
    },
  };
}

/** Jev's read of a pull request, or undefined when the classifier is off or fails. */
export async function readPull(classifier: Classifier, input: PullInput, signal?: AbortSignal): Promise<PullRead | undefined> {
  if (!classifier.enabled("review")) return undefined;
  const result = await classifier.ask("review", pullRequest(input), signal ? { signal } : {});
  if (!result) return undefined;
  const size = scoreOf(result.answers, "size");
  if (!size) return undefined;
  const kind = choiceOf(result.answers, "kind");
  return {
    size: TRIAGE_SIZES[Math.max(0, Math.min(TRIAGE_SIZES.length - 1, size.level))]!,
    sizeConfidence: size.confidence,
    risky: yesOf(result.answers, "risky") ?? 0,
    breaking: yesOf(result.answers, "breaking") ?? 0,
    security: yesOf(result.answers, "security") ?? 0,
    testsMissing: yesOf(result.answers, "tests_missing") ?? 0,
    ...(kind ? { kind: kind.choice, kindProbability: kind.probability } : {}),
    model: result.model,
    ms: result.ms,
  };
}

const CONCERN = 0.5;

/** The concerns worth a look, most likely first, as words. */
export function concerns(read: PullRead): string[] {
  const found: Array<[number, string]> = [
    [read.risky, "risky"],
    [read.security, "touches security"],
    [read.breaking, "may break callers"],
    [read.testsMissing, "no tests for the change"],
  ];
  return found.filter(([probability]) => probability >= CONCERN).sort((a, b) => b[0] - a[0]).map(([, words]) => words);
}

/** Whether a full review by an agent is worth its tokens: a concern, or a change too big to skim. */
export function worthReview(read: PullRead): boolean {
  return concerns(read).length > 0 || read.size === "large";
}

/** One line: `medium · bugfix · risky 0.71, no tests for the change 0.64 → worth a full review`. */
export function readLine(read: PullRead): string {
  const kind = read.kind ? ` · ${read.kind}` : "";
  const flagged = concerns(read);
  const figures = [
    ["risky", read.risky],
    ["security", read.security],
    ["breaking", read.breaking],
    ["tests missing", read.testsMissing],
  ] as const;
  const detail = flagged.length > 0
    ? figures.filter(([, probability]) => probability >= CONCERN).sort((a, b) => b[1] - a[1]).map(([name, probability]) => `${name} ${probability.toFixed(2)}`).join(", ")
    : "nothing stands out";
  return `${read.size}${kind} · ${detail} → ${worthReview(read) ? "worth a full review" : "looks routine"}`;
}
