/**
 * Obvious answers. The panel recommends an option for every question it
 * asks; when the conversation and the draft already make that option
 * clearly right, the classifier answers it instead of the user. The rule is
 * strict: the classifier's pick must BE the recommended option, at
 * `autoAnswerAt` or above and ahead of the runner-up by `autoAnswerMargin`.
 * Each question also offers "ask the user" (a preference or a fact only the
 * user has), so a question that is really the user's call is never forced
 * onto one of the options.
 */
import type { ClassifierThresholds } from "../schemas/configuration.ts";
import type { Classifier } from "./classifier.ts";
import { choice, choiceOf, type Answer, type SystemOneRequest, type Text } from "./client.ts";
import { clip, clipTail, LIMITS } from "./limits.ts";

export const ASK_THE_USER = "ask the user";

export interface AnswerCandidate {
  /** Position in the round's questions. */
  index: number;
  /** The seat the question serves. */
  from: string;
  text: string;
  /** Option labels without any "(Recommended)" marker, and what each means. */
  options: ReadonlyArray<{ label: string; description: string }>;
  /** The asker's recommended option, by label. */
  recommended: string;
}

export interface AutoAnswer {
  index: number;
  from: string;
  question: string;
  answer: string;
  probability: number;
}

export interface AnswerContext {
  /** The idea as first described. */
  request: string;
  /** The conversation so far, oldest first. */
  conversation: string;
  draft?: string;
}

function questionKey(index: number): string {
  return `q${index + 1}`;
}

/** Unique option keys: the label, numbered when two labels collide. */
function optionKeys(candidate: AnswerCandidate): string[] {
  const seen = new Set<string>();
  return candidate.options.map((option) => {
    let key = option.label.trim() || "option";
    for (let n = 2; seen.has(key.toLowerCase()) || key.toLowerCase() === ASK_THE_USER; n++) key = `${option.label.trim() || "option"} (${n})`;
    seen.add(key.toLowerCase());
    return key;
  });
}

export function answerRequest(candidates: readonly AnswerCandidate[], context: AnswerContext): SystemOneRequest {
  const questions: Record<string, ReturnType<typeof choice>> = {};
  for (const candidate of candidates) {
    const keys = optionKeys(candidate);
    const criteria: Record<string, Text> = {};
    candidate.options.slice(0, LIMITS.choiceOptions - 1).forEach((option, position) => {
      criteria[keys[position]!] = option.description || null;
    });
    criteria[ASK_THE_USER] = "Not settled by `conversation` or `draft`: it depends on the user's preference or priorities, or on facts only the user has.";
    questions[questionKey(candidate.index)] = choice(
      `The planning panel's ${candidate.from} seat asks the user: "${clip(candidate.text, 600)}". Which answer do \`request\`, \`conversation\` and \`draft\` already make clearly right? Pick ${JSON.stringify(ASK_THE_USER)} unless the evidence settles it.`,
      criteria,
    );
  }
  return {
    state: {
      request: clip(context.request, 3000),
      conversation: clipTail(context.conversation, 8000),
      draft: clip(context.draft ?? "", 6000),
    },
    questions,
  };
}

/** The questions the classifier settles: its pick is the recommended option, confident and clearly ahead. */
export function decideAnswers(answers: Record<string, Answer> | undefined, candidates: readonly AnswerCandidate[], thresholds: Pick<ClassifierThresholds, "autoAnswerAt" | "autoAnswerMargin">): AutoAnswer[] {
  const decided: AutoAnswer[] = [];
  for (const candidate of candidates) {
    const picked = choiceOf(answers, questionKey(candidate.index));
    if (!picked || picked.choice === ASK_THE_USER) continue;
    const keys = optionKeys(candidate);
    const position = keys.indexOf(picked.choice);
    if (position < 0) continue;
    const label = candidate.options[position]!.label;
    if (label.toLowerCase() !== candidate.recommended.toLowerCase()) continue;
    if (picked.probability < thresholds.autoAnswerAt || picked.margin < thresholds.autoAnswerMargin) continue;
    decided.push({ index: candidate.index, from: candidate.from, question: candidate.text, answer: label, probability: picked.probability });
  }
  return decided;
}

/** One call for the round's questions; undefined when the classifier is off or fails. */
export async function autoAnswer(classifier: Classifier, candidates: readonly AnswerCandidate[], context: AnswerContext, signal?: AbortSignal): Promise<AutoAnswer[] | undefined> {
  const eligible = candidates.filter((candidate) => candidate.options.length >= 2 && candidate.recommended);
  if (eligible.length === 0) return undefined;
  const result = await classifier.ask("answers", answerRequest(eligible, context), signal ? { signal } : {});
  if (!result) return undefined;
  return decideAnswers(result.answers, eligible, classifier.config.thresholds);
}
