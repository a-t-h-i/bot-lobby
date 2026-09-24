import type { Decision, Task, Verdict } from "../schemas/task.ts";
import type { Domain } from "../schemas/agent.ts";
import type { ScoutOutcome } from "./master.ts";
import { detectGaps, domainsInvolved } from "./synthesis.ts";

/** §19: everything the engine requires before completion may be declared. */
export function completionBlockers(task: Task, pendingCount: number): string[] {
  const blockers: string[] = [];
  if (!task.plan) blockers.push("no approved plan is recorded");
  if (task.qaVerdict !== "pass") blockers.push(`QA gate is ${task.qaVerdict ?? "not run"}`);
  if (pendingCount > 0) blockers.push(`${pendingCount} unresolved approval request(s)`);
  if (task.blockers.length > 0) blockers.push(`${task.blockers.length} unresolved blocker(s)`);
  for (const domain of task.domains.filter((entry) => entry !== "qa")) {
    const accepted = task.reviewRecords.some((record) => record.domain === domain && record.verdict === "pass");
    if (!accepted) blockers.push(`${domain} has no accepted review`);
  }
  return blockers;
}

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
