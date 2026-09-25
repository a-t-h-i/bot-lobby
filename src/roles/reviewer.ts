import type { Domain, RoleSpec } from "../schemas/agent.ts";
import type { ReviewFinding, ReviewResult } from "../schemas/findings.ts";
import type { Severity, Verdict } from "../schemas/task.ts";
import { bullets, findSection, parsePushback, parseSections } from "./markdown.ts";

/** Reviewer gets bash to run tests/static analysis, but must not modify code. */
export const reviewerSpec: RoleSpec = {
  role: "reviewer",
  promptFile: "reviewer.md",
  tools: ["read", "grep", "find", "ls", "bash"],
  contract: [
    "### Output contract",
    "Begin with `## Verdict` followed by exactly one of `PASS`, `CHANGES_REQUIRED`, or `BLOCKED`.",
    "Then `## Findings`, `## Verification`, `## Required Changes`, `## Optional Improvements`.",
    "Findings entries are `- [severity] text — \\`path:line\\``.",
    "Verification entries are `- command — result`.",
    "You must not modify implementation files. Report required changes instead.",
    "An optional `## Pushback` (`**Request:**`, `**Reason:**`, optional `**Alternative:**`) flags a change request you",
    "believe is wrong, with your reason; keep it separate from your findings.",
  ].join(" "),
};

const SEVERITIES: readonly Severity[] = ["critical", "major", "minor", "info"];

function parseVerdict(text: string | undefined): Verdict {
  const value = (text ?? "").toUpperCase();
  if (value.includes("CHANGES REQUIRED") || value.includes("CHANGES_REQUIRED")) return "changes_required";
  if (value.includes("PASS")) return "pass";
  return "blocked";
}

function parseFinding(text: string): ReviewFinding {
  const match = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
  const severity = SEVERITIES.find((candidate) => match?.[1]?.toLowerCase().includes(candidate)) ?? "info";
  return { severity, text: (match?.[2] ?? text).trim() };
}

/** Parse a reviewer's markdown into a structured verdict (never throws). */
export function parseReviewResult(domain: Domain, raw: string): ReviewResult {
  const sections = parseSections(raw);
  return {
    domain,
    role: "reviewer",
    verdict: parseVerdict(findSection(sections, "verdict")),
    findings: bullets(findSection(sections, "findings")).map(parseFinding),
    verification: findSection(sections, "verification") ?? "",
    requiredChanges: bullets(findSection(sections, "required changes")),
    optionalImprovements: bullets(findSection(sections, "optional improvements")),
    pushback: parsePushback(sections),
    raw,
  };
}

/** An unknown verdict must never be treated as acceptance (§42). */
export function validateReviewResult(result: ReviewResult): string[] {
  const issues: string[] = [];
  if (!/##\s*verdict/i.test(result.raw)) issues.push("missing Verdict section");
  if (result.verdict !== "pass" && result.findings.length === 0 && result.requiredChanges.length === 0) {
    issues.push("non-pass verdict without findings or required changes");
  }
  if (result.verdict === "pass" && result.findings.some((finding) => finding.severity === "critical")) {
    issues.push("PASS declared with critical findings");
  }
  return issues;
}
