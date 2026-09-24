import type { Decision, Task } from "../schemas/task.ts";
import type { Domain } from "../schemas/agent.ts";
import type { Verdict } from "../schemas/task.ts";
import type { ScoutOutcome } from "./master.ts";
import { detectGaps, domainsInvolved } from "./synthesis.ts";

/** Record a Master decision on the task so it survives into knowledge. */
export function recordDecision(
  task: Task,
  text: string,
  domain: Decision["domain"] = "master",
  now = new Date().toISOString(),
): void {
  task.decisions.push({ domain, text, createdAt: now });
}

/** §17: a changes-required verdict iterates until the configured limit. */
export function decideReviewLoop(
  verdict: Verdict,
  iterations: number,
  maxIterations: number,
): "accept" | "iterate" | "blocked" {
  if (verdict === "pass") return "accept";
  if (verdict === "blocked") return "blocked";
  return iterations < maxIterations ? "iterate" : "blocked";
}

export interface ReconAssessment {
  usableDomains: Domain[];
  warnings: string[];
  /** False when no scout produced usable evidence at all. */
  hasEvidence: boolean;
}

/**
 * Advisory (not a gate): the Master decides whether to proceed, but the engine
 * surfaces what reconnaissance is missing so the decision is informed.
 */
export function assessReconnaissance(outcomes: ScoutOutcome[]): ReconAssessment {
  const warnings = detectGaps(outcomes);
  const usableDomains = domainsInvolved(outcomes);
  if (outcomes.length === 0) warnings.push("no scouts were run");
  return { usableDomains, warnings, hasEvidence: usableDomains.length > 0 };
}
