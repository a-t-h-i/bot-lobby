/**
 * Putting questions to the user: every question goes to the web page, through
 * the prompt hub, and waits there for the answer. Nothing is drawn in the
 * terminal. A question nobody can answer (no page is served, as in a print
 * run) is put away at once, so a model never waits on a screen that is not
 * there.
 */
import { isAbsolute, resolve } from "node:path";
import { currentWebServer } from "../webui/server.ts";
import { promptHub } from "../lobby/prompt-hub.ts";
import type { AskAnswer, AskQuestion, AskResult, Asker } from "./types.ts";

let availability: (() => boolean) | undefined;

/** Whether the page is up to answer. */
export function canAsk(): boolean {
  return availability ? availability() : currentWebServer() !== undefined;
}

/** Tests say whether a page is there to answer. */
export function setCanAsk(next: (() => boolean) | undefined): void {
  availability = next;
}

/** Image paths made absolute, so the page's preview route finds them whatever the cwd. */
function withAbsoluteImages(questions: readonly AskQuestion[], cwd: string): AskQuestion[] {
  return questions.map((question) => ({
    ...question,
    options: question.options.map((option) => (option.image?.trim() && !isAbsolute(option.image.trim()) ? { ...option, image: resolve(cwd, option.image.trim()) } : option)),
  }));
}

/** What the page sent back, kept to the shape of a result; anything else reads as put away. */
function readResult(value: unknown): AskResult | undefined {
  const raw = value as Partial<AskResult> | null;
  if (!raw || !Array.isArray(raw.answers)) return undefined;
  return {
    answers: raw.answers.filter((answer): answer is AskAnswer => typeof answer === "object" && answer !== null && typeof (answer as AskAnswer).questionIndex === "number"),
    cancelled: raw.cancelled === true,
    ...(typeof raw.globalNote === "string" ? { globalNote: raw.globalNote } : {}),
  };
}

/** The questionnaire in the page. */
export const askUser: Asker = async (questions, ctx, signal, from) => {
  if (questions.length === 0 || !canAsk()) return { answers: [], cancelled: true };
  const outcome = await promptHub.ask("questionnaire", from ?? "oracle", { questions: withAbsoluteImages(questions, ctx.cwd) }, signal ? { signal } : undefined);
  return (outcome.how === "answered" ? readResult(outcome.value) : undefined) ?? { answers: [], cancelled: true };
};

/** A free-text answer (possibly several lines) in the page; undefined when put away. */
export async function askText(question: string, from = "orchestrate"): Promise<string | undefined> {
  if (!canAsk()) return undefined;
  const outcome = await promptHub.ask("text", from, { question });
  return outcome.how === "answered" && typeof outcome.value === "string" ? outcome.value : undefined;
}

/** One of `options` picked in the page; undefined when put away. */
export async function askChoice(title: string, options: string[], from = "orchestrate"): Promise<string | undefined> {
  if (!canAsk()) return undefined;
  const outcome = await promptHub.ask("choose", from, { title, options });
  return outcome.how === "answered" && typeof outcome.value === "string" ? outcome.value : undefined;
}
