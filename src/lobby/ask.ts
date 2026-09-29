/**
 * The oracle puts the planning panel's questions to the user through the
 * questionnaire (`../ask`): a tab per question with each seat's options, the
 * recommended one first, and a row for an answer in the user's own words.
 * The panel's questions become questionnaires of at most four, and the
 * answers become the user's turn for the next round.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PanelQuestion, SettledQuestion } from "./planner.ts";
import { MAX_HEADER, MAX_LABEL, MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS, RESERVED, type AskAnswer, type AskOption, type AskQuestion, type AskResult } from "../ask/types.ts";
import type { Asker } from "../ask/dialog.ts";

export { MAX_QUESTIONS, MIN_OPTIONS, MAX_OPTIONS, type AskAnswer, type AskOption, type AskQuestion, type AskResult, type Asker };
export { askUser, dialogAsker } from "../ask/dialog.ts";

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Filler options for a question the panel asked without any. */
const DEFAULT_OPTIONS: readonly AskOption[] = [
  { label: "Go with the recommendation", description: "Let the panel pick the option it recommends." },
  { label: "Leave it open", description: "Skip this one for now; the panel may ask again." },
];

/** A panel question in the library's schema: seat as the chip, 2-4 unique, unreserved option labels. */
export function toAskQuestion(question: PanelQuestion): AskQuestion {
  const seen = new Set<string>();
  const options: AskOption[] = [];
  for (const option of question.options) {
    let label = clip(option.label, MAX_LABEL);
    if (!label || RESERVED.has(label.toLowerCase())) continue;
    for (let n = 2; seen.has(label.toLowerCase()); n++) label = clip(`${option.label} (${n})`, MAX_LABEL);
    seen.add(label.toLowerCase());
    options.push({ label, description: option.description.trim() || label });
    if (options.length === MAX_OPTIONS) break;
  }
  for (const filler of DEFAULT_OPTIONS) {
    if (options.length >= MIN_OPTIONS) break;
    if (!seen.has(filler.label.toLowerCase())) options.push({ ...filler });
  }
  return { question: question.text.trim(), header: clip(question.from, MAX_HEADER), options };
}

/** Split the round's questions into questionnaires of at most `MAX_QUESTIONS`, with unique question texts. */
export function questionnaires(questions: readonly PanelQuestion[]): AskQuestion[][] {
  const seen = new Set<string>();
  const asked = questions.map((question) => {
    const ask = toAskQuestion(question);
    let text = ask.question;
    for (let n = 2; seen.has(text.toLowerCase()); n++) text = `${ask.question} (${question.from}${n > 2 ? ` ${n}` : ""})`;
    seen.add(text.toLowerCase());
    return { ...ask, question: text };
  });
  const chunks: AskQuestion[][] = [];
  for (let i = 0; i < asked.length; i += MAX_QUESTIONS) chunks.push(asked.slice(i, i + MAX_QUESTIONS));
  return chunks;
}

function answerText(answer: AskAnswer | undefined): string | undefined {
  if (!answer) return undefined;
  if (answer.kind === "multi") return answer.selected && answer.selected.length > 0 ? answer.selected.join(", ") : undefined;
  return answer.answer?.trim() || undefined;
}

/** A multi-line answer keeps its lines under the `→` that opens it. */
function indented(text: string, by: string): string {
  return text.replace(/\n/g, `\n${by}`);
}

/** Every question of the round with the answer the user gave it, in the order asked. */
function answered(questions: readonly PanelQuestion[], results: readonly AskResult[]): Array<{ number: number; question: PanelQuestion; answer: AskAnswer | undefined; text: string | undefined }> {
  const rows: Array<{ number: number; question: PanelQuestion; answer: AskAnswer | undefined; text: string | undefined }> = [];
  results.forEach((result, chunk) => {
    const offset = chunk * MAX_QUESTIONS;
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      const question = questions[offset + i];
      if (!question) break;
      const answer = result.answers.find((entry) => entry.questionIndex === i);
      rows.push({ number: offset + i + 1, question, answer, text: answerText(answer) });
    }
  });
  return rows;
}

/**
 * What the user's reply settled: each question of the round with its answer,
 * or without one when they left it. The panel is never allowed to ask a
 * settled question again.
 */
export function settledQuestions(questions: readonly PanelQuestion[], results: readonly AskResult[]): SettledQuestion[] {
  return answered(questions, results).map(({ question, text }) => ({ from: question.from, question: question.text.replace(/\s+/g, " ").trim(), ...(text ? { answer: text } : {}) }));
}

/**
 * The user's turn for the next round: every question with who asked it and
 * the answer (`→ …`), their notes, and what they left unanswered. Undefined
 * when nothing was answered.
 */
export function answerMessage(questions: readonly PanelQuestion[], results: readonly AskResult[]): string | undefined {
  const lines: string[] = [];
  const skipped: string[] = [];
  const notes = results.map((result) => result.globalNote?.trim()).filter((note): note is string => Boolean(note));
  let count = 0;
  for (const { number, question, answer, text } of answered(questions, results)) {
    const label = `${number}. [${question.from}] ${question.text.replace(/\s+/g, " ").trim()}`;
    if (!text) {
      skipped.push(label);
      continue;
    }
    count += 1;
    lines.push(`${label}\n   → ${indented(text, "     ")}${answer?.kind === "custom" ? " (in my words)" : ""}`);
    if (answer?.notes?.trim()) lines.push(`   note: ${indented(answer.notes.trim(), "     ")}`);
  }
  if (count === 0 && notes.length === 0) return undefined;
  return [
    "Answers to the panel's questions:",
    ...lines,
    ...(notes.length > 0 ? ["", `Note: ${notes.join(" ")}`] : []),
    ...(skipped.length > 0 ? ["", "Not answered this round:", ...skipped] : []),
  ].join("\n");
}

/**
 * Put every question to the user, one questionnaire after another. Stopping
 * a questionnaire (esc) stops the rest; what was answered before it is kept.
 */
export async function askPanel(questions: readonly PanelQuestion[], ask: Asker, ctx: ExtensionContext): Promise<{ results: AskResult[]; stopped: boolean }> {
  const results: AskResult[] = [];
  for (const chunk of questionnaires(questions)) {
    const result = await ask(chunk, ctx);
    if (result.cancelled) return { results, stopped: true };
    results.push(result);
  }
  return { results, stopped: false };
}
