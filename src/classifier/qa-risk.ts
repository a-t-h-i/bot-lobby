/**
 * QA risk: once a task's implementation is done, how much verification the
 * change it built warrants, read from the actual diff rather than the
 * request. A five-line authorization change can be HIGH and a 500-line
 * documentation change NONE: what counts is how likely a meaningful
 * regression is, how far a break would spread and how hard it would be to
 * notice.
 *
 * The engine's rules read the change first (instant, no model): what kind of
 * files changed, how much and how widely, and whether the changed lines touch
 * an area where a defect spreads — security, persistent data, destructive
 * operations, concurrency, orchestration and recovery, isolation. Jev, when
 * it is on, reads the diff with those signals and has the last word on the
 * level within the rules' floors: an area the changed lines touch stays HIGH
 * unless Jev reads it as clearly untouched, and only a change that is plainly
 * non-functional skips the LLM QA pass. The result is the QA gate's budget:
 * its depth and a ceiling on new tests, never a quota.
 */
import { dirname } from "node:path";
import { QA_RISKS, type QaRisk, type QaRiskAssessment } from "../schemas/task.ts";
import type { Classifier } from "./classifier.ts";
import { noul, score, scoreOf, yesOf, type SystemOneRequest } from "./client.ts";
import { clip } from "./limits.ts";

/* ------------------------------------------------------------ reading the change */

export type FileKind = "docs" | "style" | "asset" | "generated" | "test" | "config" | "dependency" | "code";

const GENERATED = /(?:^|\/)(?:dist|build|out|coverage|vendor|__generated__|generated)\/|\.min\.(?:js|css)$|\.map$|\.snap$|\.generated\.\w+$/i;
const LOCKFILE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;
const MANIFEST = /(?:^|\/)(?:package\.json|requirements[\w.-]*\.txt|Pipfile|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|composer\.json)$/;
const TEST = /(?:^|\/)(?:tests?|__tests__|spec|e2e)\/|\.(?:test|spec)\.\w+$|_test\.(?:go|py)$|(?:^|\/)test_[\w-]+\.py$/i;
const DOC = /\.(?:md|mdx|markdown|rst|txt|adoc)$|(?:^|\/)(?:LICENSE|LICENCE|NOTICE|AUTHORS|CODEOWNERS)(?:\.\w+)?$/i;
const STYLE = /\.(?:css|scss|sass|less|styl|pcss)$/i;
const ASSET = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|woff2?|ttf|otf|eot|mp[34]|webm|wav|ogg|pdf)$/i;
const CONFIG = /\.(?:json|jsonc|ya?ml|toml|ini|cfg|conf|properties|env)$|(?:^|\/)\.[\w.-]+$|(?:^|\/)(?:Dockerfile|Makefile|Procfile)$/i;
/** A version in a manifest's changed line: a dependency moved, not just a setting. */
const VERSION = /\d+\.\d+|"\s*[~^*]|\blatest\b|\bworkspace:|\bgit\+|==|>=|~=/;

/** What a changed file is, by its path; a manifest counts as dependencies only when a version in it changed. */
export function fileKind(path: string, changed: readonly string[] = []): FileKind {
  if (LOCKFILE.test(path)) return "dependency";
  if (GENERATED.test(path)) return "generated";
  if (MANIFEST.test(path)) return changed.some((line) => VERSION.test(line)) ? "dependency" : "config";
  if (TEST.test(path)) return "test";
  if (DOC.test(path)) return "docs";
  if (STYLE.test(path)) return "style";
  if (ASSET.test(path)) return "asset";
  if (CONFIG.test(path)) return "config";
  return "code";
}

/** One file's changed lines in a diff: added and removed, the text after the marker. */
export interface FileChange {
  added: string[];
  removed: string[];
}

/**
 * The changed lines of each file in the diff the QA gate reads (`git diff`,
 * then the untracked new files whole). A file the diff was cut before is
 * simply missing; `total` is the stat's insertions and deletions when it
 * names them.
 */
export function parseDiff(diff: string): { files: Map<string, FileChange>; total?: number } {
  const files = new Map<string, FileChange>();
  let current: FileChange | undefined;
  let inHunk = false;
  let untracked = false;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/.+? b\/(.+)$/.exec(line);
    if (header) {
      current = { added: [], removed: [] };
      files.set(header[1]!, current);
      inHunk = false;
      continue;
    }
    if (/^New files \(untracked\):$/.test(line)) {
      untracked = true;
      current = undefined;
      continue;
    }
    if (untracked) {
      const named = /^--- (.+?)(?: \((?:large; read it directly|binary|unreadable)\))?$/.exec(line);
      if (named) {
        current = { added: [], removed: [] };
        files.set(named[1]!, current);
      } else current?.added.push(line);
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!current || !inHunk) continue;
    if (line.startsWith("+")) current.added.push(line.slice(1));
    else if (line.startsWith("-")) current.removed.push(line.slice(1));
  }
  const stat = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(diff);
  return { files, ...(stat ? { total: Number(stat[2] ?? 0) + Number(stat[3] ?? 0) } : {}) };
}

const SLASH_COMMENT = /^(?:\/\/|\/\*|\*|\*\/|\{\s*\/\*.*\*\/\s*\}$)/;
const COMMENTS: Array<[RegExp, RegExp]> = [
  [/\.(?:[cm]?[jt]sx?|java|kt|kts|go|rs|c|h|cc|cpp|hpp|cs|swift|scala|dart|css|scss|less)$/i, SLASH_COMMENT],
  [/\.(?:py|pyi|rb|sh|bash|zsh|pl|r|ya?ml|toml|ps1|ex|exs)$|(?:^|\/)(?:Dockerfile|Makefile)$/i, /^#/],
  [/\.(?:sql|lua|hs)$/i, /^--/],
  [/\.(?:html?|vue|svelte|xml)$/i, /^(?:<!--|-->)|-->$|^\/\/|^\/\*|^\*/],
  [/\.php$/i, /^(?:#|\/\/|\/\*|\*)/],
];

/** Every changed line is blank or a comment: the code does what it did. */
export function commentOnly(path: string, change: FileChange | undefined): boolean {
  if (!change) return false;
  const pattern = COMMENTS.find(([files]) => files.test(path))?.[1];
  if (!pattern) return false;
  return [...change.added, ...change.removed].every((line) => !line.trim() || pattern.test(line.trim()));
}

/* ------------------------------------------------------------ the areas where a defect spreads */

/** Areas that bias a change toward HIGH, and the two that only raise it to MEDIUM (contract, dependency). */
export const RISK_AREAS = ["security", "data", "destructive", "concurrency", "workflow", "isolation", "contract", "dependency"] as const;
export type RiskArea = (typeof RISK_AREAS)[number];
const SERIOUS: ReadonlySet<RiskArea> = new Set(["security", "data", "destructive", "concurrency", "workflow", "isolation"]);

interface AreaRule {
  /** The file's path names the area: weak evidence alone. */
  path?: RegExp;
  /** A changed line touches it: strong evidence. */
  text?: RegExp;
}

const AREA_RULES: Record<Exclude<RiskArea, "dependency">, AreaRule> = {
  security: {
    path: /auth|login|logout|password|permission|rbac|\bacl\b|secret|credential|oauth|jwt|security|crypto|csrf|sanitiz/i,
    text: /password|passwd|secret|credential|api[_-]?key|authori[sz]|authenticat|permission|\brbac\b|\bacl\b|oauth|\bjwt\b|csrf|\bxss\b|sanitiz|encrypt|decrypt|bcrypt|argon2|\bhmac\b|private[_-]?key/i,
  },
  data: {
    path: /migrations?\b|schema\.(?:prisma|sql|rb)$|\.sql$|persistence|database|(?:^|\/)db\//i,
    text: /\b(?:ALTER|CREATE|DROP)\s+(?:TABLE|INDEX|COLUMN|SCHEMA)\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bmigrat(?:e|ion)/i,
  },
  destructive: {
    text: /\brm(?:Sync|dirSync)?\s*\(|\bunlink(?:Sync)?\s*\(|\brm\s+-[a-z]*r[a-z]*f|shutil\.rmtree|os\.remove|\bTRUNCATE\b|\bDROP\s+TABLE\b|git\s+(?:reset\s+--hard|clean\s+-\w*f|push\s+(?:-f\b|--force)|branch\s+-D)|\bdeleteMany\s*\(/i,
  },
  concurrency: {
    path: /lock|mutex|semaphore|queue|scheduler|concurren|parallel/i,
    text: /\bmutex\b|\bsemaphore\b|\block(?:file)?s?\b|\bAtomics\.|worker_threads|\brace\b|concurren|Promise\.race|\btransaction\b/i,
  },
  workflow: {
    path: /workflow|state-?machine|transitions?\b|orchestrat|task-state|\bfsm\b|recover|rollback|retry|restore|resume/i,
    text: /\btransition\s*\(|state\s*machine|\brollback\b|\brecover(?:y)?\b/i,
  },
  isolation: {
    path: /worktree|isolation|sandbox/i,
    text: /\bworktree\b|\bsandbox\b|allowed_?tools/i,
  },
  contract: {
    path: /protocol|openapi|swagger|\.proto$|\.graphql$|(?:^|\/)(?:api|routes?|endpoints?)\//i,
    text: /\b(?:app|router|server)\.(?:get|post|put|patch|delete)\s*\(|@(?:Get|Post|Put|Patch|Delete)Mapping|@app\.route|@(?:router|app)\.(?:get|post|put|patch|delete)/i,
  },
};

const AREA_WORDS: Record<RiskArea, { factor: string; focus: string }> = {
  security: { factor: "security", focus: "security boundaries: the wrong user, no user and an expired session are refused, and no secret leaks" },
  data: { factor: "persistent data", focus: "data integrity: what is saved reads back the same, a migration runs on real data, and a failure halfway loses or corrupts nothing" },
  destructive: { factor: "destructive operations", focus: "destructive operations: they touch only what they should, and a failure halfway leaves things recoverable" },
  concurrency: { factor: "concurrency", focus: "concurrency: races, ordering, double runs, and a lock or claim that is never released" },
  workflow: { factor: "orchestration and state", focus: "state transitions and recovery: no illegal or stuck state, and a crash or failed step recovers" },
  isolation: { factor: "isolation", focus: "isolation: work stays inside its branch, worktree and permission boundaries" },
  contract: { factor: "a public contract", focus: "public contracts: existing callers and saved data keep working (backwards compatibility)" },
  dependency: { factor: "dependencies", focus: "dependencies: the new or changed package works as it is used, and nothing relied on the old one" },
};

/* ------------------------------------------------------------ the rules */

export interface QaRiskInput {
  /** The task's changed files, repository-relative. */
  files: readonly string[];
  /** The diff as the QA gate reads it. */
  diff: string;
  /** The request, for Jev's context. */
  request?: string;
  /** The task fixes a bug: it must no longer reproduce. */
  bugfix?: boolean;
}

/** Evidence the change touches an area: a changed line (strong), or only a path (weak). */
interface AreaHit {
  strong: boolean;
  /** `src/auth/reset.ts ("password")` or just the path. */
  where: string;
}

/** What the rules make of a change. */
export interface ChangeReading {
  risk: QaRisk;
  areas: Partial<Record<RiskArea, AreaHit>>;
  factors: string[];
  testsChanged: boolean;
  /** Files whose content can run: what Jev is asked to read. Nothing to read when there is none. */
  functional: number;
  /** Changed lines in those files. */
  lines: number;
  /** Frontend files changed (screens, components). */
  frontend: boolean;
  /** Only documentation, assets, generated files or comments: nothing that runs changed. */
  inert: boolean;
}

const UI_FILE = /\.(?:tsx|jsx|vue|svelte|html?)$|(?:^|\/)(?:components?|pages|screens|views)\//i;

function rank(risk: QaRisk): number {
  return QA_RISKS.indexOf(risk);
}

function higher(a: QaRisk, b: QaRisk): QaRisk {
  return rank(a) >= rank(b) ? a : b;
}

/** `src/workflow`, `webui/src/tabs`: where a file lives, at most three folders deep. */
function moduleOf(path: string): string {
  const dir = dirname(path);
  return dir === "." ? "(top)" : dir.split("/").slice(0, 3).join("/");
}

function listed(items: readonly string[], max = 3): string {
  return items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
}

/**
 * Read a change with plain rules: what changed, how much and how widely, and
 * which areas it touches. Deliberately cautious: whatever runs is at least
 * LOW, a touched area is HIGH (MEDIUM on a path alone), and only a change
 * with nothing that runs is NONE.
 */
export function readChange(input: QaRiskInput): ChangeReading {
  const { files: parsed, total } = parseDiff(input.diff);
  const kinds = input.files.map((path) => ({ path, kind: fileKind(path, [...(parsed.get(path)?.added ?? []), ...(parsed.get(path)?.removed ?? [])]) }));
  const functional = kinds.filter(({ path, kind }) => kind === "code" && !commentOnly(path, parsed.get(path)));
  const tests = kinds.filter(({ kind }) => kind === "test");
  const dependencies = kinds.filter(({ kind }) => kind === "dependency");
  const config = kinds.filter(({ kind }) => kind === "config");
  const styles = kinds.filter(({ kind }) => kind === "style");
  const count = (paths: ReadonlyArray<{ path: string }>) => paths.reduce((sum, { path }) => sum + (parsed.get(path)?.added.length ?? 0) + (parsed.get(path)?.removed.length ?? 0), 0);
  // A file the diff was cut before still counts: the stat's total is the safe side.
  const unseen = functional.some(({ path }) => !parsed.has(path));
  const lines = unseen ? Math.max(count(functional), total ?? 0) : count(functional);
  const factors: string[] = [];
  const areas: Partial<Record<RiskArea, AreaHit>> = {};

  // Areas: the changed lines of anything that runs or configures; a path alone counts for code only (a CI workflow is not orchestration).
  const scanned = kinds.filter(({ path, kind }) => (kind === "code" || kind === "config") && !commentOnly(path, parsed.get(path)));
  for (const [area, rule] of Object.entries(AREA_RULES) as Array<[Exclude<RiskArea, "dependency">, AreaRule]>) {
    for (const { path, kind } of scanned) {
      const change = parsed.get(path);
      const line = rule.text ? [...(change?.added ?? []), ...(change?.removed ?? [])].find((text) => !/^\s*(?:\/\/|\/\*|\*|#)/.test(text) && rule.text!.test(text)) : undefined;
      if (line !== undefined) {
        const word = rule.text!.exec(line)?.[0] ?? "";
        areas[area] = { strong: true, where: `${path} ("${word.trim()}")` };
        break;
      }
      if (!areas[area] && kind === "code" && rule.path?.test(path)) areas[area] = { strong: false, where: path };
    }
  }
  if (dependencies.length > 0) areas.dependency = { strong: true, where: listed(dependencies.map(({ path }) => path)) };
  for (const area of RISK_AREAS) {
    const hit = areas[area];
    if (hit) factors.push(`${AREA_WORDS[area].factor}: ${hit.where}${hit.strong ? "" : " (by its path)"}`);
  }

  const modules = [...new Set(functional.map(({ path }) => moduleOf(path)))];
  const inert = kinds.length > 0 && kinds.every(({ path, kind }) => kind === "docs" || kind === "asset" || kind === "generated" || (kind === "code" && commentOnly(path, parsed.get(path))));
  let risk: QaRisk;
  if (functional.length === 0) {
    // Nothing that runs changed: tests, a large style or config change still deserve a light look.
    const configLines = count(config);
    const styleLines = count(styles);
    if (tests.length > 0) {
      risk = "low";
      factors.push(`tests only: ${listed(tests.map(({ path }) => path))}`);
    } else if (configLines > 20 || styleLines > 150) {
      risk = "low";
      factors.push(configLines > 20 ? `${configLines} changed configuration lines` : `${styleLines} changed style lines`);
    } else {
      risk = "none";
      factors.push(`nothing that runs changed: ${listed(input.files)}`);
    }
  } else if (modules.length >= 4 || functional.length > 12 || lines > 800) {
    risk = "high";
    factors.push(`a wide change: ${functional.length} files, ${lines} changed lines across ${modules.length} modules (${listed(modules)})`);
  } else if (lines <= 40 && functional.length <= 2 && modules.length <= 1) {
    risk = "low";
    factors.push(`small and local: ${lines} changed lines in ${listed(functional.map(({ path }) => path))}`);
  } else {
    risk = "medium";
    factors.push(`${functional.length} files, ${lines} changed lines in ${listed(modules)}`);
  }
  for (const area of RISK_AREAS) {
    const hit = areas[area];
    if (!hit) continue;
    risk = higher(risk, SERIOUS.has(area) && hit.strong ? "high" : "medium");
  }
  if (input.bugfix) {
    risk = higher(risk, "low");
    factors.push("a bug fix: the bug must no longer reproduce");
  }
  if (tests.length > 0 && functional.length > 0) factors.push(`tests changed with it: ${listed(tests.map(({ path }) => path))}`);
  return {
    risk,
    areas,
    factors,
    testsChanged: tests.length > 0,
    functional: functional.length,
    lines,
    frontend: functional.some(({ path }) => UI_FILE.test(path)),
    inert,
  };
}

/* ------------------------------------------------------------ Jev */

const RISK_LEVELS = [
  "none: no behavioural risk — comments, documentation, wording, formatting, a trivial style tweak, metadata, generated files, or an obvious configuration value",
  "low: small and local, its behaviour plain and a failure contained — a simple UI change, straightforward wiring, a small mapping, basic validation, an isolated bug fix with obvious behaviour",
  "medium: meaningful behaviour changes and realistic regressions are possible — a new feature, API behaviour, business logic, state transitions, database access, several interacting components, a non-trivial bug fix",
  "high: a defect could spread widely or break an invariant — authentication, authorization, permissions, secrets, destructive operations, persistence and data integrity, migrations, concurrency, orchestration or state machines, recovery, isolation, public contracts, or a cross-cutting refactor",
];

const AREA_QUESTIONS: Record<Exclude<RiskArea, "dependency">, string> = {
  security: "Does `diff` change authentication, authorization, permissions, secrets, input sanitising or another security boundary?",
  data: "Does `diff` change how data is persisted, migrated or transformed, so a defect could lose or corrupt saved data?",
  destructive: "Does `diff` add or change an operation that deletes or overwrites files, data or history?",
  concurrency: "Does `diff` change concurrent or parallel behaviour: locks, queues, ordering, shared state, or work that can run twice at once?",
  workflow: "Does `diff` change orchestration or a state machine: which states or steps follow which, completion rules, retries, or recovery after a failure?",
  isolation: "Does `diff` change isolation: which branch, worktree, sandbox or permissions an agent or process works within?",
  contract: "Does `diff` change a public contract — an API route, a protocol, a file or wire format, a command-line interface — that existing callers or saved data rely on?",
};

/** What Jev made of the change. */
export interface JevRiskRead {
  risk: QaRisk;
  confidence: number;
  /** Probability of yes per area. */
  areas: Partial<Record<RiskArea, number>>;
  behaviour: number;
  testsCover: number;
  model: string;
}

export function qaRiskRequest(input: QaRiskInput, reading: ChangeReading): SystemOneRequest {
  const questions: SystemOneRequest["questions"] = {
    risk: score("How much verification does the change in `diff` warrant, judged by how likely it is to break something that works, how far a break would spread and how hard it would be to notice?", RISK_LEVELS),
    behaviour: noul(
      "Does `diff` change behaviour a user, a caller or another part of the system can observe?",
      "Yes: something works differently after it.",
      "No: it changes wording, comments, formatting, styling or metadata only.",
    ),
    tests_cover: noul(
      "Is the behaviour `diff` changes covered by tests — ones it adds or updates, or ones that plainly exist for this code — so few or no new tests are needed?",
      "Yes: a regression in what it changes would already fail a test.",
      "No: a regression in what it changes could pass every existing test.",
    ),
  };
  for (const [area, text] of Object.entries(AREA_QUESTIONS)) questions[`area_${area}`] = noul(text);
  return {
    state: {
      ...(input.request ? { request: clip(input.request, 2000) } : {}),
      changed_files: clip(input.files.join("\n"), 4000),
      engine_signals: clip(reading.factors.join("\n"), 2000),
      diff: clip(input.diff, 60_000),
    },
    questions,
  };
}

/** Jev's read of a change, or undefined when the classifier is off or fails. */
export async function readRiskWithJev(classifier: Classifier, input: QaRiskInput, reading: ChangeReading, signal?: AbortSignal): Promise<JevRiskRead | undefined> {
  if (!classifier.enabled("qa")) return undefined;
  const result = await classifier.ask("qa", qaRiskRequest(input, reading), signal ? { signal } : {});
  const level = scoreOf(result?.answers, "risk");
  if (!result || !level) return undefined;
  const areas: Partial<Record<RiskArea, number>> = {};
  for (const area of Object.keys(AREA_QUESTIONS) as RiskArea[]) {
    const yes = yesOf(result.answers, `area_${area}`);
    if (yes !== undefined) areas[area] = yes;
  }
  return {
    risk: QA_RISKS[Math.max(0, Math.min(QA_RISKS.length - 1, level.level))]!,
    confidence: level.confidence,
    areas,
    behaviour: yesOf(result.answers, "behaviour") ?? 0.5,
    testsCover: yesOf(result.answers, "tests_cover") ?? 0,
    model: result.model,
  };
}

/* ------------------------------------------------------------ the assessment */

/** New behavioural tests that may be worth writing at each level: ceilings, never quotas. */
export const TEST_BUDGETS: Record<QaRisk, { min: number; max: number }> = {
  none: { min: 0, max: 0 },
  low: { min: 0, max: 1 },
  medium: { min: 1, max: 3 },
  high: { min: 2, max: 6 },
};

/** How deep QA goes at each level. */
export const DEPTHS: Record<QaRisk, string> = {
  none: "the engine's checks only",
  low: "light",
  medium: "standard",
  high: "deep and adversarial",
};

/** Jev's floor for an area the rules found: confirmed keeps it serious, doubted lowers it, denied drops a path-only hit. */
function areaFloor(area: RiskArea, hit: AreaHit, jev: JevRiskRead | undefined): QaRisk {
  const serious = SERIOUS.has(area);
  if (area === "dependency") return "medium";
  const yes = jev?.areas[area];
  if (yes === undefined) return serious && hit.strong ? "high" : "medium";
  if (yes >= 0.5) return serious ? "high" : "medium";
  if (yes >= 0.2) return "medium";
  return hit.strong ? "medium" : "none";
}

/**
 * Combine the rules' reading with Jev's: Jev's level when it is confident,
 * never below the floors the touched areas set, never NONE for a change that
 * runs unless Jev reads it as plainly inert, and at least LOW for one Jev
 * reads as changing behaviour.
 */
export function combineRisk(reading: ChangeReading, jev: JevRiskRead | undefined, at = new Date().toISOString()): QaRiskAssessment {
  let risk: QaRisk = jev ? (jev.confidence >= 0.5 ? jev.risk : higher(jev.risk, reading.risk)) : reading.risk;
  const factors = [...reading.factors];
  const focus: string[] = [];
  const touched = new Set<RiskArea>();
  for (const area of RISK_AREAS) {
    const hit = reading.areas[area];
    if (!hit) continue;
    const floor = areaFloor(area, hit, jev);
    risk = higher(risk, floor);
    if (floor !== "none") touched.add(area);
  }
  for (const [area, yes] of Object.entries(jev?.areas ?? {}) as Array<[RiskArea, number]>) {
    if (reading.areas[area] || yes < 0.6) continue;
    risk = higher(risk, SERIOUS.has(area) ? "high" : "medium");
    touched.add(area);
    factors.push(`${AREA_WORDS[area].factor}: Jev reads it in the diff (${yes.toFixed(2)})`);
  }
  // Whatever runs is at least LOW, unless Jev reads a small change as plainly inert.
  const plainlyInert = jev !== undefined && jev.risk === "none" && jev.confidence >= 0.6 && jev.behaviour < 0.3 && reading.lines <= 20 && touched.size === 0;
  if (reading.functional > 0 && !plainlyInert) risk = higher(risk, "low");
  if (reading.risk === "none" && jev && jev.behaviour >= 0.6) risk = higher(risk, "low");
  for (const area of touched) focus.push(AREA_WORDS[area].focus);
  if (factors.some((factor) => factor.startsWith("a bug fix"))) focus.push("the reported bug no longer reproduces");
  if (reading.frontend && focus.length < 4) focus.push("the changed screens: what the user sees and can do");
  if (focus.length === 0 && risk !== "none") focus.push("the changed behaviour, as its callers and users see it");
  const existing = risk === "none" || reading.testsChanged || (jev ? jev.testsCover >= 0.6 : risk === "low" && !factors.some((factor) => factor.startsWith("a bug fix")));
  const budget = TEST_BUDGETS[risk];
  const why = jev
    ? `Jev read the diff as ${jev.risk} (${jev.confidence.toFixed(2)})${jev.risk !== risk ? `; the touched areas and the rules set ${risk}` : ""}`
    : "the engine's rules (Jev is off or had nothing to read)";
  return {
    risk,
    qaRequired: risk !== "none",
    testBudget: { min: existing ? 0 : budget.min, max: budget.max },
    focusAreas: focus.slice(0, 5),
    riskFactors: factors.slice(0, 8),
    existingTestsLikelySufficient: existing,
    reasoning: `${risk.toUpperCase()}: ${factors.slice(0, 3).join("; ")}. ${why}.`,
    source: jev ? "classifier" : "rules",
    at,
  };
}

/**
 * The QA risk of a change: the rules, refined by Jev when it is on and there
 * is code or configuration to read. Never throws: Jev failing leaves the
 * rules' reading.
 */
export async function assessQaRisk(input: QaRiskInput, classifier?: Classifier, signal?: AbortSignal): Promise<QaRiskAssessment> {
  const reading = readChange(input);
  let jev: JevRiskRead | undefined;
  if (classifier && !reading.inert) {
    try {
      jev = await readRiskWithJev(classifier, input, reading, signal);
    } catch {
      jev = undefined;
    }
  }
  return combineRisk(reading, jev);
}

/** The assessment when the change could not be read (no git, or nothing changed): QA reviews it in full. */
export function unreadRisk(why: string, at = new Date().toISOString()): QaRiskAssessment {
  return {
    risk: "medium",
    qaRequired: true,
    testBudget: { ...TEST_BUDGETS.medium },
    focusAreas: ["the acceptance criteria, checked against the repository as it stands"],
    riskFactors: [why],
    existingTestsLikelySufficient: false,
    reasoning: `MEDIUM: ${why}, so QA reviews the work in full.`,
    source: "rules",
    at,
  };
}

/* ------------------------------------------------------------ words */

/** `0`, `0-1`, `1-3`. */
export function budgetWords(budget: { min: number; max: number }): string {
  return budget.min === budget.max ? `${budget.max}` : `${budget.min}-${budget.max}`;
}

/** One line: `QA risk: high (Jev) · 0-6 new tests at most · security, orchestration and state`. */
export function qaRiskLine(assessment: QaRiskAssessment): string {
  const by = assessment.source === "classifier" ? "Jev" : "rules";
  const tests = assessment.qaRequired ? `${budgetWords(assessment.testBudget)} new tests at most` : "no QA agent, the engine's checks decide";
  const about = assessment.riskFactors.map((factor) => factor.split(":")[0]).slice(0, 3).join(", ");
  return `QA risk: ${assessment.risk} (${by}) · ${tests}${about ? ` · ${about}` : ""}`;
}

/**
 * The assessment as the QA agent reads it: its level, depth and test budget,
 * where to look, and why. The levels themselves are explained in qa.md.
 */
export function qaRiskBrief(assessment: QaRiskAssessment): string {
  return [
    `## QA risk: ${assessment.risk.toUpperCase()} (${assessment.source === "classifier" ? "Jev's read of the diff" : "the engine's rules"})`,
    `Depth: ${DEPTHS[assessment.risk]}. Test budget: ${budgetWords(assessment.testBudget)} new behavioural tests at most — a ceiling, never a quota; write none that adds no confidence.`,
    `Existing tests likely enough: ${assessment.existingTestsLikelySufficient ? "yes — find and run them before writing any" : "no — find what exists first, then cover only the gaps that matter"}.`,
    assessment.focusAreas.length > 0 ? `Focus:\n${assessment.focusAreas.map((area) => `- ${area}`).join("\n")}` : "",
    assessment.riskFactors.length > 0 ? `Why:\n${assessment.riskFactors.map((factor) => `- ${factor}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}
