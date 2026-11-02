/**
 * Final verification: the engine-run checks a task must pass before its work
 * is committed and it is called complete (see workflow.ts handleComplete).
 * Like the lint gate, a result is a check the engine ran, never an agent's
 * word; and a recorded pass is reused only while everything it covered —
 * sources, configuration, dependencies, commands and environment — is
 * unchanged. Missing, stale, failed, cancelled and unavailable results are
 * never passes.
 */

export type VerifyState = "pass" | "fail" | "unavailable" | "cancelled";

export interface VerifyResult {
  /** The check's id: `typecheck`, `test`, `web:build`, `web:check`. */
  id: string;
  state: VerifyState;
  at: string;
  ms: number;
  /** The check's inputs, command and environment as they stood: an equal key means an equal result. */
  fingerprint: string;
  /** A pass taken from the previous report rather than re-run. */
  reused?: boolean;
  /** One line; on a failure, what to do about it. */
  summary: string;
  /** The tail of what the check printed when it failed or could not run. */
  output?: string;
}

export interface VerificationReport {
  at: string;
  /** passing: every applicable check passed; failing: any did not. */
  state: "passing" | "failing";
  /** Every result's id and fingerprint: equal key means an equal report. */
  fingerprint: string;
  results: VerifyResult[];
  /** Why nothing was applicable, when nothing was (no scripts to run). */
  note?: string;
}
