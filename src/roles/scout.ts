import type { Domain, RoleSpec } from "../schemas/agent.ts";
import type { ScoutResult } from "../schemas/findings.ts";
import { bullets, findSection, parseFileBullet, parsePushback, parseSections } from "./markdown.ts";

/** Scout runs read-only so it can never modify implementation. */
export const scoutSpec: RoleSpec = {
  role: "scout",
  promptFile: "scout.md",
  tools: ["read", "grep", "find", "ls"],
  contract: [
    "### Output contract",
    "Respond with exactly these sections and nothing else:",
    "`## Scope`, `## Findings`, `## Relevant Files`, `## Existing Patterns`,",
    "`## Risks`, `## Recommendations`, `## Confidence`.",
    "Use `- ` bullets. `## Relevant Files` entries are `- \\`path\\` — reason`.",
    "`## Confidence` is exactly one of `High`, `Medium`, `Low`.",
    "Keep the whole response under 400 words. Report uncertainty; do not implement.",
    "An optional `## Pushback` (`**Request:**`, `**Reason:**`, optional `**Alternative:**`) flags a change you",
    "believe is wrong, with your reason; keep it separate from your findings.",
  ].join(" "),
};


function parseConfidence(text: string | undefined): ScoutResult["confidence"] {
  const value = (text ?? "").toLowerCase();
  if (value.includes("high")) return "high";
  if (value.includes("medium")) return "medium";
  return "low";
}

/** Parse a scout's markdown into structured findings (never throws). */
export function parseScoutResult(domain: Domain, raw: string): ScoutResult {
  const sections = parseSections(raw);
  return {
    domain,
    role: "scout",
    scope: findSection(sections, "scope") ?? "",
    findings: bullets(findSection(sections, "findings")),
    relevantFiles: bullets(findSection(sections, "relevant files")).map(parseFileBullet),
    patterns: bullets(findSection(sections, "existing patterns")),
    risks: bullets(findSection(sections, "risks")),
    recommendations: bullets(findSection(sections, "recommendations")),
    confidence: parseConfidence(findSection(sections, "confidence")),
    pushback: parsePushback(sections),
    raw,
  };
}

/** Report contract deviations so the Master can retry or downgrade trust. */
export function validateScoutResult(result: ScoutResult): string[] {
  const issues: string[] = [];
  if (!result.scope) issues.push("missing Scope section");
  if (result.findings.length === 0) issues.push("no findings reported");
  if (!/##\s*confidence/i.test(result.raw)) issues.push("missing Confidence section");
  return issues;
}

/** A scout result is usable when it produced any evidence at all. */
export function isScoutResultUsable(result: ScoutResult): boolean {
  return result.findings.length > 0 || result.relevantFiles.length > 0 || result.risks.length > 0;
}
