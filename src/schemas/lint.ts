/**
 * What the lint gate found: per linter run, and for the task as a whole. The
 * engine records the last report on the task, so completion, QA and the
 * lobby read the same result, and an unchanged tree is not linted twice.
 */

export type LintState = "passing" | "failing" | "unavailable" | "skipped";

export interface LintFinding {
  /** Repository-relative, with forward slashes. */
  file: string;
  line?: number;
  column?: number;
  rule?: string;
  message: string;
  severity: "error" | "warning";
  /** On a line the task changed (or in a file it created); false for what was already there. */
  fresh?: boolean;
}

export interface LintRun {
  /** ESLint, Biome, Oxlint, Ruff, or the command from Settings. */
  tool: string;
  /** The folder it ran in, repository-relative ("" at the top). */
  folder: string;
  files: string[];
  state: "passing" | "failing" | "unavailable";
  errors: number;
  warnings: number;
  /** At most `MAX_FINDINGS` of them, those on changed lines first; the counts stay whole. */
  findings: LintFinding[];
  /** The tail of what it printed when that could not be read as findings, or why it could not run. */
  output?: string;
  ms: number;
}

export interface LintReport {
  at: string;
  /** failing: errors on lines the task changed; passing: none (what was already there never fails it). */
  state: LintState;
  /** The touched files it covered, repository-relative. */
  files: string[];
  runs: LintRun[];
  errors: number;
  warnings: number;
  /** Of those, on lines the task changed or in files it created. */
  freshErrors: number;
  freshWarnings: number;
  /** Lint suppressions and lint-config changes the task added, one line each, for QA to judge. */
  suppressions: string[];
  /** Why nothing ran, when nothing did. */
  note?: string;
  /** The touched files as they stood and the settings: an equal key means an equal result. */
  fingerprint: string;
}
