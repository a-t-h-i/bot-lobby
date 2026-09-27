/**
 * The Jev classifier's HTTP API (TypeSafe "System One"): typed questions over
 * one state, all answered in a single call with calibrated probabilities.
 * `POST {base}/v1/systemone` with a bearer key. Jev never writes text, so a
 * call is fast (tens to hundreds of milliseconds) and cheap; the engine uses
 * it for decisions that do not need a large model.
 *
 * Kept dependency-free: one request type, an injectable `fetch` for tests,
 * a time limit per attempt and one retry on rate limits, server errors and
 * unreachable hosts (a timeout is not retried).
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** What Jev judges: text, or JSON whose parts questions name with backticked paths (`` `draft` ``). */
export type State = string | JsonValue[] | { [key: string]: JsonValue };
/** Instructions and criteria: text or JSON; `null` leaves an option undescribed. */
export type Text = string | JsonValue[] | { [key: string]: JsonValue } | null;

/** Yes or no; the answer is the probability of yes. */
export interface NoulQuestion {
  type: "noul";
  instructions: Text;
  criteria?: { true?: Text; false?: Text } | null;
}

/** One of a set of labelled options (2 to 255). */
export interface ChoiceQuestion {
  type: "choice";
  instructions: Text;
  criteria: Record<string, Text>;
}

/** A position on ordered, described levels, lowest first. */
export interface ScoreQuestion {
  type: "score";
  instructions: Text;
  criteria: Text[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  /** How peaked the distribution is, 0 to 1. */
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted level index; may fall between two levels. */
  score: number;
  confidence: number;
  probabilities?: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneRequest {
  state: State;
  questions: Questions;
  model?: string;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export const SYSTEM_ONE_PATH = "/v1/systemone";

export function noul(instructions: Text, yes?: Text, no?: Text): NoulQuestion {
  return { type: "noul", instructions, ...(yes !== undefined || no !== undefined ? { criteria: { ...(yes !== undefined ? { true: yes } : {}), ...(no !== undefined ? { false: no } : {}) } } : {}) };
}

export function choice(instructions: Text, criteria: Record<string, Text>): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

export function score(instructions: Text, levels: Text[]): ScoreQuestion {
  return { type: "score", instructions, criteria: levels };
}

function probabilityOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

/** The probability of yes for a `noul` answer, or undefined when it is missing or malformed. */
export function yesOf(answers: Record<string, Answer> | undefined, key: string): number | undefined {
  const answer = answers?.[key];
  return answer?.type === "noul" ? probabilityOf(answer.noul) : undefined;
}

/** A `choice` answer's pick, its probability and its lead over the runner-up; undefined when malformed. */
export function choiceOf(answers: Record<string, Answer> | undefined, key: string): { choice: string; probability: number; margin: number; confidence: number } | undefined {
  const answer = answers?.[key];
  if (answer?.type !== "choice" || typeof answer.choice !== "string" || !answer.probabilities || typeof answer.probabilities !== "object") return undefined;
  const sorted = Object.values(answer.probabilities).map(probabilityOf).filter((value): value is number => value !== undefined).sort((a, b) => b - a);
  const probability = probabilityOf(answer.probabilities[answer.choice]) ?? sorted[0] ?? 0;
  return { choice: answer.choice, probability, margin: sorted.length > 1 ? sorted[0]! - sorted[1]! : sorted[0] ?? 0, confidence: probabilityOf(answer.confidence) ?? 0 };
}

/** A `score` answer's position (level index) and confidence; undefined when malformed. */
export function scoreOf(answers: Record<string, Answer> | undefined, key: string): { score: number; level: number; confidence: number } | undefined {
  const answer = answers?.[key];
  if (answer?.type !== "score" || typeof answer.score !== "number" || !Number.isFinite(answer.score)) return undefined;
  return { score: answer.score, level: Math.round(answer.score), confidence: probabilityOf(answer.confidence) ?? 0 };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface JevCallOptions {
  apiKey: string;
  baseUrl: string;
  model?: string;
  /** Time limit per attempt. */
  timeoutMs: number;
  /** Retries after a rate limit, server error or timeout; 1 by default. */
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

/** A failed call: `status` is the HTTP status when the API answered. */
export class JevError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  /** How long the API asked us to wait before retrying (`retry-after`), capped. */
  readonly waitMs?: number;
  constructor(message: string, retryable: boolean, status?: number, waitMs?: number) {
    super(message);
    this.name = "JevError";
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
    if (waitMs !== undefined) this.waitMs = waitMs;
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
/** Waits are short: the classifier sits on the interactive path, and every caller has a fallback. */
const MAX_WAIT_MS = 2000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfter(headers: Headers): number | undefined {
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_WAIT_MS);
  const seconds = Number(headers.get("retry-after"));
  if (headers.has("retry-after") && Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_WAIT_MS);
  return undefined;
}

/** The readable part of an error body: TypeSafe nests it under `detail`, gateways under `error`. */
function summarize(text: string): string {
  try {
    let current: unknown = JSON.parse(text);
    for (let depth = 0; depth < 2 && current && typeof current === "object"; depth += 1) {
      const record = current as Record<string, unknown>;
      const found = record.message ?? record.error ?? record.detail;
      if (typeof found === "string") return found;
      current = found;
    }
  } catch {
    // Not JSON: the raw text below.
  }
  return text.slice(0, 200) || "empty response";
}

async function attempt(url: string, body: string, options: JevCallOptions): Promise<SystemOneResponse> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(url, {
        method: "POST",
        headers: { ...options.headers, Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "bot-lobby" },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // Not retried: the time limit already bounds an interactive decision, and every caller has a fallback.
      if (timedOut) throw new JevError(`timed out after ${options.timeoutMs} ms`, false);
      throw new JevError(`could not reach ${url}: ${(error as Error).message}`, true);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new JevError(`API error ${response.status}: ${summarize(text)}`, RETRYABLE.has(response.status), response.status, retryAfter(response.headers));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new JevError("the API answered with something that is not JSON", false, response.status);
    }
    const record = parsed as Partial<SystemOneResponse> | undefined;
    if (!record || typeof record !== "object" || !record.answers || typeof record.answers !== "object") {
      throw new JevError("the API answered without answers", false, response.status);
    }
    return { model: typeof record.model === "string" ? record.model : options.model ?? "jev", answers: record.answers, ...(record.usage ? { usage: record.usage } : {}) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Ask every question over the state in one call. Throws `JevError` (or the abort reason) on failure. */
export async function systemOne(request: SystemOneRequest, options: JevCallOptions): Promise<SystemOneResponse> {
  const url = `${options.baseUrl.replace(/\/+$/, "")}${SYSTEM_ONE_PATH}`;
  const body = JSON.stringify({ ...(options.model ? { model: options.model } : {}), ...request });
  const retries = Math.max(0, options.retries ?? 1);
  for (let tried = 0; ; tried += 1) {
    options.signal?.throwIfAborted();
    try {
      return await attempt(url, body, options);
    } catch (error) {
      if (!(error instanceof JevError) || !error.retryable || tried >= retries) throw error;
      const wait = error.waitMs ?? Math.min(MAX_WAIT_MS, 300 * 2 ** tried);
      await (options.sleep ?? realSleep)(wait);
    }
  }
}
