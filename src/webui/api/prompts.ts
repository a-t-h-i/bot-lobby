/**
 * The question queue over HTTP: listing what waits, answering (the first
 * answer wins, anywhere), and dismissing. A late answer — the id is gone
 * because the terminal, another tab or a cancel settled it first — reads as
 * 409 `question_withdrawn`. Image paths in payloads become preview URLs the
 * page may load through `GET /files/preview/…`.
 */
import { promptHub } from "../../lobby/prompt-hub.ts";
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";
import { rewritePreviewImages } from "../files.ts";
import type { WebPrompt } from "../protocol.ts";

function withPreviewUrls(prompt: WebPrompt): WebPrompt {
  return { ...prompt, payload: rewritePreviewImages(prompt.payload) };
}

/** The questions still waiting for an answer, oldest first. */
export function promptsList(_ctx: ApiContext): { prompts: WebPrompt[] } {
  return { prompts: promptHub.pending().map(withPreviewUrls) };
}

/** Answer a question; 409 when it is already settled or unknown. */
export function promptsAnswer(body: { id: string; answer: unknown }, _ctx: ApiContext): { notice?: string } {
  if (!promptHub.answer(body.id, body.answer)) {
    fail(409, "question_withdrawn", "this question is already answered or gone");
  }
  return { notice: "answer sent" };
}

/** Take a question back without an answer (idempotent, so races stay quiet). */
export function promptsDismiss(body: { id: string }, _ctx: ApiContext): Record<string, never> {
  promptHub.dismiss(body.id);
  return {};
}
