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

// The Settings page's linting wizard (`settings.lintSetup`).

export type LintRuleLevel = "off" | "warn" | "error";
/** A rule's level as the page shows it: `default` is whatever the project's config (or the linter) already says. */
export type RuleChoice = "default" | LintRuleLevel;

export interface LintRuleInfo {
  id: string;
  label: string;
  help: string;
  level: RuleChoice;
}

export interface LintSetupLinter {
  tool: string;
  /** Repository-relative ("" at the top). */
  folder: string;
  installed: boolean;
  /** The file the rules are read from and written to, repository-relative, when there is one. */
  config?: string;
  /** file: switches edit `config`; gate: they are the lint gate's `--rule` flags; read: shown, not switchable (see `note`). */
  rulesAt: "file" | "gate" | "read";
  /** The levels a rule can take: Ruff has no warnings, so its rules are on (error) or off. */
  levels: LintRuleLevel[];
  rules: LintRuleInfo[];
  /** Commands that install it in its folder, when it is not installed. */
  install: string[];
  note?: string;
}

/** A step of setting up a linter the project does not have yet: a command to run, or a starter config the page writes. */
export interface LintSetupStep {
  label: string;
  command?: string;
  /** The config file the page creates for this step (`ruff.toml`). */
  create?: string;
}

export interface LintSetupOffer {
  tool: string;
  blurb: string;
  steps: LintSetupStep[];
}

export interface LintSetup {
  linters: LintSetupLinter[];
  offers: LintSetupOffer[];
}

