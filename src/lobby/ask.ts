/**
 * The oracle puts the planning panel's questions to the user one at a time
 * through the ask-user-question library (`@juicesharp/rpiv-ask-user-question`):
 * a tabbed questionnaire with each seat's options, the recommended one first,
 * and a free-text row on every question. The library only publishes a pi
 * extension entry point, so its `ask_user_question` tool is captured by
 * calling that entry with a `pi` whose `registerTool` keeps the definition
 * instead of registering it; its `execute` then runs the real questionnaire.
 * Without the library, pi's own select and input dialogs ask the same
 * questions in the same order.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PanelQuestion } from "./planner.ts";

/** The library's limits: at most 4 questions per questionnaire, 2-4 options each. */
export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
const MAX_HEADER = 16;
const MAX_LABEL = 60;
/** Labels the library reserves for its own rows. */
const RESERVED = new Set(["other", "type something.", "next"]);

export interface AskOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: AskOption[];
  multiSelect?: boolean;
}

export interface AskAnswer {
  questionIndex: number;
  question: string;
  kind: "option" | "custom" | "multi";
  answer: string | null;
  selected?: string[];
  notes?: string;
}

export interface AskResult {
  answers: AskAnswer[];
  cancelled: boolean;
  globalNote?: string;
}

/** Puts up to `MAX_QUESTIONS` questions to the user and returns what they chose. */
export type Asker = (questions: readonly AskQuestion[], ctx: ExtensionContext) => Promise<AskResult>;

interface ToolLike {
  execute(toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: ExtensionContext): Promise<{ details?: unknown }>;
}

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

/**
 * The user's turn for the next round: every question with who asked it and
 * the answer (`→ …`), their notes, and what they left unanswered. Undefined
 * when nothing was answered.
 */
export function answerMessage(questions: readonly PanelQuestion[], results: readonly AskResult[]): string | undefined {
  const lines: string[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];
  let answered = 0;
  results.forEach((result, chunk) => {
    if (result.globalNote?.trim()) notes.push(result.globalNote.trim());
    const offset = chunk * MAX_QUESTIONS;
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      const question = questions[offset + i];
      if (!question) break;
      const answer = result.answers.find((entry) => entry.questionIndex === i);
      const text = answerText(answer);
      const label = `${offset + i + 1}. [${question.from}] ${question.text.replace(/\s+/g, " ").trim()}`;
      if (!text) {
        skipped.push(label);
        continue;
      }
      answered += 1;
      lines.push(`${label}\n   → ${text}${answer?.kind === "custom" ? " (in my words)" : ""}`);
      if (answer?.notes?.trim()) lines.push(`   note: ${answer.notes.trim()}`);
    }
  });
  if (answered === 0 && notes.length === 0) return undefined;
  return [
    "Answers to the panel's questions:",
    ...lines,
    ...(notes.length > 0 ? ["", `Note: ${notes.join(" ")}`] : []),
    ...(skipped.length > 0 ? ["", "Not answered this round:", ...skipped] : []),
  ].join("\n");
}

/**
 * Capture the library's tool through its public extension entry: the entry
 * registers the tool on the `pi` it is given, so a `pi` whose `registerTool`
 * keeps the definition (and whose `on` ignores the library's own tool-list
 * reconciler) yields it without touching the session's tools. Undefined when
 * the library is missing or registers nothing.
 */
/**
 * The library ships TypeScript sources; a non-literal specifier keeps them out
 * of this package's typecheck (they are compiled by pi's loader at runtime).
 */
const ASK_LIBRARY: string = "@juicesharp/rpiv-ask-user-question";

export async function loadAskTool(pi: ExtensionAPI, load: () => Promise<unknown> = () => import(ASK_LIBRARY)): Promise<ToolLike | undefined> {
  try {
    const module = (await load()) as { default?: (pi: ExtensionAPI) => void };
    if (typeof module.default !== "function") return undefined;
    let captured: ToolLike | undefined;
    const capture = new Proxy(pi, {
      get(target, property, receiver) {
        if (property === "registerTool") return (tool: ToolLike & { name?: string }) => {
          if (tool.name === "ask_user_question") captured = tool;
        };
        if (property === "on") return () => () => {};
        return Reflect.get(target, property, receiver);
      },
    });
    module.default(capture);
    return captured;
  } catch {
    return undefined;
  }
}

/** Run one questionnaire through the captured tool. */
export function toolAsker(tool: ToolLike): Asker {
  return async (questions, ctx) => {
    const result = await tool.execute(`bot-lobby-panel-${Date.now().toString(36)}`, { questions }, undefined, undefined, ctx);
    const details = result.details as Partial<AskResult> | undefined;
    return { answers: details?.answers ?? [], cancelled: details?.cancelled !== false, ...(details?.globalNote ? { globalNote: details.globalNote } : {}) };
  };
}

const TYPE_ANSWER = "Type an answer…";
const SKIP = "Skip";

/** The same questions through pi's built-in dialogs: pick an option, type an answer, or skip; esc stops. */
export function dialogAsker(): Asker {
  return async (questions, ctx) => {
    const answers: AskAnswer[] = [];
    for (const [index, question] of questions.entries()) {
      const choices = [...question.options.map((option) => option.label), TYPE_ANSWER, SKIP];
      const title = `${question.header} · ${index + 1}/${questions.length}\n\n${question.question}`;
      const choice = await ctx.ui.select(title, choices);
      if (choice === undefined) return { answers, cancelled: true };
      if (choice === SKIP) continue;
      if (choice === TYPE_ANSWER) {
        const typed = await ctx.ui.input(question.question, "your answer");
        if (typed === undefined) return { answers, cancelled: true };
        if (typed.trim()) answers.push({ questionIndex: index, question: question.question, kind: "custom", answer: typed.trim() });
        continue;
      }
      answers.push({ questionIndex: index, question: question.question, kind: "option", answer: choice });
    }
    return { answers, cancelled: false };
  };
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
