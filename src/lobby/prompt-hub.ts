/**
 * Bot-lobby's questions, answered in the web page. `open` puts a prompt in
 * the page's queue, `answer` settles it once (a late answer is refused), and
 * `ask` is what the agents' code awaits: it opens a prompt and resolves with
 * the answer, or with how it was put away. A cancelled caller's `signal`
 * withdraws the prompt.
 */
import { lobbyTopics } from "./topics.ts";

export type PromptKind = "questionnaire" | "choose" | "confirm" | "text" | "sessionDialog";

/** A pending question in the shape the web API lists. */
export interface WebPrompt {
  id: string;
  kind: PromptKind;
  createdAt: number;
  from: string;
  payload: unknown;
}

interface Pending {
  prompt: WebPrompt;
}

interface Outcome {
  id: string;
  value: unknown;
  how: "answered" | "dismissed" | "cancelled";
}

/** How many settled prompts are remembered (late answers report 409 off this). */
const MAX_OUTCOMES = 50;

function nextId(seq: number): string {
  return `p${seq}-${Date.now().toString(36)}`;
}

/** The questions waiting for the page; the first answer wins. */
export class PromptHub {
  private seq = 0;
  private readonly pendingMap = new Map<string, Pending>();
  private readonly waiters = new Map<string, (outcome: Outcome) => void>();
  private readonly outcomes: Outcome[] = [];

  /** The questions still waiting for an answer, oldest first. */
  pending(): WebPrompt[] {
    return [...this.pendingMap.values()].map((entry) => entry.prompt);
  }

  /** Show a prompt on every surface; the answer settles it later. */
  open(kind: PromptKind, from: string, payload: unknown): WebPrompt {
    this.seq += 1;
    const prompt: WebPrompt = { id: nextId(this.seq), kind, createdAt: Date.now(), from, payload };
    this.pendingMap.set(prompt.id, { prompt });
    lobbyTopics.bump("prompts");
    return prompt;
  }

  /**
   * Settle `id` with `value`. True when this call won; false when the prompt
   * is already settled or unknown (the web API answers 409 then).
   */
  answer(id: string, value: unknown): boolean {
    if (!this.pendingMap.has(id)) return false;
    this.settle(id, value, "answered");
    return true;
  }

  /** Take `id` back without an answer; false when already settled or unknown. */
  dismiss(id: string): boolean {
    if (!this.pendingMap.has(id)) return false;
    this.settle(id, undefined, "dismissed");
    return true;
  }

  /** What settled `id`, if it is still remembered. */
  outcome(id: string): Outcome | undefined {
    return this.outcomes.find((entry) => entry.id === id);
  }

  private settle(id: string, value: unknown, how: Outcome["how"]): void {
    this.pendingMap.delete(id);
    const outcome: Outcome = { id, value, how };
    this.outcomes.push(outcome);
    if (this.outcomes.length > MAX_OUTCOMES) this.outcomes.splice(0, this.outcomes.length - MAX_OUTCOMES);
    const waiter = this.waiters.get(id);
    this.waiters.delete(id);
    waiter?.(outcome);
    lobbyTopics.bump("prompts");
  }

  /**
   * Open a prompt and wait for its outcome: the page's answer, or `dismissed`
   * / `cancelled` when it is put away or `signal` aborts first.
   */
  ask(kind: PromptKind, from: string, payload: unknown, options?: { signal?: AbortSignal }): Promise<{ how: Outcome["how"]; value: unknown }> {
    const signal = options?.signal;
    if (signal?.aborted) return Promise.resolve({ how: "cancelled", value: undefined });
    const prompt = this.open(kind, from, payload);
    return new Promise((resolve) => {
      const onAbort = () => {
        if (this.pendingMap.has(prompt.id)) this.settle(prompt.id, undefined, "cancelled");
      };
      this.waiters.set(prompt.id, (outcome) => {
        signal?.removeEventListener("abort", onAbort);
        resolve({ how: outcome.how, value: outcome.value });
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** The process-wide hub. */
export const promptHub = new PromptHub();
