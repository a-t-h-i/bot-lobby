/**
 * A task's track: how serious its request reads, and so who takes part and
 * how much process it gets. A small, clear, low-risk request takes the fast
 * track: the oracle delegates straight to the agents it needs (no scouts, no
 * proposal round, no plan document), QA takes part only when the change
 * needs tests, and the researcher only when it needs facts from outside the
 * repository. Anything bigger, riskier or unclear takes the full workflow.
 *
 * The engine reads the request once as the task starts, with the rules below
 * (instant, no model), refined by the classifier's triage when that is on.
 * The oracle confirms the track by acting on it or corrects it with
 * `action=track`; the user can force either path with `--fast` or `--full`.
 * Once work is under way a track only gets stricter.
 */
import type { Task, TaskTrack, TaskTriage, TrackMember, TrackPath, TriageSize } from "../schemas/task.ts";

export const TRACK_MEMBERS: readonly TrackMember[] = ["designer", "backend", "qa", "researcher"];

/** How each member reads in the lobby and the oracle's context. */
export const MEMBER_LABELS: Record<TrackMember, string> = {
  designer: "DESIGN (frontend)",
  backend: "DEV (backend)",
  qa: "QA (tests)",
  researcher: "RESEARCH (web)",
};

/** Names the oracle or a user may use for a member. */
const MEMBER_ALIASES: Record<string, TrackMember> = {
  designer: "designer",
  design: "designer",
  frontend: "designer",
  "front-end": "designer",
  ui: "designer",
  backend: "backend",
  "back-end": "backend",
  dev: "backend",
  qa: "qa",
  tests: "qa",
  test: "qa",
  researcher: "researcher",
  research: "researcher",
};

/** A roster in its canonical order; unknown names are an error naming the choices. */
export function parseRoster(values: readonly string[]): TrackMember[] {
  const members = new Set<TrackMember>();
  for (const value of values) {
    const member = MEMBER_ALIASES[value.trim().toLowerCase()];
    if (!member) throw new Error(`"${value}" is not a roster member (designer, backend, qa, researcher)`);
    members.add(member);
  }
  return TRACK_MEMBERS.filter((member) => members.has(member));
}

/* ------------------------------------------------------------ the rules */

function terms(list: readonly string[]): RegExp {
  const alternatives = [...list]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]+"));
  return new RegExp(`(?<![\\w-])(?:${alternatives.join("|")})(?![\\w-])`, "i");
}

const FRONTEND = terms([
  "ui", "ux", "frontend", "front-end", "page", "pages", "screen", "screens", "button", "buttons", "css", "scss", "sass",
  "style", "styles", "styling", "stylesheet", "layout", "component", "components", "modal", "dialog", "popup", "form", "forms",
  "input field", "react", "vue", "svelte", "angular", "html", "jsx", "tsx", "color", "colour", "colors", "colours", "font",
  "fonts", "typography", "responsive", "mobile", "animation", "animations", "icon", "icons", "tooltip", "tooltips", "navbar",
  "nav bar", "navigation", "menu", "dropdown", "header", "footer", "sidebar", "theme", "dark mode", "light mode", "tailwind",
  "tab", "tabs", "landing page", "hero", "banner", "card", "cards", "placeholder", "label", "labels", "image", "images", "logo",
  "spacing", "padding", "margin", "align", "alignment", "accessibility", "a11y", "aria", "wireframe", "mockup", "hover",
  "scroll", "scrolling", "chart", "charts", "dashboard", "toast", "spinner", "loading state", "empty state", "checkbox",
  "toggle", "carousel", "breadcrumb",
]);

const BACKEND = terms([
  "api", "apis", "endpoint", "endpoints", "backend", "back-end", "server", "servers", "server-side", "database", "databases",
  "db", "sql", "postgres", "postgresql", "mysql", "sqlite", "mongo", "mongodb", "redis", "query", "queries", "migration",
  "migrations", "schema", "column", "columns", "auth", "authentication", "authorization", "login", "logout", "sign in",
  "sign up", "signup", "session", "sessions", "token", "tokens", "jwt", "oauth", "service", "services", "microservice",
  "queue", "queues", "job", "jobs", "cron", "cache", "caching", "webhook", "webhooks", "controller", "controllers", "route",
  "routes", "router", "middleware", "orm", "graphql", "rest api", "grpc", "websocket", "websockets", "lambda", "cli", "email",
  "emails", "upload", "uploads", "payment", "payments", "stripe", "rate limit", "rate limiting", "logging", "docker",
  "deploy", "deployment", "pipeline", "env var", "environment variable", "validation", "csv export", "notification",
  "notifications", "backup", "backups", "parser", "status code", "http", "404", "500", "index on", "kafka", "rabbitmq",
  "elasticsearch",
]);

const TESTS = terms([
  "test", "tests", "testing", "tested", "unit test", "unit tests", "e2e", "end-to-end", "integration test", "integration tests",
  "coverage", "qa", "regression", "regressions", "flaky", "assertion", "assertions", "test suite", "ci",
]);

const BUGFIX = terms([
  "bug", "bugs", "buggy", "fix", "fixes", "broken", "breaks", "crash", "crashes", "crashing", "error", "errors", "exception",
  "fails", "failing", "failure", "wrong", "incorrect", "doesn't work", "does not work", "not working", "isn't working",
  "nan", "undefined",
]);

const RESEARCH = terms([
  "latest", "newest", "current version", "up-to-date", "deprecated in", "release notes", "official docs",
  "documentation for", "docs for", "look up", "search the web", "search online", "web search", "on the internet",
  "alternatives", "alternative to", "which library", "what library", "best library", "which package", "best practice",
  "best practices", "recommended way", "industry standard", "benchmark", "benchmarks", "pricing", "rfc", "wcag", "cve",
  "security advisory", "third-party api", "sdk", "upgrade to", "migrate to", "version of", "browser support",
  "compatibility", "compatible with", "research", "verify online",
]);

/** Serious whatever its size: security, money, data, production. Such a change gets a plan and the QA gate. */
const RISK = terms([
  "security", "secure", "vulnerability", "vulnerabilities", "cve", "exploit", "xss", "csrf", "injection", "auth",
  "authentication", "authorization", "authorisation", "permission", "permissions", "rbac", "access control", "password",
  "passwords", "credential", "credentials", "secret", "secrets", "api key", "api keys", "encryption", "encrypt", "decrypt",
  "oauth", "jwt", "session store", "session storage", "cookie", "cookies", "payment", "payments", "billing", "invoice", "invoices", "checkout", "stripe", "refund", "refunds",
  "migration", "migrations", "migrate", "data loss", "delete data", "drop table", "backfill", "production", "prod",
  "deploy", "deployment", "gdpr", "privacy", "pii", "personal data", "race condition", "concurrency", "transaction",
  "transactions",
]);

const LARGE = terms([
  "architecture", "architectural", "re-architect", "rearchitect", "rewrite", "overhaul", "from scratch", "subsystem",
  "new system", "entire", "whole app", "whole codebase", "whole project", "across the codebase", "across the app",
  "across the project", "everywhere", "every page", "every screen", "all pages", "all screens", "cross-cutting",
  "multi-tenant", "multitenant", "microservices", "monorepo", "internationalization", "internationalisation",
  "localization", "localisation", "i18n", "real-time", "realtime", "offline support", "plugin system", "redesign",
  "replatform",
]);

const MEDIUM = terms([
  "refactor", "refactoring", "restructure", "reorganize", "reorganise", "consolidate", "deduplicate", "integrate",
  "integration", "support for", "slow", "slowness", "performance", "memory leak", "leak", "leaks", "intermittent",
  "intermittently", "sometimes", "randomly", "deadlock", "hangs", "freezes", "timeouts", "upgrade", "upgrading",
  "dependency", "dependencies", "library", "sdk", "latest version", "new version", "redis", "kafka", "rabbitmq",
  "elasticsearch", "schema", "websocket", "websockets", "queue", "queues", "webhook", "webhooks", "dark mode", "theming",
]);

/** A new capability: building a page, a flow, an endpoint or a system is more than a small change. */
const FEATURE = /\b(?:add|adds|adding|create|build|implement|introduce|develop|design|set up|setup)\b[^.\n]{0,40}?\b(?:pages?|screens?|features?|flows?|endpoints?|apis?|services?|systems?|modules?|dashboards?|integrations?|wizards?|workflows?|pipelines?|onboarding|notifications?|reports?)\b/i;

const TRIVIAL = terms([
  "typo", "typos", "spelling", "misspelled", "misspelling", "grammar", "wording", "reword", "rephrase", "rename", "renaming",
  "copy change", "text change", "label", "color", "colour", "colors", "colours", "font size", "font weight", "padding",
  "margin", "spacing", "align", "alignment", "capitalize", "capitalise", "capitalization", "capitalisation", "icon",
  "placeholder", "tooltip", "broken link", "dead link", "docstring", "readme", "changelog", "bump", "version bump",
  "one-line", "one line", "one-liner", "unused import", "unused imports", "unused variable", "remove unused", "dead code",
  "lint", "linting", "formatting", "whitespace", "indentation", "log message", "error message",
]);

const DOCS = terms(["readme", "docs", "documentation", "changelog", "docstring", "docstrings", "jsdoc", "comment", "comments"]);

const VAGUE = terms([
  "improve", "better", "nicer", "cleaner", "optimize", "optimise", "enhance", "polish", "revamp", "clean up", "cleanup",
  "tidy", "modernize", "modernise", "something", "somehow", "etc",
]);

const UNDECIDED = terms(["not sure", "unsure", "should we", "which is better", "what do you think", "pros and cons", "tbd", "or maybe"]);

const INVESTIGATE = /^\s*(?:why|how come|explain|investigate|diagnose|figure out|find out|look into|understand)\b/i;

const FRONTEND_FILE = /\.(?:css|scss|sass|less|html?|jsx|tsx|vue|svelte|astro)\b/i;
const BACKEND_FILE = /\.(?:py|go|rs|java|kt|rb|php|cs|sql|prisma|proto)\b/i;
const TEST_FILE = /\.(?:test|spec)\.[a-z]+\b|(?:^|[\s/`'"(])(?:tests?|__tests__|spec)\//i;
/** A file, a path or code in backticks: the request names what to change. */
const CONCRETE = /[\w.-]+\/[\w./-]+|\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|css|scss|html|md|json|ya?ml|toml|sql|vue|svelte|sh)\b|`[^`\n]+`/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;

/** What the rules make of a request. */
export interface RequestReading {
  size: TriageSize;
  roster: TrackMember[];
  /** Why it is serious whatever its size, when it is. */
  risk?: string;
  /** Why it reads unclear, when it does. */
  unclear?: string;
  reasons: string[];
}

function matched(pattern: RegExp, text: string): string | undefined {
  return pattern.exec(text)?.[0].toLowerCase().replace(/\s+/g, " ");
}

/**
 * Read a request with plain rules: its size, who it needs, and whether it is
 * risky or unclear. Deliberately cautious: a request the rules cannot place
 * as small and clear goes to the full workflow, where the oracle can still
 * take it fast.
 */
export function readRequest(request: string): RequestReading {
  const text = request.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const items = text.split("\n").filter((line) => LIST_ITEM.test(line)).length;
  const concrete = CONCRETE.test(text);
  const reasons: string[] = [];

  const large = matched(LARGE, text) ?? (words > 200 ? `${words} words` : items >= 8 ? `${items} requirements` : undefined);
  const feature = matched(FEATURE, text);
  const medium = feature ? `new capability (${feature})` : matched(MEDIUM, text) ?? (words > 60 ? `${words} words` : items >= 3 ? `${items} requirements` : undefined);
  const trivial = words <= 30 ? matched(TRIVIAL, text) : undefined;
  const size: TriageSize = large ? "large" : medium ? "medium" : trivial ? "trivial" : "small";
  reasons.push(large ? `large: ${large}` : medium ? `medium: ${medium}` : trivial ? `trivial: ${trivial}` : "small change");

  const frontend = matched(FRONTEND, text) ?? (FRONTEND_FILE.test(text) ? "a frontend file" : undefined);
  const backend = matched(BACKEND, text) ?? (BACKEND_FILE.test(text) ? "a backend file" : undefined);
  const docsOnly = !frontend && !backend && DOCS.test(text);
  const roster = new Set<TrackMember>();
  if (frontend) roster.add("designer");
  if (backend) roster.add("backend");
  const asked = matched(TESTS, text) ?? (TEST_FILE.test(text) ? "a test file" : undefined);
  const bugfix = size !== "trivial" && !docsOnly ? matched(BUGFIX, text) : undefined;
  const tests = asked
    ? `tests: asked for (${asked})`
    : bugfix
      ? `tests: a bug fix needs a regression test (${bugfix})`
      : backend && size !== "trivial"
        ? `tests: backend logic (${backend})`
        : size === "medium" || size === "large"
          ? "tests: the QA gate checks a change this size"
          : undefined;
  if (tests) {
    roster.add("qa");
    reasons.push(tests);
  }
  const research = matched(RESEARCH, text);
  if (research) {
    roster.add("researcher");
    reasons.push(`research: ${research}`);
  }

  const risk = matched(RISK, text);
  if (risk) reasons.push(`serious: touches ${risk}`);
  const vague = words < 8 && !concrete ? matched(VAGUE, text) : undefined;
  const undecided = matched(UNDECIDED, text);
  const unclear = words < 3
    ? "too short to act on"
    : INVESTIGATE.test(text) ? "asks to investigate before any change"
      : undecided ? `leaves a decision open (${undecided})`
        : vague ? `vague (${vague})` : undefined;
  if (unclear) reasons.push(`unclear: ${unclear}`);

  return { size, roster: TRACK_MEMBERS.filter((member) => roster.has(member)), ...(risk ? { risk } : {}), ...(unclear ? { unclear } : {}), reasons };
}

/* ------------------------------------------------------------ choosing a track */

/** A triage probability the track takes as a yes. */
const YES = 0.5;
/** Below this the classifier's size is a guess, and the rules' size stands. */
const SIZE_CONFIDENCE = 0.6;

export interface TrackOptions {
  /** `workflow.fastTrack`: false puts every task on the full workflow. */
  fastTrack: boolean;
  /** The user's `--fast` or `--full`. */
  forced?: TrackPath;
  /** The task follows a plan agreed in the planning panel. */
  approvedPlan?: boolean;
}

/**
 * The track a new task starts on. The rules read the request; the
 * classifier's triage, when there is one, has the last word on size, domains
 * and clarity. Risk and missing clarity always mean the full workflow, and
 * QA or the researcher join when either reading asks for them.
 */
export function chooseTrack(request: string, triage: TaskTriage | undefined, options: TrackOptions, now = new Date().toISOString()): TaskTrack {
  const rules = readRequest(request);
  let size = rules.size;
  let roster = new Set(rules.roster);
  let unclear = rules.unclear;
  const reasons = [...rules.reasons];
  if (triage) {
    if (triage.sizeConfidence >= SIZE_CONFIDENCE) size = triage.size;
    const building = (["designer", "backend"] as const).filter((domain) => (triage.domains[domain] ?? 0) >= YES);
    if (building.length > 0) roster = new Set([...building, ...[...roster].filter((member) => member === "qa" || member === "researcher")]);
    if ((triage.domains.qa ?? 0) >= YES) roster.add("qa");
    if (triage.research >= YES) roster.add("researcher");
    unclear = triage.ambiguous >= YES ? "the classifier reads it as ambiguous" : undefined;
    reasons.splice(0, reasons.length, `classifier: ${triage.size} (${triage.sizeConfidence.toFixed(2)})${triage.kind ? `, ${triage.kind}` : ""}`, ...rules.reasons.filter((reason) => !/^(?:trivial|small|medium|large|unclear)\b/.test(reason)));
    if (unclear) reasons.push(`unclear: ${unclear}`);
  }
  const source: TaskTrack["source"] = triage ? "classifier" : "rules";
  const fast = (size === "trivial" || size === "small") && !rules.risk && !unclear;
  const [path, why, by]: [TrackPath, string[], TaskTrack["source"]] = options.forced
    ? [options.forced, [`the user asked for the ${options.forced === "fast" ? "fast track" : "full workflow"}`], "user"]
    : options.approvedPlan
      ? ["full", ["follows a plan agreed in the planning panel"], "plan"]
      : !options.fastTrack
        ? ["full", ["the fast track is off in settings"], source]
        : [fast ? "fast" : "full", [], source];
  // The full workflow always ends with the QA gate.
  if (path === "full") roster.add("qa");
  return {
    path,
    size,
    roster: TRACK_MEMBERS.filter((member) => roster.has(member)),
    reasons: [...why, ...reasons],
    source: by,
    ...(options.forced ? { userChoice: options.forced } : {}),
    at: now,
  };
}

/* ------------------------------------------------------------ what a track asks of the engine */

export function onFastTrack(task: Task): boolean {
  return task.track?.path === "fast";
}

/** Whether QA must take part before the task completes: always on the full workflow, on the fast track when the change needs tests. */
export function qaRequired(task: Task): boolean {
  return !onFastTrack(task) || Boolean(task.track?.roster.includes("qa"));
}

function finishedAt(run: { startedAt: string; finishedAt?: string }): number {
  return Date.parse(run.finishedAt ?? run.startedAt);
}

/**
 * On the fast track QA takes part as the last step: a QA worker run that
 * started after every other domain's work finished, so the tests it wrote and
 * ran cover the change as it stands.
 */
export function qaWorkerCameLast(task: Task): boolean {
  const done = (task.workerRuns ?? []).filter((run) => run.status === "success");
  const qa = done.filter((run) => run.domain === "qa");
  if (qa.length === 0) return false;
  const others = done.filter((run) => run.domain !== "qa");
  const last = Math.max(0, ...others.map(finishedAt));
  return qa.some((run) => Date.parse(run.startedAt) >= last);
}

/** QA has taken part as the task's track asks: the gate passed, or (fast track) its worker came last. */
export function qaTookPart(task: Task): boolean {
  return task.qaVerdict === "pass" || (onFastTrack(task) && qaWorkerCameLast(task));
}

/** QA's part is still to come: the time budget keeps its reserve until then. */
export function qaStillDue(task: Task): boolean {
  return qaRequired(task) && !qaTookPart(task);
}

/** A worker step finished: the fast track completes only once something was built. */
export function builtSomething(task: Task): boolean {
  return (task.workerRuns ?? []).some((run) => run.status === "success");
}

/* ------------------------------------------------------------ words */

export function rosterWords(roster: readonly TrackMember[]): string {
  return roster.length > 0 ? roster.map((member) => MEMBER_LABELS[member]).join(", ") : "the one domain that owns the files (the oracle picks)";
}

/** The track in one line, for the oracle's context and `/bot-lobby status`. */
export function trackSummary(track: TaskTrack): string {
  const path = track.path === "fast" ? "fast track" : "full workflow";
  return `Track: ${path} (${track.size}; set by ${track.source}) · who takes part: ${rosterWords(track.roster)} · why: ${track.reasons.join("; ")}`;
}

/** A short line for the activity log. */
export function trackLine(track: TaskTrack): string {
  const members = track.roster.map((member) => MEMBER_LABELS[member].split(" ")[0]).join(", ");
  return `track: ${track.path} · ${track.size} · ${members || "domain to pick"} · ${track.source}`;
}

/** What the oracle does next on the fast track, once a worker has reported. */
export function fastNext(task: Task): string {
  if (!qaRequired(task)) return "Next (fast track): check `git diff --stat` and this report; if the work is in, call action=complete. No QA gate on this track: nothing here needs tests.";
  if (qaTookPart(task)) return "Next (fast track): QA has taken part (its step came last). Check `git diff --stat`, then call action=complete.";
  return "Next (fast track): check `git diff --stat`. QA takes part before completion: give qa the tests as the last step (action=implement domain=qa), or run action=qa; then call action=complete.";
}
