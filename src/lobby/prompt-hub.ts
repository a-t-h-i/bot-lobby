/**
 * Bot-lobby's questions answerable from several surfaces, with the first
 * answer winning. A surface registers (`terminal` today; the web page later);
 * `open` shows the prompt on every surface, `answer` settles it once, and a
 * cancelled caller's `signal` withdraws every surface. The terminal drives
 * its prompts through `run`, which wraps today's code unchanged.
 */
import { lobbyTopics } from "./topics.ts";

export type PromptKind = "questionnaire" | "choose" | "confirm" | "text" | "sessionDialog";

/** A pending question in the shape the later web API lists. */
export interface WebPrompt {
  id: string;
  kind: PromptKind;
  createdAt: number;
  from: string;
  payload: unknown;
}

/** One surface a prompt shows on; `withdraw` takes it back off screen. */
export interface PromptSurface {
  name: string;
  show(prompt: WebPrompt): void;
  withdraw(id: string): void;
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

function showOn(surfaces: Iterable<PromptSurface>, prompt: WebPrompt): void {
  for (const surface of surfaces) surface.show(prompt);
}

function withdrawFrom(surfaces: Iterable<PromptSurface>, id: string): void {
  for (const surface of surfaces) surface.withdraw(id);
}

/** Questions from several surfaces; the first answer wins. */
export class PromptHub {
  private seq = 0;
  private readonly pendingMap = new Map<string, Pending>();
  private readonly surfaces = new Map<string, PromptSurface>();
  private readonly outcomes: Outcome[] = [];

  /** Put a surface on show duty; returns its unregister function. */
  registerSurface(surface: PromptSurface): () => void {
    this.surfaces.set(surface.name, surface);
    for (const entry of this.pendingMap.values()) surface.show(entry.prompt);
    return () => {
      this.surfaces.delete(surface.name);
    };
  }

  /** The questions still waiting for an answer, oldest first. */
  pending(): WebPrompt[] {
    return [...this.pendingMap.values()].map((entry) => entry.prompt);
  }

  /** Show a prompt on every surface; the answer settles it later. */
  open(kind: PromptKind, from: string, payload: unknown): WebPrompt {
    this.seq += 1;
    const prompt: WebPrompt = { id: nextId(this.seq), kind, createdAt: Date.now(), from, payload };
    this.pendingMap.set(prompt.id, { prompt });
    showOn(this.surfaces.values(), prompt);
    lobbyTopics.bump("prompts");
    return prompt;
  }

  /**
   * Settle `id` with `value`. True when this call won; false when the prompt
   * is already settled or unknown (the later web API answers 409 then).
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
    withdrawFrom(this.surfaces.values(), id);
    this.outcomes.push({ id, value, how });
    if (this.outcomes.length > MAX_OUTCOMES) this.outcomes.splice(0, this.outcomes.length - MAX_OUTCOMES);
    lobbyTopics.bump("prompts");
  }

  /**
   * Run today's terminal code for a prompt: it shows on every surface, the
   * terminal's `show` answers it, and a cancelled `signal` withdraws them
   * all. With only the terminal registered this is exactly today's behaviour.
   */
  async run<T>(kind: PromptKind, from: string, payload: unknown, show: (prompt: WebPrompt) => Promise<T>, options?: { signal?: AbortSignal }): Promise<T> {
    const prompt = this.open(kind, from, payload);
    const signal = options?.signal;
    if (signal?.aborted) return this.cancelled(prompt.id, show, prompt);
    const onAbort = () => this.dismiss(prompt.id);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const value = await show(prompt);
      return this.claim(prompt.id, value);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** The caller was already cancelled: withdraw every surface, keep today's result. */
  private async cancelled<T>(id: string, show: (prompt: WebPrompt) => Promise<T>, prompt: WebPrompt): Promise<T> {
    this.pendingMap.delete(id);
    withdrawFrom(this.surfaces.values(), id);
    lobbyTopics.bump("prompts");
    return this.remember(id, await show(prompt));
  }

  /** Claim the win for `value`, unless another surface answered first. */
  private claim<T>(id: string, value: T): T {
    if (!this.pendingMap.has(id)) return this.remembered(id, value);
    this.settle(id, value, "answered");
    return value;
  }

  private remember<T>(id: string, value: T): T {
    if (!this.outcome(id)) this.outcomes.push({ id, value, how: "cancelled" });
    lobbyTopics.bump("prompts");
    return value;
  }

  private remembered<T>(id: string, fallback: T): T {
    const outcome = this.outcome(id);
    return (outcome?.value ?? fallback) as T;
  }
}

/** The process-wide hub; the terminal surface registers at lobby start. */
export const promptHub = new PromptHub();
