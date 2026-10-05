/**
 * The lint gate. The engine lints the files a task's agents touched (and only
 * those) with the project's own linter, after every worker step, before QA and
 * at completion, so what the oracle and QA are told is a check the engine ran,
 * not an agent's word. Every file is linted whole, but only problems on the
 * lines the task changed (or in files it created) are the task's: what was
 * already there is reported and never holds it. In block mode new errors hold
 * completion; in advise mode they are reported only. Lint suppressions and
 * lint-config changes the task added are listed for QA, which cannot edit, to
 * judge: a worker cannot quietly get past the gate.
 */
import { basename } from "node:path";
import type { LintConfig, LintMode } from "../schemas/configuration.ts";
import type { LintFinding, LintReport, LintRun } from "../schemas/lint.ts";
import { addedLines, type AddedLines } from "../execution/git.ts";
import { execLint, lintFingerprint, MAX_FINDINGS, planLint, runPlan, type LintExec } from "../execution/lint.ts";
import { truncate } from "../text.ts";

/** Comments and attributes that switch a linter or type checker off. */
const SUPPRESSION = /\b(?:eslint-disable(?:-next-line|-line)?|eslint-enable|oxlint-disable(?:-next-line|-line)?|biome-ignore(?:-all|-start)?|deno-lint-ignore(?:-file)?|stylelint-disable(?:-next-line|-line)?|jshint\s+ignore)\b|@ts-(?:ignore|nocheck|expect-error)\b|#\s*(?:noqa|type:\s*ignore|pylint:\s*disable|ruff:\s*noqa|rubocop:\s*disable)\b|\/\/\s*nolint\b|NOLINT(?:NEXTLINE)?\b|@SuppressWarnings\b|#!?\[allow\(/;

/** Files that decide what a linter or the type checker checks. */
const LINT_CONFIG = /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\.(?:js|cjs|json|ya?ml))?|\.eslintignore|biome\.jsonc?|\.oxlintrc\.json|oxlint\.config\.ts|\.oxlintignore|ruff\.toml|\.ruff\.toml|\.flake8|\.pylintrc|\.golangci\.(?:ya?ml|toml|json)|\.rubocop\.yml|\.stylelintrc(?:\.\w+)?|tsconfig(?:\.[\w-]+)?\.json)$/;
/** Shared config files that count only when the added lines touch a linter. */
const SHARED_CONFIG = /^(?:package\.json|pyproject\.toml|setup\.cfg|tox\.ini)$/;
const LINT_WORDS = /lint|eslint|biome|oxlint|ruff|flake8|pylint|noqa|strict/i;

/** Suppressions shown to QA. */
const MAX_SUPPRESSIONS = 40;

/**
 * Every lint suppression and lint-config change among the lines the task
 * added: `src/a.ts:3 — // eslint-disable-next-line no-explicit-any`, or
 * `eslint.config.js — lint config changed`.
 */
export function lintSuppressions(added: AddedLines | undefined, files: readonly string[]): string[] {
  const out: string[] = [];
  const configs = new Set<string>();
  for (const file of files) if (LINT_CONFIG.test(basename(file))) configs.add(file);
  for (const entry of added?.text ?? []) {
    if (SHARED_CONFIG.test(basename(entry.file)) && LINT_WORDS.test(entry.text)) configs.add(entry.file);
    else if (SUPPRESSION.test(entry.text) && !LINT_CONFIG.test(basename(entry.file))) out.push(`${entry.file}:${entry.line} — ${truncate(entry.text.trim(), 160)}`);
  }
  return [...[...configs].sort().map((file) => `${file} — lint or type-check config changed`), ...out].slice(0, MAX_SUPPRESSIONS);
}

/** Whether a finding sits on a line the task changed: always in a file it created, and when git cannot say. */
function fresh(finding: LintFinding, added: AddedLines | undefined): boolean {
  if (!added || added.whole.has(finding.file)) return true;
  if (!finding.line) return true;
  return added.lines.get(finding.file)?.has(finding.line) ?? false;
}

/** New ones first, errors before warnings, then by place. */
function order(a: LintFinding, b: LintFinding): number {
  return Number(Boolean(b.fresh)) - Number(Boolean(a.fresh)) || Number(b.severity === "error") - Number(a.severity === "error") || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0);
}

export interface LintGateInput {
  /** The repository's top folder; `files` are relative to it. */
  top: string;
  /** The files the task's agents touched. */
  files: readonly string[];
  /** The commit the task's work is measured from (HEAD when absent). */
  base?: string;
  config: LintConfig;
  /** The last report: reused when the files and settings are unchanged. */
  previous?: LintReport;
  exec?: LintExec;
  signal?: AbortSignal;
  now?: () => Date;
}

/** Lint the touched files, or reuse the last report when nothing it covers has changed since. */
export async function runLintGate(input: LintGateInput): Promise<LintReport> {
  const at = (input.now?.() ?? new Date()).toISOString();
  const files = [...new Set(input.files)].sort();
  const fingerprint = lintFingerprint(input.top, files, input.config);
  const previous = input.previous;
  if (previous && previous.fingerprint === fingerprint && (previous.state === "passing" || previous.state === "failing")) return previous;
  const empty = (note: string): LintReport => ({ at, state: "skipped", files, runs: [], errors: 0, warnings: 0, freshErrors: 0, freshWarnings: 0, suppressions: [], note, fingerprint });
  if (files.length === 0) return empty("no files touched yet");
  const added = await addedLines(input.top, input.base, files);
  const suppressions = lintSuppressions(added, files);
  const plans = planLint(input.top, files, input.config);
  if (plans.length === 0) return { ...empty(input.config.command.trim() ? "none of the touched files is of a type the lint command takes" : "no linter is configured for the touched files"), suppressions };
  const runs: LintRun[] = [];
  let freshErrors = 0;
  let freshWarnings = 0;
  for (const plan of plans) {
    const run = await runPlan(plan, input.top, input.config, input.exec ?? execLint, input.signal);
    const findings = run.findings.map((finding) => ({ ...finding, fresh: fresh(finding, added) })).sort(order);
    const counts = countFresh(findings);
    freshErrors += counts.freshErrors;
    freshWarnings += counts.freshWarnings;
    runs.push({ ...run, findings: findings.slice(0, MAX_FINDINGS) });
  }
  const ran = runs.filter((run) => run.state !== "unavailable");
  return {
    at,
    state: freshErrors > 0 ? "failing" : ran.length === 0 ? "unavailable" : "passing",
    files,
    runs,
    errors: runs.reduce((total, run) => total + run.errors, 0),
    warnings: runs.reduce((total, run) => total + run.warnings, 0),
    freshErrors,
    freshWarnings,
    suppressions,
    fingerprint,
  };
}

interface FreshCounts {
  freshErrors: number;
  freshWarnings: number;
}

function countFresh(findings: readonly LintFinding[]): FreshCounts {
  const mine = findings.filter((finding) => finding.fresh);
  const errors = mine.filter((finding) => finding.severity === "error").length;
  return { freshErrors: errors, freshWarnings: mine.length - errors };
}

/** True when the report holds completion: block mode, new errors, and the user has not accepted the work as it is. */
export function lintHolds(report: LintReport | undefined, mode: LintMode, waived: boolean): boolean {
  return mode === "block" && report?.state === "failing" && !waived;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `ESLint, Ruff` */
function tools(report: LintReport): string {
  return [...new Set(report.runs.map((run) => run.tool))].join(", ");
}

/** One line: `ESLint on 3 touched files: 2 new errors, 1 new warning (4 more already there)`. */
export function lintSummary(report: LintReport): string {
  if (report.state === "skipped") return `Lint: ${report.note ?? "nothing to lint"}.`;
  const head = `${tools(report)} on ${plural(report.files.length, "touched file")}`;
  if (report.state === "unavailable") return `${head}: could not run.`;
  const old = report.errors + report.warnings - report.freshErrors - report.freshWarnings;
  const news = [report.freshErrors ? plural(report.freshErrors, "new error") : "", report.freshWarnings ? plural(report.freshWarnings, "new warning") : ""].filter(Boolean).join(", ");
  return `${head}: ${news || "no new problems"}${old > 0 ? ` (${plural(old, "problem")} already there before this task)` : ""}.`;
}

function place(finding: LintFinding): string {
  return `${finding.file}${finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ""}` : ""}`;
}

function findingLine(finding: LintFinding, owners?: ReadonlyMap<string, string>): string {
  const owner = owners?.get(finding.file);
  return `- ${place(finding)}${finding.rule ? ` [${finding.rule}]` : ""} ${truncate(finding.message.replace(/\s+/g, " "), 200)} — ${finding.severity}${owner ? ` (${owner})` : ""}`;
}

function newFindings(report: LintReport, max: number): LintFinding[] {
  return report.runs.flatMap((run) => run.findings.filter((finding) => finding.fresh)).slice(0, max);
}

function cannotRun(report: LintReport): string[] {
  return report.runs.filter((run) => run.state === "unavailable").map((run) => `${run.tool}${run.folder ? ` (${run.folder}/)` : ""}: ${truncate((run.output ?? "could not run").split("\n")[0]!, 200)}`);
}

/**
 * What the oracle is told after a step, before QA's verdict and at completion:
 * the new problems with the domain that touched each file, what to do about
 * them for the mode, the suppressions the task added, and what could not run.
 * Empty when there is nothing to say (no linter, nothing touched).
 */
export function lintNote(report: LintReport | undefined, mode: LintMode, owners?: ReadonlyMap<string, string>): string {
  if (!report || mode === "off" || report.state === "skipped") return "";
  const lines = [`Lint — ${lintSummary(report)}`];
  if (report.state === "failing" || report.freshWarnings > 0) {
    lines.push(...newFindings(report, 20).map((finding) => findingLine(finding, owners)));
    lines.push(
      mode === "block" && report.state === "failing"
        ? "Completion is held until the new errors are fixed: delegate each fix to the domain that touched the file, and have it fix the cause, never silence the rule (QA reads every new suppression as a finding)."
        : "Advisory: have the domain that touched each file fix the new ones, or tell the user why they stay. Never have a rule silenced to pass.",
    );
  }
  const blocked = cannotRun(report);
  if (blocked.length > 0) lines.push(`Could not run, so nothing is held for it: ${blocked.join("; ")}.`);
  if (report.suppressions.length > 0) lines.push(`Suppressions and lint-config changes this task added (QA judges each):\n${report.suppressions.slice(0, 10).map((entry) => `- ${entry}`).join("\n")}`);
  return lines.join("\n");
}

/** The lint line under QA's verdict for the oracle: the summary, and whether it still holds completion. */
export function lintBrief(report: LintReport | undefined, mode: LintMode, waived: boolean): string {
  if (!report || mode === "off" || report.state === "skipped") return "";
  const held = lintHolds(report, mode, waived) ? " Completion stays held until the new errors are fixed." : "";
  return `Lint — ${lintSummary(report)}${held}`;
}

/** What QA reads: the engine's lint result, and every suppression it must judge. */
export function lintContext(report: LintReport | undefined, mode: LintMode): string {
  if (!report || mode === "off") return "";
  const lines = [`Lint, run by the engine on the files this task touched (${mode} mode): ${lintSummary(report)}`];
  const fresh = newFindings(report, 30);
  if (fresh.length > 0) lines.push(`On lines this task changed:\n${fresh.map((finding) => findingLine(finding)).join("\n")}`);
  const blocked = cannotRun(report);
  if (blocked.length > 0) lines.push(`Could not run: ${blocked.join("; ")}. Read the touched files with the project's rules in mind instead.`);
  lines.push(
    report.suppressions.length > 0
      ? `Suppressions and lint-config changes this task added. Judge each: one without a reason that holds (in a comment beside it, or the worker's report) is a finding, and so is a rule loosened or a file ignored to pass:\n${report.suppressions.map((entry) => `- ${entry}`).join("\n")}`
      : "This task added no lint suppressions and changed no lint config. Still look for code removed or bent only to satisfy a rule.",
  );
  return lines.join("\n\n");
}

/** The activity log's line, and how it reads. */
export function lintFeed(taskId: string, report: LintReport): { text: string; kind: "success" | "warning" | "error" | "info" } {
  const first = newFindings(report, 1)[0];
  const text = `${taskId} · ${lintSummary(report).replace(/\.$/, "")}${first ? ` — ${place(first)}${first.rule ? ` ${first.rule}` : ""}` : ""}`;
  const kind = report.state === "failing" ? "error" : report.state === "unavailable" || report.freshWarnings > 0 || report.suppressions.length > 0 ? "warning" : report.state === "passing" ? "success" : "info";
  return { text, kind };
}

/** Why completion is refused, for the oracle. */
export function lintRefusal(report: LintReport): string {
  const fresh = newFindings(report, 5).filter((finding) => finding.severity === "error");
  return `lint found ${plural(report.freshErrors, "error")} on lines this task changed (${fresh.map((finding) => `${place(finding)}${finding.rule ? ` ${finding.rule}` : ""}`).join(", ")}${report.freshErrors > fresh.length ? ", …" : ""}). Delegate the fixes to the domain that touched each file and call complete again; the user can accept the work as it is with /bot-lobby accept`;
}
