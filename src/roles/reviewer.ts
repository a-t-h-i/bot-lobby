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

/** Severity words reviewers use outside the contract's four, mapped onto them. */
const SEVERITY_ALIASES: ReadonlyArray<[RegExp, Severity]> = [
  [/\b(?:blocker|blocking|severe)\b/, "critical"],
  [/\bhigh\b/, "major"],
  [/\b(?:low|nit|nitpick|trivial|cosmetic|optional|suggestion)\b/, "minor"],
  [/\b(?:note|fyi)\b/, "info"],
];

/**
 * Verdict words in the order a reviewer writes them. FAIL is the word qa.md
 * used to ask for: it means changes are required, not that QA could not run.
 */
const VERDICT_TOKENS: ReadonlyArray<[RegExp, Verdict]> = [
  [/\bCHANGES?[\s_-]*(?:REQUIRED|REQUESTED|NEEDED)\b|\b(?:NEEDS|REQUEST(?:ED)?)[\s_-]+CHANGES\b/, "changes_required"],
  [/\bFAIL(?:ED|S|URE)?\b/, "changes_required"],
  [/\bBLOCKED\b/, "blocked"],
  [/\bPASS(?:ED|ES)?\b/, "pass"],
];

/** The first verdict word in the text, so `PASS — no changes required` reads as the PASS it leads with. */
function verdictToken(text: string): Verdict | undefined {
  const value = text.toUpperCase();
  let best: { at: number; verdict: Verdict } | undefined;
  for (const [pattern, verdict] of VERDICT_TOKENS) {
    const match = pattern.exec(value);
    if (match && (!best || match.index < best.at)) best = { at: match.index, verdict };
  }
  return best?.verdict;
}

/** The verdict token may sit in the heading itself (`## Verdict PASS`), leaving an empty body. */
function verdictHeading(sections: Map<string, string>): string | undefined {
  for (const heading of sections.keys()) {
    if (heading.includes("verdict")) return heading;
  }
  return undefined;
}

/**
 * The reviewer's verdict, or undefined when none can be read. The contract's
 * `## Verdict` section comes first; failing that, a line that names the
 * verdict (`**Verdict:** PASS`, `# Verdict: PASS`) and the line after it.
 */
export function readVerdict(raw: string, sections = parseSections(raw)): Verdict | undefined {
  const heading = verdictHeading(sections);
  if (heading !== undefined) {
    const body = (findSection(sections, "verdict") ?? "").split("\n").filter((line) => line.trim()).slice(0, 2).join("\n");
    const found = verdictToken(`${heading}\n${body}`);
    if (found) return found;
  }
  const lines = raw.split("\n");
  const at = lines.findIndex((line) => /\bverdict\b/i.test(line));
  if (at < 0) return undefined;
  const next = lines.slice(at + 1).find((line) => line.trim()) ?? "";
  return verdictToken(`${lines[at]}\n${next}`);
}

/** The severity a finding was tagged with, or undefined when it carries none. */
function taggedSeverity(text: string): Severity | undefined {
  const tag = /^\*{0,2}\[([^\]]+)\]/.exec(text)?.[1]?.toLowerCase();
  if (!tag) return undefined;
  return SEVERITIES.find((candidate) => tag.includes(candidate))
    ?? SEVERITY_ALIASES.find(([pattern]) => pattern.test(tag))?.[1];
}

function parseFinding(text: string): ReviewFinding {
  const match = /^\*{0,2}\[([^\]]+)\]\*{0,2}\s*(.*)$/.exec(text);
  return { severity: taggedSeverity(text) ?? "info", text: (match?.[2] ?? text).trim() };
}

/** The QA gate never passes by default: a PASS must cite at least one executed check. */
export const UNVERIFIED_PASS = "unverified pass: PASS without executed checks under ## Verification, downgraded to CHANGES_REQUIRED";

/** Minor and info findings never hold the gate; what the reviewer asked for is kept as follow-ups. */
export const MINOR_ONLY = "CHANGES_REQUIRED for minor or info findings only: passed, its asks kept as follow-ups";

/** No verdict could be read: the review did not finish, so it is run again rather than stopping the task. */
export const NO_VERDICT = "no readable verdict: the review did not finish, so nothing is known yet about the work";

/** A check names a command and its result: `cmd — result`, `cmd: result`, `✅ cmd`, `cmd (40/40)` or `cmd passed`. */
const CHECK_RESULT = /\S\s*(?:—|–|-{1,2}|:|=>|→|->)\s*\S|[✅✓✔❌✗✘]|\(\s*\d+\s*\/\s*\d+\s*\)|\b(?:pass(?:ed|es|ing)?|fail(?:ed|s|ing)?|clean|exit(?:ed)?\s*(?:code\s*)?\d+|\d+\s+(?:tests?|passing|passed|failing|failed))\b/i;

/** A table row's cells, or undefined for a line that is not a row. */
function tableCells(line: string): string[] | undefined {
  if (!/^\|.*\|$/.test(line)) return undefined;
  return line.slice(1, -1).split("|").map((cell) => cell.trim());
}

/**
 * The checks under `## Verification`: bullets, numbered items and table rows
 * that name a command and its result. A reviewer's list style never decides
 * whether the gate believes it ran something.
 */
function executedChecks(verification: string): string[] {
  const lines = verification.split("\n").map((line) => line.trim());
  const checks: string[] = [];
  lines.forEach((line, index) => {
    const cells = tableCells(line);
    if (cells) {
      const separator = cells.every((cell) => /^:?-{2,}:?$/.test(cell));
      const header = tableCells(lines[index + 1] ?? "")?.every((cell) => /^:?-{2,}:?$/.test(cell));
      if (!separator && !header && cells.filter(Boolean).length >= 2) checks.push(cells.join(" — "));
      return;
    }
    const item = /^(?:[-*+]|\d+[.)])\s+(\S.*)$/.exec(line)?.[1];
    if (item && CHECK_RESULT.test(item)) checks.push(item);
  });
  return checks;
}

/** Parse a reviewer's markdown into a structured verdict (never throws). */
export function parseReviewResult(domain: Domain, raw: string): ReviewResult {
  const sections = parseSections(raw);
  const verification = findSection(sections, "verification") ?? "";
  const requiredChanges = bullets(findSection(sections, "required changes"));
  const entries = bullets(findSection(sections, "findings"));
  const read = readVerdict(raw, sections);
  let verdict: Verdict = read ?? "changes_required";
  let downgraded: string | undefined;
  let relaxed: string | undefined;
  const checked = executedChecks(verification).length > 0;
  if (!read) {
    // Never a pass, and never a stop either: an unreadable review is run again.
    requiredChanges.push("Re-run the QA gate: the last review returned no readable verdict.");
  } else if (verdict === "pass" && !checked) {
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
    ...(read ? {} : { unread: NO_VERDICT }),
    raw,
  };
}

/** An unknown verdict must never be treated as acceptance (§42). */
export function validateReviewResult(result: ReviewResult): string[] {
  const issues: string[] = [];
  if (result.unread) issues.push("missing Verdict section");
  if (result.downgraded) issues.push(result.downgraded);
  if (result.verdict !== "pass" && result.findings.length === 0 && result.requiredChanges.length === 0) {
    issues.push("non-pass verdict without findings or required changes");
  }
  if (result.verdict === "pass" && result.findings.some((finding) => finding.severity === "critical")) {
    issues.push("PASS declared with critical findings");
  }
  return issues;
}
