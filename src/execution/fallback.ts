/**
 * Fallback models. A subscription or key that runs out mid-task (a usage
 * limit, a rate limit, no credit, the provider down or refusing the key)
 * fails every run on that model the same way, so the run goes to the agent's
 * configured fallback model instead, and the exhausted model is skipped for a
 * while so the next agents do not each spend a failed run finding out.
 */

/** What a provider says when a model cannot be used right now. Deliberately narrow: an ordinary failure is not a reason to switch model. */
const UNAVAILABLE = [
  /usage limit/i, /rate.?limit/i, /\bquota\b/i, /limit (?:reached|exceeded|will reset)/i, /exceeded (?:your|the|current)/i,
  /out of (?:usage|credits?|extra usage|tokens)/i, /(?:insufficient|no) (?:credits?|funds|balance|quota)/i, /credit balance/i,
  /billing/i, /payment required/i, /\b402\b/, /\b429\b/, /too many requests/i, /resource.?exhausted/i,
  /overloaded/i, /\b529\b/, /(?:at|over) capacity/i, /resets? (?:at|in|on)/i, /subscription/i,
  /unauthori[sz]ed/i, /\b401\b/, /invalid (?:api )?key/i, /no api key/i, /authentication (?:failed|error)/i,
  /model (?:is )?(?:not found|not available|unavailable)/i, /unknown model/i, /does not have access/i,
];

/** True when a failed run's error says its model is out of usage or unavailable, so another model may succeed. */
export function looksUnavailable(error: string | undefined): boolean {
  return Boolean(error && UNAVAILABLE.some((pattern) => pattern.test(error)));
}

/** How long a model that ran out is skipped before it is tried again. */
export const COOLDOWN_MS = 20 * 60 * 1000;

const exhausted = new Map<string, number>();

/** Remember that `model` cannot be used until the cooldown passes. */
export function markUnavailable(model: string, now = Date.now()): void {
  exhausted.set(model, now + COOLDOWN_MS);
}

/** Whether `model` ran out recently enough to skip. */
export function isUnavailable(model: string | undefined, now = Date.now()): boolean {
  if (!model) return false;
  const until = exhausted.get(model);
  if (until === undefined) return false;
  if (until <= now) {
    exhausted.delete(model);
    return false;
  }
  return true;
}

/** Forget every exhausted model (tests). */
export function resetUnavailable(): void {
  exhausted.clear();
}

/** A fallback worth switching to: a model other than the one that failed. */
export function usableFallback<F extends { model: string }>(fallback: F | undefined, current: string | undefined): F | undefined {
  return fallback && fallback.model !== current ? fallback : undefined;
}

/**
 * Run `attempt` on `model`; when it fails because that model is out of usage
 * or unavailable, run it again on the fallback. A model already known to be
 * out goes straight to the fallback. `switched` says which model took over.
 */
export async function withFallback<T extends { status: string; error?: string }>(
  model: string | undefined,
  thinking: string,
  fallback: { model: string; thinking: string } | undefined,
  attempt: (model: string | undefined, thinking: string) => Promise<T>,
): Promise<{ result: T; switchedFrom?: string }> {
  const other = usableFallback(fallback, model);
  if (other && isUnavailable(model)) return { result: await attempt(other.model, other.thinking), switchedFrom: model ?? "the session model" };
  const result = await attempt(model, thinking);
  if (other && result.status === "failed" && looksUnavailable(result.error)) {
    if (model) markUnavailable(model);
    return { result: await attempt(other.model, other.thinking), switchedFrom: model ?? "the session model" };
  }
  return { result };
}
