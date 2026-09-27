/**
 * The classifier facade every feature calls. It never throws into the
 * workflow: any failure (no key, a timeout, an API error, a request over
 * budget) returns undefined, and the caller falls back to what bot-lobby did
 * before the classifier existed. Three failures in a row pause it for ten
 * minutes with a single warning, so a dead endpoint cannot tax every step.
 * Every call lands in the metrics log (kind `classifier`).
 */
import type { ClassifierConfig, ClassifierFeature } from "../schemas/configuration.ts";
import type { MetricRecord } from "../state/metrics.ts";
import { JevError, noul, systemOne, type Answer, type FetchLike, type SystemOneRequest } from "./client.ts";
import { fitsBudget, requestSize, LIMITS } from "./limits.ts";
import { jevEndpoint, resolveKey, type KeySource } from "./hosts.ts";

export type ClassifierPurpose = ClassifierFeature | "test";

/** What a call answered, with the served model and how long it took. */
export interface Classified {
  answers: Record<string, Answer>;
  model: string;
  ms: number;
}

export type TestResult = { ok: true; model: string; ms: number } | { ok: false; error: string };

export interface ClassifierDeps {
  /** Read live, so a settings change applies to the next call. */
  config: () => ClassifierConfig;
  keys?: KeySource;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  /** Receives one record per call. */
  metrics?: (record: MetricRecord) => void;
  /** One-off notices: a missing key, the breaker pausing the classifier. */
  warn?: (message: string) => void;
  now?: () => number;
}

export const BREAKER_FAILURES = 3;
export const BREAKER_PAUSE_MS = 10 * 60 * 1000;

export class Classifier {
  private readonly deps: ClassifierDeps;
  private failures = 0;
  private pausedUntil = 0;
  private warnedNoKey = false;
  private calls = 0;

  constructor(deps: ClassifierDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The current settings (thresholds, limits), read live. */
  get config(): ClassifierConfig {
    return this.deps.config();
  }

  /** Switched on (and, given a feature, that feature too) and not paused after failures. */
  enabled(feature?: ClassifierFeature): boolean {
    const config = this.deps.config();
    if (!config.enabled) return false;
    if (feature && !config.features[feature]) return false;
    return this.now() >= this.pausedUntil;
  }

  /** Paused by the breaker until this time (ms), or 0. */
  get pausedTill(): number {
    return this.pausedUntil > this.now() ? this.pausedUntil : 0;
  }

  /**
   * Ask every question over the state in one call. Undefined when the feature
   * is off, the key is missing, the request is over budget, the call fails or
   * `signal` aborts it.
   */
  async ask(purpose: ClassifierFeature, request: SystemOneRequest, options: { signal?: AbortSignal; timeoutMs?: number; saved?: (answers: Record<string, Answer>) => number } = {}): Promise<Classified | undefined> {
    if (!this.enabled(purpose)) return undefined;
    if (!fitsBudget(request)) {
      this.record(purpose, "failed", this.now(), 0);
      this.deps.warn?.(`bot-lobby classifier: a ${purpose} request was ${requestSize(request)} characters (limit ${LIMITS.requestChars}); skipped.`);
      return undefined;
    }
    const result = await this.call(purpose, request, options);
    return result.ok ? result.value : undefined;
  }

  /** One tiny call that reports its error instead of hiding it; ignores the on/off switch and the breaker. */
  async test(signal?: AbortSignal): Promise<TestResult> {
    const result = await this.call("test", { state: { note: "bot-lobby connection test" }, questions: { test: noul("Is `note` a connection test?") } }, { signal, force: true });
    return result.ok ? { ok: true, model: result.value.model, ms: result.value.ms } : { ok: false, error: result.error };
  }

  private async call(purpose: ClassifierPurpose, request: SystemOneRequest, options: { signal?: AbortSignal; timeoutMs?: number; force?: boolean; saved?: (answers: Record<string, Answer>) => number }): Promise<{ ok: true; value: Classified } | { ok: false; error: string }> {
    const config = this.deps.config();
    const { host, baseUrl, model } = jevEndpoint(config);
    const key = await resolveKey(host, this.deps.keys, this.deps.env);
    if (!key) {
      const error = `no ${host.label} key: run /login ${host.piProvider} (Use an API key) or set ${host.env}`;
      if (!options.force && !this.warnedNoKey) {
        this.warnedNoKey = true;
        this.deps.warn?.(`bot-lobby classifier is on but has ${error}. Until then bot-lobby decides without it.`);
      }
      return { ok: false, error };
    }
    const started = this.now();
    try {
      const response = await systemOne(request, {
        apiKey: key,
        baseUrl,
        model,
        timeoutMs: options.timeoutMs ?? config.timeoutMs,
        ...(host.headers ? { headers: { ...host.headers } } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
        ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
      });
      const ms = Math.max(0, this.now() - started);
      this.failures = 0;
      let saved = 0;
      try {
        saved = options.saved?.(response.answers) ?? 0;
      } catch {
        saved = 0;
      }
      this.record(purpose, "success", started, ms, response.model, response.usage, saved);
      return { ok: true, value: { answers: response.answers, model: response.model, ms } };
    } catch (error) {
      const ms = Math.max(0, this.now() - started);
      if (options.signal?.aborted) {
        this.record(purpose, "cancelled", started, ms, model);
        return { ok: false, error: "cancelled" };
      }
      const message = error instanceof JevError || error instanceof Error ? error.message : String(error);
      this.record(purpose, error instanceof JevError && /timed out/.test(message) ? "timeout" : "failed", started, ms, model);
      if (!options.force) this.fail(message);
      return { ok: false, error: message };
    }
  }

  private fail(message: string): void {
    this.failures += 1;
    if (this.failures < BREAKER_FAILURES) return;
    this.failures = 0;
    this.pausedUntil = this.now() + BREAKER_PAUSE_MS;
    this.deps.warn?.(`bot-lobby classifier paused for ${BREAKER_PAUSE_MS / 60_000} minutes after ${BREAKER_FAILURES} failures in a row (${message.split("\n")[0]}). bot-lobby decides without it meanwhile.`);
  }

  private record(purpose: ClassifierPurpose, status: MetricRecord["status"], started: number, ms: number, model?: string, usage?: { input_tokens: number; output_tokens: number }, saved = 0): void {
    this.calls += 1;
    this.deps.metrics?.({
      id: `classifier-${purpose}-${started}-${this.calls}`,
      kind: "classifier",
      agent: "CLASSIFIER",
      purpose,
      ...(model ? { model } : {}),
      status,
      startedAt: new Date(started).toISOString(),
      durationMs: ms,
      ...(usage ? { input: usage.input_tokens, output: usage.output_tokens } : {}),
      ...(saved > 0 ? { saved } : {}),
    });
  }
}
