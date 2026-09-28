/**
 * `ask_user_question`: the model asks instead of guessing, with typed options
 * the user picks from (or answers in their own words). Registered by
 * bot-lobby in every pi session it loads in, the lobby's or not, so pi needs
 * no separate questionnaire extension. A subagent has no terminal: it gets
 * the tool only when the master lets it ask (the designer), and its questions
 * are relayed through the master (see relay.ts).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isSubagentProcess } from "../pi/quiet.ts";
import { askUser, type Asker } from "./dialog.ts";
import { isImagePath } from "./image.ts";
import { relayAsker, relayEnabled } from "./relay.ts";
import { ASK_TOOL, MAX_HEADER, MAX_LABEL, MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS, RESERVED, type AskQuestion, type AskResult } from "./types.ts";

export { ASK_TOOL };

const OptionSchema = Type.Object({
  label: Type.String({ maxLength: MAX_LABEL, description: `The option as the user sees and picks it: 1-5 words, at most ${MAX_LABEL} characters.` }),
  description: Type.Optional(Type.String({ description: "What choosing it means: its trade-offs or consequences. Markdown." })),
  preview: Type.Optional(Type.String({ description: "Markdown shown beside the options while this one is focused: a mockup, a code snippet, a diagram, a config. Only when seeing it helps the user compare." })),
  image: Type.Optional(Type.String({ description: "Path to a PNG (or JPEG, GIF, WebP) shown with the preview: a screenshot or a rendered mockup of this option. Drawn as the image in terminals that can, as coloured blocks (PNG) elsewhere." })),
});

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The whole question, clear and specific, ending with a question mark. Markdown." }),
  header: Type.String({ maxLength: MAX_HEADER, description: `A short chip naming the question (at most ${MAX_HEADER} characters), e.g. "Auth" or "Layout".` }),
  options: Type.Array(OptionSchema, { minItems: MIN_OPTIONS, maxItems: MAX_OPTIONS, description: `${MIN_OPTIONS}-${MAX_OPTIONS} distinct options. Put the one you recommend first and end its label with "(Recommended)". The user can always answer in their own words instead.` }),
  multiSelect: Type.Optional(Type.Boolean({ description: "True when several answers can apply together." })),
});

export const AskParams = Type.Object({
  questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: MAX_QUESTIONS, description: `1-${MAX_QUESTIONS} questions asked together.` }),
});

const DESCRIPTION = [
  "Ask the user one to four questions with options to pick from, when the answer would change what you do and you would otherwise guess.",
  "Each question has 2-4 options (the one you recommend first, its label ending in \"(Recommended)\"); the user can pick one (or several with multiSelect), or answer in their own words.",
  "Questions, descriptions and previews are Markdown. Give options a `preview` when the user needs to see them to choose: a UI mockup, a layout sketch, a code snippet, a config; the focused option's preview shows beside the list. An option can also carry an `image` file (a screenshot, a rendered mockup).",
  "Do not use it for yes/no confirmations of what you were already told to do, or for questions the conversation already answers.",
].join(" ");

const RELAYED = "Your questions reach the user through the oracle, and your clock stops while they answer. Ask only what is theirs to decide (a visual direction, a layout, a trade-off they care about), all at once; decide the rest yourself.";

/** Why a set of questions cannot be asked as given, or undefined when it can. */
export function invalidQuestions(questions: readonly AskQuestion[]): string | undefined {
  const asked = new Set<string>();
  for (const [index, question] of questions.entries()) {
    const at = `question ${index + 1}`;
    if (!question.question.trim()) return `${at} is empty`;
    if (asked.has(question.question.trim().toLowerCase())) return `${at} repeats an earlier question`;
    asked.add(question.question.trim().toLowerCase());
    const labels = new Set<string>();
    for (const option of question.options) {
      const label = option.label.trim().toLowerCase();
      if (!label) return `${at} has an option without a label`;
      if (RESERVED.has(label)) return `${at}: "${option.label}" is kept for the user's own answer; leave it out`;
      if (labels.has(label)) return `${at} has two options labelled "${option.label}"`;
      if (option.image?.trim() && !isImagePath(option.image)) return `${at}: the image for "${option.label}" must be a .png, .jpg, .gif or .webp file`;
      labels.add(label);
    }
  }
  return undefined;
}

/** What the model reads back: each question with its answer, or that it was skipped. */
export function answerSummary(questions: readonly AskQuestion[], result: AskResult): string {
  if (result.cancelled && result.answers.length === 0) {
    // A relay that could not ask anyone (auto mode) says why.
    if (result.globalNote) return result.globalNote;
    return "The user put the questions away without answering. Do not ask the same again right away: go on with your best judgement and say what you assumed, or ask something narrower.";
  }
  const lines = questions.map((question, index) => {
    const answer = result.answers.find((entry) => entry.questionIndex === index);
    const head = `${index + 1}. [${question.header}] ${question.question.replace(/\s+/g, " ").trim()}`;
    if (!answer) return `${head}\n   → (not answered)`;
    const text = answer.kind === "multi" ? (answer.selected ?? []).join(", ") : answer.answer ?? "";
    return `${head}\n   → ${text}${answer.kind === "custom" ? " (in the user's own words)" : ""}${answer.notes ? `\n   note: ${answer.notes}` : ""}`;
  });
  return [
    result.cancelled ? "The user answered some questions, then put the rest away:" : "The user answered:",
    ...lines,
    ...(result.globalNote ? ["", `Note: ${result.globalNote}`] : []),
  ].join("\n");
}

/**
 * Register `ask_user_question` in this pi session; in a subagent only when
 * the master relays its questions. `ask` is swappable for tests.
 */
export function registerAskTool(pi: ExtensionAPI, ask?: Asker): void {
  const subagent = isSubagentProcess();
  if (subagent && !relayEnabled()) return;
  const asker = ask ?? (subagent ? relayAsker : askUser);
  pi.registerTool({
    name: ASK_TOOL,
    label: "Ask",
    description: subagent ? `${DESCRIPTION} ${RELAYED}` : DESCRIPTION,
    promptSnippet: "Ask the user structured questions with options (and previews) instead of guessing",
    promptGuidelines: [
      "Use ask_user_question when a real decision is the user's and the answer changes your work; batch related questions (at most four) into one call.",
    ],
    parameters: AskParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const questions = (params as { questions: AskQuestion[] }).questions;
      const invalid = invalidQuestions(questions);
      if (invalid) throw new Error(`${invalid}.`);
      const result = await asker(questions, ctx, signal);
      return { content: [{ type: "text", text: answerSummary(questions, result) }], details: result };
    },
    renderCall(args, theme) {
      const questions = (args as { questions?: AskQuestion[] }).questions ?? [];
      const heads = questions.map((question) => question.header).filter(Boolean).join(", ");
      return new Text(`${theme.fg("toolTitle", theme.bold("ask"))} ${theme.fg("accent", `${questions.length} question${questions.length === 1 ? "" : "s"}`)}${heads ? ` ${theme.fg("muted", heads)}` : ""}`, 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as AskResult | undefined;
      if (!details) return new Container();
      if (details.cancelled && details.answers.length === 0) return new Text(theme.fg("warning", "put away without answering"), 0, 0);
      const lines = details.answers.map((answer) => `${theme.fg("success", "✓")} ${theme.fg("muted", answer.question.replace(/\s+/g, " ").slice(0, 60))} ${theme.fg("dim", "→")} ${theme.fg("accent", answer.kind === "multi" ? (answer.selected ?? []).join(", ") : answer.answer ?? "")}`);
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
