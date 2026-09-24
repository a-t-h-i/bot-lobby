import type { Domain } from "../schemas/agent.ts";
import { truncate } from "../text.ts";
import type { ScoutOutcome } from "./master.ts";

/** Domains whose reconnaissance produced usable evidence. */
export function domainsInvolved(outcomes: ScoutOutcome[]): Domain[] {
  return [...new Set(outcomes.filter((outcome) => outcome.usable).map((outcome) => outcome.result.domain))];
}

/** Missing, failed, or low-confidence recon the Master should treat carefully. */
export function detectGaps(outcomes: ScoutOutcome[]): string[] {
  const gaps: string[] = [];
  for (const outcome of outcomes) {
    const { domain, confidence } = outcome.result;
    if (!outcome.usable) gaps.push(`${domain}: no usable reconnaissance`);
    if (outcome.usable && confidence === "low") gaps.push(`${domain}: low confidence, verify claims`);
    for (const issue of outcome.issues) gaps.push(`${domain}: ${issue}`);
  }
  return [...new Set(gaps)];
}

/** Files reported by more than one domain: likely cross-domain touchpoints. */
export function detectSharedFiles(outcomes: ScoutOutcome[]): { path: string; domains: Domain[] }[] {
  const byPath = new Map<string, Set<Domain>>();
  for (const outcome of outcomes) {
    for (const file of outcome.result.relevantFiles) {
      const domains = byPath.get(file.path) ?? new Set<Domain>();
      domains.add(outcome.result.domain);
      byPath.set(file.path, domains);
    }
  }
  return [...byPath.entries()]
    .filter(([, domains]) => domains.size > 1)
    .map(([path, domains]) => ({ path, domains: [...domains] }));
}

function describeOutcome(outcome: ScoutOutcome, rawLimit: number): string {
  const { result } = outcome;
  const lines = [
    `### ${result.domain} (${outcome.run.status}${outcome.usable ? "" : ", unusable"}) — confidence: ${result.confidence}`,
    result.scope ? `Scope: ${result.scope}` : "",
    ...result.findings.slice(0, 12).map((finding) => `- ${finding}`),
    ...result.risks.slice(0, 5).map((risk) => `- RISK: ${risk}`),
    ...result.recommendations.slice(0, 5).map((rec) => `- REC: ${rec}`),
    result.relevantFiles.length > 0
      ? `Files: ${result.relevantFiles.slice(0, 10).map((file) => file.path).join(", ")}`
      : "",
    outcome.issues.length > 0 ? `Issues: ${outcome.issues.join("; ")}` : "",
    result.raw.trim() ? `Raw (truncated): ${truncate(result.raw.trim(), rawLimit)}` : "",
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

/** Compact, bounded view of all scout findings for the Master's context (§36). */
export function summarizeOutcomes(outcomes: ScoutOutcome[], rawLimit = 2000): string {
  return outcomes.map((outcome) => describeOutcome(outcome, rawLimit)).join("\n\n");
}
