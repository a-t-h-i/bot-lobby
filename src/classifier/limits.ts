/**
 * Request bounds, enforced before anything is sent. Jev reads about 32K
 * tokens (roughly 120K characters of English); the budget leaves room for the
 * question text and JSON overhead.
 */
import type { SystemOneRequest } from "./client.ts";

export const LIMITS = {
  /** Characters kept per item (a file excerpt, a message, a plan). */
  itemChars: 4000,
  /** Characters allowed for the whole serialised request. */
  requestChars: 110_000,
  /** Options per `choice` question (the API accepts up to 255). */
  choiceOptions: 250,
} as const;

export const CLIP_MARKER = " […]";

/** Keep the head of a text within `max` characters, marking the cut. */
export function clip(text: string, max: number = LIMITS.itemChars): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - CLIP_MARKER.length)).trimEnd()}${CLIP_MARKER}`;
}

/** Keep the tail of a text within `max` characters (the newest part of a conversation). */
export function clipTail(text: string, max: number = LIMITS.itemChars): string {
  if (text.length <= max) return text;
  return `[…] ${text.slice(text.length - Math.max(0, max - 4)).trimStart()}`;
}

export function requestSize(request: SystemOneRequest): number {
  return JSON.stringify(request).length;
}

export function fitsBudget(request: SystemOneRequest): boolean {
  return requestSize(request) <= LIMITS.requestChars;
}
