/**
 * The questionnaire's shape: what a model (or the planning panel) asks, and
 * what comes back. The same shape `ask_user_question` has had in pi, so a
 * model's habits carry over: 1-4 questions, 2-4 options each, a short header,
 * multi-select, and a per-option preview (Markdown: a mockup, a snippet, a
 * diagram) shown beside the options.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The questionnaire tool's name, in this session and in the agents that may ask. */
export const ASK_TOOL = "ask_user_question";

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER = 16;
export const MAX_LABEL = 60;
export const MAX_PREVIEW_HTML = 100_000;
export const MAX_PREVIEW_CSS = 50_000;

/** The row under every question's options where the user writes their own answer. */
export const OWN_ANSWER = "Type something.";

/** Labels the questionnaire keeps for its own rows. */
export const RESERVED = new Set(["other", OWN_ANSWER.toLowerCase(), "next"]);

export interface AskOption {
  label: string;
  /** Explicit static HTML/CSS; never inferred from Markdown. */
  htmlPreview?: { html: string; css?: string };
  description?: string;
  /** Markdown shown beside the options while this one is focused. */
  preview?: string;
  /** An image file (PNG, JPEG, GIF or WebP) shown with the preview: a screenshot, a rendered mockup. */
  image?: string;
}

export function validHtmlPreview(value: unknown): value is NonNullable<AskOption["htmlPreview"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const preview = value as Record<string, unknown>;
  return Object.keys(preview).every((key) => key === "html" || key === "css")
    && typeof preview.html === "string" && preview.html.length <= MAX_PREVIEW_HTML
    && (preview.css === undefined || (typeof preview.css === "string" && preview.css.length <= MAX_PREVIEW_CSS));
}

export interface AskQuestion {
  question: string;
  /** A short chip naming the question (a topic, or who asks it). */
  header: string;
  options: AskOption[];
  multiSelect?: boolean;
}

export interface AskAnswer {
  questionIndex: number;
  question: string;
  /** A picked option, the user's own words, or several picked options. */
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

/**
 * Puts up to `MAX_QUESTIONS` questions to the user and returns what they
 * chose. `from` names who asks when it is not this session's model (an agent
 * whose questions the oracle relays).
 */
export type Asker = (questions: readonly AskQuestion[], ctx: ExtensionContext, signal?: AbortSignal, from?: string) => Promise<AskResult>;

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

/** Whether a path names an image the page can show. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.test(path.trim());
}
