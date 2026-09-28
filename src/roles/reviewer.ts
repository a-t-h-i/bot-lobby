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
    "Verification entries are `- command — result` for checks you actually executed; a PASS without them is",
    "treated as CHANGES_REQUIRED.",
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

/** The severity a finding was tagged with, or undefined when it carries none. */
function taggedSeverity(text: string): Severity | undefined {
  const match = /^\[([^\]]+)\]/.exec(text);
  return SEVERITIES.find((candidate) => match?.[1]?.toLowerCase().includes(candidate));
}

function parseFinding(text: string): ReviewFinding {
  const match = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
  return { severity: taggedSeverity(text) ?? "info", text: (match?.[2] ?? text).trim() };
}

/** The QA gate never passes by default: a PASS must cite at least one executed check. */
export const UNVERIFIED_PASS = "unverified pass: PASS without executed checks under ## Verification, downgraded to CHANGES_REQUIRED";

/** Minor and info findings never hold the gate; what the reviewer asked for is kept as follow-ups. */
export const MINOR_ONLY = "CHANGES_REQUIRED for minor or info findings only: passed, its asks kept as follow-ups";

/** A verification bullet names a command or check and its result (`- cmd — result`). */
function executedChecks(verification: string): string[] {
  return bullets(verification).filter((entry) => /\S\s*(?:—|–|-{1,2}|:|=>|→)\s*\S/.test(entry));
}

/** Parse a reviewer's markdown into a structured verdict (never throws). */
export function parseReviewResult(domain: Domain, raw: string): ReviewResult {
  const sections = parseSections(raw);
  const verification = findSection(sections, "verification") ?? "";
  const requiredChanges = bullets(findSection(sections, "required changes"));
  const entries = bullets(findSection(sections, "findings"));
  let verdict = parseVerdict(findSection(sections, "verdict"));
  let downgraded: string | undefined;
  let relaxed: string | undefined;
  const checked = executedChecks(verification).length > 0;
  if (verdict === "pass" && !checked) {
    verdict = "changes_required";
    downgraded = UNVERIFIED_PASS;
    requiredChanges.push("Re-run the QA gate and record the checks actually executed, each as `- command — result`.");
  } else if (
    verdict === "changes_required" && checked && entries.length > 0
    // Only findings explicitly tagged minor or info: an untagged one may be serious.
    && entries.every((entry) => { const severity = taggedSeverity(entry); return severity === "minor" || severity === "info"; })
  ) {
    verdict = "pass";
    relaxed = MINOR_ONLY;
  }
  return {
    domain,
    role: "reviewer",
    verdict,
    findings: entries.map(parseFinding),
    verification,
    requiredChanges,
    optionalImprovements: bullets(findSection(sections, "optional improvements")),
    pushback: parsePushback(sections),
    ...(downgraded ? { downgraded } : {}),
    ...(relaxed ? { relaxed } : {}),
    raw,
  };
}

/** An unknown verdict must never be treated as acceptance (§42). */
export function validateReviewResult(result: ReviewResult): string[] {
  const issues: string[] = [];
  if (!/##\s*verdict/i.test(result.raw)) issues.push("missing Verdict section");
  if (result.downgraded) issues.push(result.downgraded);
  if (result.verdict !== "pass" && result.findings.length === 0 && result.requiredChanges.length === 0) {
    issues.push("non-pass verdict without findings or required changes");
  }
  if (result.verdict === "pass" && result.findings.some((finding) => finding.severity === "critical")) {
    issues.push("PASS declared with critical findings");
  }
  return issues;
}
