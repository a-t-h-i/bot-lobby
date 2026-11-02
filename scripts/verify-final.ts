#!/usr/bin/env node
/**
 * The repository's final-verification entry point: runs the same checks
 * completion requires (typecheck, unit tests, web build, browser fixtures —
 * whichever the project's scripts define), prints one line per check and
 * exits non-zero when any applicable check does not pass. Development tool:
 * the shipped runtime imports src/execution/verification.ts, never this file.
 *
 * Usage: node scripts/verify-final.ts
 */
import { finalChecks, runVerification, verificationSummary } from "../src/execution/verification.ts";

const top = process.cwd();
const report = await runVerification({ top, checks: finalChecks(top), signal: AbortSignal.timeout(120 * 60_000) });
for (const result of report.results) {
  const mark = result.state === "pass" ? "✓" : "✗";
  console.log(`${mark} ${result.summary}${result.reused ? " (reused: unchanged since the last pass)" : ""}`);
  if (result.output) console.log(result.output.split("\n").slice(-40).join("\n"));
}
console.log(report.note ?? `${report.results.length} check(s): ${report.state}`);
process.exit(report.state === "passing" ? 0 : 1);
