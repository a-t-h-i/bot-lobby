import { readWork, updateWork } from "./work-time.ts";

export const STEP_LIMIT_MS = 15 * 60_000;

export function stepTimeLeft(root: string, configDir: string, taskId: string, keys: readonly string[], limitMs: number): number {
  const limits = readWork(root, configDir, taskId, true)?.stepLimits;
  return Math.max(0, Math.min(limitMs, ...keys.map((key) => {
    const entry = limits?.[key];
    if (!entry) return limitMs;
    if (!Number.isFinite(entry.limitMs) || !Number.isFinite(entry.usedMs) || entry.limitMs < 0 || entry.usedMs < 0) throw new Error("Invalid step allowance");
    return entry.limitMs - entry.usedMs;
  })));
}

/** Reserve before starting: a crash must not silently give the step a fresh allowance. */
export function reserveStepTime(root: string, configDir: string, taskId: string, keys: readonly string[], limitMs: number, ms: number) {
  let reserved = ms;
  const change = (fn: (entry: { limitMs: number; usedMs: number }) => void) => updateWork(root, configDir, taskId, (work) => {
    work.stepLimits ??= {};
    for (const key of keys) fn(work.stepLimits[key] ??= { limitMs, usedMs: 0 });
  }, new Date(), true);
  if (!(ms > 0) || ms > stepTimeLeft(root, configDir, taskId, keys, limitMs)) throw new Error("The step has no time left");
  change((entry) => { entry.usedMs += ms; });
  return {
    grant(extraMs: number) {
      change((entry) => { entry.limitMs += extraMs; entry.usedMs += extraMs; });
      reserved += extraMs;
    },
    finish(usedMs: number, exhausted = false) {
      const refund = exhausted ? 0 : Math.max(0, reserved - usedMs);
      change((entry) => { entry.usedMs = Math.max(0, entry.usedMs - refund); });
    },
  };
}

export function grantStepTime(root: string, configDir: string, taskId: string, keys: readonly string[], limitMs: number, extraMs: number): void {
  updateWork(root, configDir, taskId, (work) => {
    work.stepLimits ??= {};
    for (const key of keys) (work.stepLimits[key] ??= { limitMs, usedMs: 0 }).limitMs += extraMs;
  }, new Date(), true);
}
