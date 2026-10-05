/**
 * Asking the user from a subagent. A subagent runs as `pi --mode rpc` with no
 * terminal of its own, so its `ask_user_question` goes out as an RPC editor
 * dialog carrying the questions (marked with `RELAY_TITLE`); the runner in the
 * master process answers it by putting the questionnaire to the user and
 * sends the answers back the same way. Only runs the master lets ask (the
 * designer's) get the tool: it sets `ASK_ENV` for them.
 */
import { previewRoot } from "../state/previews.ts";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { validHtmlPreview, MAX_OPTIONS, MAX_QUESTIONS, type AskQuestion, type AskResult, type Asker } from "./types.ts";

/** Env flag the master sets for a subagent that may ask the user. */
export const ASK_ENV = "BOT_LOBBY_ASK";
/** Title of the RPC dialog that carries a relayed questionnaire. */
export const RELAY_TITLE = "bot-lobby:ask_user_question";

export function relayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ASK_ENV] === "1";
}

/** Where an agent saves the images it shows the user for a task: outside the repository, so they are never part of its change. */
export function previewDir(taskId: string, root?: string): string {
  return join(previewRoot(root), taskId.replace(/[^\w.-]/g, "_"));
}

/** Image paths made absolute, so the master finds them whatever its cwd. */
function withAbsoluteImages(questions: readonly AskQuestion[], cwd: string): AskQuestion[] {
  return questions.map((question) => ({
    ...question,
    options: question.options.map((option) => (option.image && !isAbsolute(option.image) ? { ...option, image: resolve(cwd, option.image) } : option)),
  }));
}

/** The answers the master sent back, or undefined when they do not read as answers. */
export function readRelayAnswer(value: string | undefined): AskResult | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<AskResult>;
    if (!Array.isArray(parsed.answers) || typeof parsed.cancelled !== "boolean") return undefined;
    return { answers: parsed.answers, cancelled: parsed.cancelled, ...(typeof parsed.globalNote === "string" ? { globalNote: parsed.globalNote } : {}) };
  } catch {
    return undefined;
  }
}

const text = (value: unknown): value is string => typeof value === "string";

/** One relayed question as the questionnaire can show it, or undefined when it is not one. */
function asQuestion(value: unknown): AskQuestion | undefined {
  const raw = value as Partial<AskQuestion> | null;
  if (!raw || !text(raw.question) || !text(raw.header) || !Array.isArray(raw.options)) return undefined;
  if (raw.options.some((option) => option?.htmlPreview !== undefined && !validHtmlPreview(option.htmlPreview))) return undefined;
  const options = raw.options
    .filter((option) => option && text(option.label))
    .slice(0, MAX_OPTIONS)
    .map((option) => ({
      label: option.label,
      ...(text(option.description) ? { description: option.description } : {}),
      ...(text(option.preview) ? { preview: option.preview } : {}),
      ...(text(option.image) ? { image: option.image } : {}),
      ...(validHtmlPreview(option.htmlPreview) ? { htmlPreview: option.htmlPreview } : {}),
    }));
  if (options.length === 0) return undefined;
  return { question: raw.question, header: raw.header, options, ...(raw.multiSelect === true ? { multiSelect: true } : {}) };
}

/**
 * The questions a relayed dialog carries, or undefined when it is not one.
 * The master takes only what the questionnaire can show from them: the
 * subagent checked them, but its process is not trusted to have.
 */
export function readRelayRequest(title: string | undefined, prefill: string | undefined): AskQuestion[] | undefined {
  if (title !== RELAY_TITLE || !prefill) return undefined;
  try {
    const parsed = JSON.parse(prefill) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return undefined;
    const questions = parsed.questions.slice(0, MAX_QUESTIONS).map(asQuestion);
    return questions.length > 0 && questions.every(Boolean) ? (questions as AskQuestion[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Inside a subagent: the questions go to the master as an RPC dialog, and its answers come back. */
export const relayAsker: Asker = async (questions, ctx: ExtensionContext) => {
  const value = await ctx.ui.editor(RELAY_TITLE, JSON.stringify({ questions: withAbsoluteImages(questions, ctx.cwd) }));
  return readRelayAnswer(value) ?? { answers: [], cancelled: true };
};
