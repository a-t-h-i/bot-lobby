import type { Domain, Role } from "./agent.ts";
import { defaultHarnesses, harnessChoiceFields, harnessRunOf, normalizeHarnesses, type HarnessChoice, type HarnessesConfig, type HarnessRun } from "./harness.ts";

export type ModelRef = "inherit" | string;

/** Thinking levels accepted by the pi CLI (`--thinking`). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

/**
 * A model value meaning "not configured". The master keeps the live session;
 * a subagent falls back to the session's model until settings pin one.
 * Thinking never inherits: every agent runs at the level its settings name.
 */
const INHERIT = "inherit";
export const INHERIT_MODEL = INHERIT;
/** Level used for a missing, legacy `inherit` or unknown thinking value. */
export const DEFAULT_THINKING: ThinkingLevelName = "medium";
/** Scouts are reconnaissance: always fast, never configurable. */
export const SCOUT_THINKING: ThinkingLevelName = "low";

export function isThinkingLevel(value: string): value is ThinkingLevelName {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

export interface AgentModelConfig extends HarnessChoice {
  model: ModelRef;
  thinking: string;
  /** Free-form instructions layered on top of this agent's built-in prompt. */
  instructions?: string;
  /** Exact native MCP tool names this profile may call; empty grants none. */
  mcpTools?: string[];
  /** Names of the skills this agent may load; absent gives it every skill pi finds, empty gives it none. */
  skills?: string[];
  /** Compact this agent's context on its own as it fills (on unless false); the oracle's also updates the knowledge base. */
  autoCompact?: boolean;
}

/** Scouts pick a model only; their thinking is fixed at `SCOUT_THINKING`. */
export interface ScoutConfig extends HarnessChoice {
  mcpTools?: string[];
  /** See AgentModelConfig.skills. */
  skills?: string[];
  model: ModelRef;
  /** Tool calls a scout may make: it is told to wrap up at 60% and refused more past this, so it reports with what it has; 0 = no limit. */
  maxToolCalls: number;
  /** Compact a scout's context on its own as it fills (on unless false). */
  autoCompact?: boolean;
}

/** Subagent kinds with their own settings entry. */
export const SUBAGENT_KINDS = ["designer", "backend", "qa", "scout", "researcher", "quickfix", "planner"] as const;
export type SubagentKind = (typeof SUBAGENT_KINDS)[number];

/** Lobby agents that run outside the workflow: direct quick fixes and the task planner. */
export type LobbyAgentKind = "quickfix" | "planner";

/** Settings kinds a workflow run (domain + role) can draw from. */
export type WorkflowProfileKind = Domain | "scout" | "researcher";

/**
 * Whether a new task gets a git branch of its own (`branch`: created and
 * checked out in the working folder) or a worktree of its own (`worktree`: a
 * second checkout every agent of the task runs in), named after the task.
 */
export const GIT_ISOLATIONS = ["off", "branch", "worktree"] as const;
export type GitIsolation = (typeof GIT_ISOLATIONS)[number];

export function isGitIsolation(value: unknown): value is GitIsolation {
  return typeof value === "string" && (GIT_ISOLATIONS as readonly string[]).includes(value);
}

export interface WorkflowConfig {
  maxReviewIterations: number;
  maxParallelScouts: number;
  requireApprovalForFeatures: boolean;
  requireApprovalForDependencies: boolean;
  requireApprovalForArchitectureChanges: boolean;
  /** Bounded retries for transient agent failures (crash/stall), §59. A cancel never retries. */
  maxAgentRetries: number;
  /** Kill a subagent after this long without any output; 0 disables. */
  stallTimeoutMs: number;
  /** Silence allowed while a single tool call runs (tests, builds); 0 disables. */
  toolStallTimeoutMs: number;
  /** Workers that may run at once when the Master delegates several domains together. */
  maxParallelWorkers: number;
  /** The oracle starts each task with a clean context: its model is sent only the conversation since the task started, or since the last one ended. */
  freshContext: boolean;
  /** Small, clear, low-risk requests take the fast track (no scouts, proposal or plan; QA only when tests are needed); false puts every task on the full workflow. */
  fastTrack: boolean;
  /** A delegation that names nothing concrete, or is long without done criteria, is sent back to the oracle once for a fuller brief (sending it again unchanged goes through). */
  briefCheck: boolean;
  /** A new request that one agent can do alone goes to the quick-fix agent once the oracle confirms; false makes every request a task. */
  routeQuickFixes: boolean;
  /** A new task gets a git branch or worktree of its own, named after it; `--branch` and `--worktree` decide for one task. */
  gitIsolation: GitIsolation;
  /** Scouts, workers, quick fixes and the planner get the repository map: the layout and the files matching their step, with each file's purpose, names and unchanged scout notes. */
  repoMap: boolean;
  /** A scout asked the same thing again for the same task, on a tree that has not changed, reuses its findings instead of running. */
  reuseScouts: boolean;
  /** How a parallel batch shares the repository: one checkout with the file desk (`desk`), or a worktree per worker whose changes are merged back when the batch ends (`worktrees`). */
  parallelMode: ParallelMode;
  /** The QA gate reviews with a clean context: the request, plan, board contracts and diff, not the workers' own accounts of their work. */
  cleanReview: boolean;
  /** Before a task completes, one read-only agent checks the change against the user's original request (not the plan) and names any gap. */
  goalCheck: boolean;
  /** Workers may ask a stronger model for advice on a hard step (`ask_expert`), a couple of times per step. */
  consultExpert: boolean;
  /** The model `ask_expert` consults; empty uses the oracle's. */
  expertModel: string;
}

/** How workers in one parallel batch share the repository. */
export const PARALLEL_MODES = ["desk", "worktrees"] as const;
export type ParallelMode = (typeof PARALLEL_MODES)[number];

export function isParallelMode(value: unknown): value is ParallelMode {
  return typeof value === "string" && (PARALLEL_MODES as readonly string[]).includes(value);
}

/**
 * The lint gate: off; advise (the oracle and QA see what the project's own
 * linter finds in the files the task's agents touched); or block (errors on
 * the lines the task changed also hold completion until they are fixed or
 * the user accepts the work as it is).
 */
export const LINT_MODES = ["off", "advise", "block"] as const;
export type LintMode = (typeof LINT_MODES)[number];

export function isLintMode(value: unknown): value is LintMode {
  return typeof value === "string" && (LINT_MODES as readonly string[]).includes(value);
}

export interface LintConfig {
  mode: LintMode;
  /** A command of your own, run without a shell from the repository's top; `{files}` stands for the touched files (they are appended when it is absent). Empty: the project's own linters are found (ESLint, Biome, Oxlint, Ruff). */
  command: string;
  /** Which touched files the command is given, by extension (`.ts`, `.py`); empty gives it every one. */
  extensions: string[];
  /** Time limit for one linter run. */
  timeoutMs: number;
}

export interface KnowledgeConfig {
  compactionThreshold: number;
  backupCount: number;
  scratchpadMaxParagraphs: number;
  scratchpadMaxChars: number;
}

/** Planning panel seats: each domain agent, plus the researcher, questions the user in plan mode. */
export const PANEL_MEMBERS = ["backend", "designer", "qa", "researcher"] as const;
export type PanelMember = (typeof PANEL_MEMBERS)[number];

export function isPanelMember(value: string): value is PanelMember {
  return (PANEL_MEMBERS as readonly string[]).includes(value);
}

/**
 * Lobby panes that can be shown or hidden: the conversation, the activity log
 * and thinking.
 */
export const LOBBY_PANELS = ["conversation", "activity", "thinking"] as const;
export type LobbyPanel = (typeof LOBBY_PANELS)[number];

/** The loopback web UI: it starts with every interactive session. */
export interface LobbyWebConfig {
  /** Base port (tried, then the next free up to +20); 0 means any free port. */
  port: number;
  /** Open the link in the browser when the session starts. */
  openBrowser: boolean;
}

/** The web lobby. */
export interface LobbyConfig {
  /** Who sits on the planning panel next to the oracle, until toggled in the Plan tab. */
  planningPanel: PanelMember[];
  /** Show the GitHub Issues tab (off for now). */
  issues: boolean;
  /** Bot-lobby is on when pi starts; off (the default), pi starts as plain pi until ctrl+shift+m or /bot-lobby on. */
  startOn: boolean;
  /** Which panes the Lobby tab shows. */
  panels: Record<LobbyPanel, boolean>;
  /** Key overrides by action name, e.g. `{ "search": "alt+f" }`. */
  keys: Record<string, string>;
  /**
   * Planning rounds before the oracle finalizes the plan on its own: the last
   * round skips the seats and asks nothing; later replies only revise. 0 = unlimited.
   */
  maxPlanningRounds: number;
  /**
   * A plan with more steps than this is offered to be split into up to five
   * tasks when it is saved (the oracle proposes, the user decides); 0 = never.
   */
  splitPlanAbove: number;
  /** The loopback web UI (port, browser, where its questions are answered). */
  web: LobbyWebConfig;
}

/** Decisions the classifier can make, each switched on or off on its own. */
export const CLASSIFIER_FEATURES = ["seats", "answers", "files", "triage", "effort", "review", "knowledge", "scripts", "qa"] as const;
export type ClassifierFeature = (typeof CLASSIFIER_FEATURES)[number];

/** Hosts that serve Jev behind the same System One API; `auto` takes OpenCode's free Jev when pi holds an OpenCode key, else TypeSafe. */
export const JEV_HOSTS = ["auto", "opencode", "typesafe", "openrouter", "vercel"] as const;
export type JevHostName = (typeof JEV_HOSTS)[number];

/** Probability and confidence cut-offs, 0 to 1; edited in the config file only. */
export interface ClassifierThresholds {
  /** A planning seat runs when the idea or the latest answers touch its domain at least this likely. */
  seatAt: number;
  /** A seat that was READY comes back only at this probability. */
  reseatReadyAt: number;
  /** An obvious question is answered for you at this probability, when the pick is the recommended option… */
  autoAnswerAt: number;
  /** …and leads the runner-up by at least this much. */
  autoAnswerMargin: number;
  /** A file is a likely file at this relevance. */
  fileRelevantAt: number;
  /** A section of a knowledge file that is over the prompt budget stays in at this relevance. */
  knowledgeRelevantAt: number;
  /** A shared script is suggested for a step at this probability that it does part of it. */
  scriptRelevantAt: number;
  /** A step scored simple at this confidence runs one thinking level lower. */
  simpleAt: number;
  /** A step scored trivial at this confidence runs on the cheaper model. */
  trivialAt: number;
  /** A new request goes to the quick-fix agent when one engineer can do it alone at least this likely (the oracle confirms). */
  quickFixAt: number;
  /** A quick fix scored large at this confidence is held instead of started. */
  quickFixLargeAt: number;
}

/** The classifier: a fast model for obvious decisions, so large models spend fewer tokens on them. */
export interface ClassifierConfig {
  enabled: boolean;
  /**
   * The model that answers, as `provider/id`: any classifier model pi lists
   * (Jev, Cloudflare's clef, Liquid's d1, …) or any chat model you are signed
   * in to (OpenAI, Anthropic, Google, …). Empty calls Jev on `provider`.
   */
  engine: string;
  /** Where Jev is called; the key comes from pi's own key store for that host. */
  provider: JevHostName;
  /** A pinned Jev model; empty uses the host's default. */
  model: string;
  /** A base URL override (a proxy); empty uses the host's. */
  baseUrl: string;
  /** Time limit per classifier call. */
  timeoutMs: number;
  features: Record<ClassifierFeature, boolean>;
  thresholds: ClassifierThresholds;
  fileHints: { topK: number; maxCandidates: number; budgetMs: number };
  /** The cheaper model trivial steps run on; `inherit` keeps the configured model and only lowers thinking. */
  effort: { cheapModel: ModelRef };
  /** Path globs never sent to the classifier (file hints). */
  exclude: string[];
}

export interface BotLobbyConfig {
  master: AgentModelConfig;
  agents: Record<"designer" | "backend" | "qa", AgentModelConfig>;
  scout: ScoutConfig;
  researcher: AgentModelConfig;
  /** Direct quick fixes from the lobby: no scouting, planning or review. */
  quickFix: AgentModelConfig;
  /** The task planner that grills the user until a plan is clear. */
  planner: AgentModelConfig;
  workflow: WorkflowConfig;
  /** The engine lints the files a task's agents touched, after each step, before QA and at completion. */
  lint: LintConfig;
  knowledge: KnowledgeConfig;
  lobby: LobbyConfig;
  classifier: ClassifierConfig;
  /** Third-party harnesses a subagent can run on instead of pi, each with its own settings. */
  harnesses: HarnessesConfig;
}

export const DEFAULT_CONFIG: BotLobbyConfig = {
  master: { model: INHERIT_MODEL, thinking: "high", instructions: "" },
  agents: {
    designer: { model: INHERIT_MODEL, thinking: DEFAULT_THINKING, instructions: "" },
    backend: { model: INHERIT_MODEL, thinking: DEFAULT_THINKING, instructions: "" },
    qa: { model: INHERIT_MODEL, thinking: DEFAULT_THINKING, instructions: "" },
  },
  scout: { model: INHERIT_MODEL, maxToolCalls: 30 },
  researcher: { model: INHERIT_MODEL, thinking: "low", instructions: "" },
  quickFix: { model: INHERIT_MODEL, thinking: "low", instructions: "" },
  planner: { model: INHERIT_MODEL, thinking: "high", instructions: "" },
  workflow: {
    maxReviewIterations: 2,
    maxParallelScouts: 3,
    requireApprovalForFeatures: true,
    requireApprovalForDependencies: true,
    requireApprovalForArchitectureChanges: true,
    maxAgentRetries: 1,
    stallTimeoutMs: 5 * 60 * 1000,
    toolStallTimeoutMs: 10 * 60 * 1000,
    maxParallelWorkers: 3,
    freshContext: true,
    fastTrack: true,
    briefCheck: true,
    routeQuickFixes: true,
    gitIsolation: "off",
    repoMap: true,
    reuseScouts: true,
    parallelMode: "desk",
    cleanReview: true,
    goalCheck: true,
    consultExpert: true,
    expertModel: "",
  },
  lint: { mode: "advise", command: "", extensions: [], timeoutMs: 2 * 60 * 1000 },
  knowledge: {
    compactionThreshold: 20000,
    backupCount: 1,
    scratchpadMaxParagraphs: 4,
    scratchpadMaxChars: 2000,
  },
  lobby: {
    planningPanel: [...PANEL_MEMBERS],
    issues: false,
    startOn: false,
    panels: { conversation: true, activity: true, thinking: true },
    keys: {},
    maxPlanningRounds: 5,
    splitPlanAbove: 8,
    web: { port: 7347, openBrowser: true },
  },
  classifier: {
    enabled: false,
    engine: "",
    provider: "auto",
    model: "",
    baseUrl: "",
    timeoutMs: 4000,
    features: { seats: true, answers: true, files: true, triage: true, effort: true, review: true, knowledge: true, scripts: true, qa: true },
    thresholds: {
      seatAt: 0.35,
      reseatReadyAt: 0.6,
      autoAnswerAt: 0.9,
      autoAnswerMargin: 0.5,
      fileRelevantAt: 0.5,
      knowledgeRelevantAt: 0.4,
      scriptRelevantAt: 0.5,
      simpleAt: 0.7,
      trivialAt: 0.8,
      quickFixAt: 0.7,
      quickFixLargeAt: 0.8,
    },
    fileHints: { topK: 8, maxCandidates: 480, budgetMs: 1500 },
    effort: { cheapModel: INHERIT_MODEL },
    exclude: [],
  },
  harnesses: defaultHarnesses(),
};

/** Choices the settings menu cycles through for the planning round limit; 0 = unlimited. */
export const PLANNING_ROUND_CHOICES = [2, 3, 5, 8, 0] as const;

/** Choices the settings menu cycles through for the step count past which a saved plan is offered a split; 0 = never. */
export const SPLIT_PLAN_CHOICES = [6, 8, 10, 12, 0] as const;

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Skill names as pi writes them (lowercase letters, digits and hyphens); absent when the value is not a list, so the agent keeps every skill. */
export function normalizeSkills(value: unknown): string[] | undefined {
  return Array.isArray(value) ? [...new Set(value.filter((name): name is string => typeof name === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name)))] : undefined;
}

/** `{ skills }` when an entry names its skills, else nothing. */
function skillsField(value: unknown): { skills?: string[] } {
  const skills = normalizeSkills(value);
  return skills ? { skills } : {};
}

export function normalizeMcpTools(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((tool): tool is string => typeof tool === "string" && /^mcp__[A-Za-z0-9_]+__[A-Za-z0-9_]+$/.test(tool)))] : [];
}

/**
 * Merge one agent's override over its default; legacy `inherit` or unknown
 * thinking falls back to the default level. Only subagents may name a
 * harness (`pi` or an unknown one drops the field): the oracle and the
 * planner live in the pi session.
 */
function normalizeAgent(base: AgentModelConfig, override: Partial<AgentModelConfig> | undefined, harness = true): AgentModelConfig {
  const merged = { ...base, ...(override ?? {}) };
  const thinking = isThinkingLevel(merged.thinking) ? merged.thinking : base.thinking;
  const mcpTools = normalizeMcpTools(merged.mcpTools);
  const choice = harness ? harnessChoiceFields(merged) : {};
  return { model: merged.model, thinking, ...(mcpTools.length ? { mcpTools } : {}), ...skillsField(merged.skills), ...(typeof merged.instructions === "string" ? { instructions: merged.instructions } : {}), ...(merged.autoCompact === false ? { autoCompact: false } : {}), ...choice };
}

/** Scouts keep a model and a tool-call cap; any thinking value in the file is dropped. */
function normalizeScout(override: Partial<ScoutConfig> | undefined): ScoutConfig {
  const base = DEFAULT_CONFIG.scout;
  const mcpTools = normalizeMcpTools(override?.mcpTools);
  return {
    model: typeof override?.model === "string" && override.model.trim() ? override.model : base.model,
    maxToolCalls: typeof override?.maxToolCalls === "number" && Number.isFinite(override.maxToolCalls) && override.maxToolCalls >= 0 ? Math.round(override.maxToolCalls) : base.maxToolCalls,
    ...(mcpTools.length ? { mcpTools } : {}),
    ...skillsField(override?.skills),
    ...(override?.autoCompact === false ? { autoCompact: false } : {}),
    ...harnessChoiceFields(override ?? {}),
  };
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeLobby(value: unknown): LobbyConfig {
  const source = value as { planningPanel?: unknown; issues?: unknown; startOn?: unknown; panels?: unknown; keys?: unknown; maxPlanningRounds?: unknown; splitPlanAbove?: unknown; web?: unknown } | undefined;
  const defaults = DEFAULT_CONFIG.lobby;
  const panel = Array.isArray(source?.planningPanel)
    ? [...new Set(source.planningPanel.filter((entry): entry is PanelMember => typeof entry === "string" && isPanelMember(entry)))]
    : [...defaults.planningPanel];
  const panels = (source?.panels ?? {}) as Partial<Record<LobbyPanel, unknown>>;
  const keys = source?.keys && typeof source.keys === "object" ? source.keys as Record<string, unknown> : {};
  return {
    planningPanel: PANEL_MEMBERS.filter((member) => panel.includes(member)),
    issues: flag(source?.issues, defaults.issues),
    startOn: flag(source?.startOn, defaults.startOn),
    panels: Object.fromEntries(LOBBY_PANELS.map((name) => [name, flag(panels[name], defaults.panels[name])])) as Record<LobbyPanel, boolean>,
    keys: Object.fromEntries(Object.entries(keys).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)),
    maxPlanningRounds: roundLimit(source?.maxPlanningRounds, defaults.maxPlanningRounds),
    splitPlanAbove: roundLimit(source?.splitPlanAbove, defaults.splitPlanAbove),
    web: normalizeLobbyWeb(source?.web, defaults.web),
  };
}

/** The loopback web UI's config: 0 or a real port; anything else keeps the default. */
function normalizeLobbyWeb(value: unknown, fallback: LobbyWebConfig): LobbyWebConfig {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const port = source.port === 0 ? 0 : webPort(source.port, fallback.port);
  return { port, openBrowser: flag(source.openBrowser, fallback.openBrowser) };
}

/** A TCP port (0 means any free port); anything else keeps the default. */
function webPort(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

/** A whole number of rounds, 0 for unlimited; anything else keeps the default. */
function roundLimit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function probability(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function count(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/** `.ts`, `TSX` and `*.py` all read as `.ts`, `.tsx`, `.py`. */
function extension(value: string): string {
  const bare = value.trim().replace(/^\*/, "").replace(/^\./, "").toLowerCase();
  return bare ? `.${bare}` : "";
}

function normalizeLint(value: unknown): LintConfig {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const defaults = DEFAULT_CONFIG.lint;
  const extensions = Array.isArray(source.extensions) ? source.extensions.filter((entry): entry is string => typeof entry === "string").map(extension).filter(Boolean) : [...defaults.extensions];
  const timeout = positive(source.timeoutMs);
  return {
    mode: isLintMode(source.mode) ? source.mode : defaults.mode,
    command: text(source.command, defaults.command),
    extensions: [...new Set(extensions)],
    timeoutMs: timeout ? Math.min(30 * 60 * 1000, Math.round(timeout)) : defaults.timeoutMs,
  };
}

function normalizeClassifier(value: unknown): ClassifierConfig {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const defaults = DEFAULT_CONFIG.classifier;
  const features = (source.features ?? {}) as Partial<Record<ClassifierFeature, unknown>>;
  const thresholds = (source.thresholds ?? {}) as Partial<Record<keyof ClassifierThresholds, unknown>>;
  const hints = (source.fileHints ?? {}) as Record<string, unknown>;
  const effort = (source.effort ?? {}) as Record<string, unknown>;
  const provider = typeof source.provider === "string" && (JEV_HOSTS as readonly string[]).includes(source.provider) ? source.provider as JevHostName : defaults.provider;
  return {
    enabled: flag(source.enabled, defaults.enabled),
    engine: text(source.engine, defaults.engine).trim(),
    provider,
    model: text(source.model, defaults.model),
    baseUrl: text(source.baseUrl, defaults.baseUrl),
    timeoutMs: count(source.timeoutMs, defaults.timeoutMs),
    features: Object.fromEntries(CLASSIFIER_FEATURES.map((name) => [name, flag(features[name], defaults.features[name])])) as Record<ClassifierFeature, boolean>,
    thresholds: Object.fromEntries(Object.entries(defaults.thresholds).map(([name, fallback]) => [name, probability(thresholds[name as keyof ClassifierThresholds], fallback)])) as unknown as ClassifierThresholds,
    fileHints: {
      topK: count(hints.topK, defaults.fileHints.topK),
      maxCandidates: count(hints.maxCandidates, defaults.fileHints.maxCandidates),
      budgetMs: count(hints.budgetMs, defaults.fileHints.budgetMs),
    },
    effort: { cheapModel: typeof effort.cheapModel === "string" && effort.cheapModel.trim() ? effort.cheapModel.trim() : defaults.effort.cheapModel },
    exclude: Array.isArray(source.exclude) ? source.exclude.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [...defaults.exclude],
  };
}

/** Deep-merge user config over defaults, keeping unknown keys out. */
export function resolveConfig(partial: unknown): BotLobbyConfig {
  const src = (partial ?? {}) as Record<string, unknown>;
  const workflow = { ...DEFAULT_CONFIG.workflow, ...(src.workflow as Partial<WorkflowConfig> | undefined) };
  workflow.freshContext = workflow.freshContext !== false;
  workflow.fastTrack = workflow.fastTrack !== false;
  workflow.briefCheck = workflow.briefCheck !== false;
  workflow.routeQuickFixes = workflow.routeQuickFixes !== false;
  workflow.repoMap = workflow.repoMap !== false;
  workflow.reuseScouts = workflow.reuseScouts !== false;
  workflow.parallelMode = isParallelMode(workflow.parallelMode) ? workflow.parallelMode : DEFAULT_CONFIG.workflow.parallelMode;
  workflow.cleanReview = workflow.cleanReview !== false;
  workflow.goalCheck = workflow.goalCheck !== false;
  workflow.consultExpert = workflow.consultExpert !== false;
  workflow.expertModel = typeof workflow.expertModel === "string" ? workflow.expertModel.trim() : "";
  workflow.gitIsolation = isGitIsolation(workflow.gitIsolation) ? workflow.gitIsolation : DEFAULT_CONFIG.workflow.gitIsolation;
  // Agent time limits are gone: a config file that still names them is cleaned on its next save.
  for (const key of ["agentTimeoutMs", "wrapUpAt", "taskBudgetMinutes"]) delete (workflow as unknown as Record<string, unknown>)[key];
  const knowledge = { ...DEFAULT_CONFIG.knowledge, ...(src.knowledge as Partial<KnowledgeConfig> | undefined) };
  const srcAgents = (src.agents ?? {}) as Partial<BotLobbyConfig["agents"]>;
  return {
    master: normalizeAgent(DEFAULT_CONFIG.master, src.master as Partial<AgentModelConfig> | undefined, false),
    agents: {
      designer: normalizeAgent(DEFAULT_CONFIG.agents.designer, srcAgents.designer),
      backend: normalizeAgent(DEFAULT_CONFIG.agents.backend, srcAgents.backend),
      qa: normalizeAgent(DEFAULT_CONFIG.agents.qa, srcAgents.qa),
    },
    scout: normalizeScout(src.scout as Partial<ScoutConfig> | undefined),
    researcher: normalizeAgent(DEFAULT_CONFIG.researcher, src.researcher as Partial<AgentModelConfig> | undefined),
    quickFix: normalizeAgent(DEFAULT_CONFIG.quickFix, src.quickFix as Partial<AgentModelConfig> | undefined),
    planner: normalizeAgent(DEFAULT_CONFIG.planner, src.planner as Partial<AgentModelConfig> | undefined, false),
    workflow,
    lint: normalizeLint(src.lint),
    knowledge,
    lobby: normalizeLobby(src.lobby),
    classifier: normalizeClassifier(src.classifier),
    harnesses: normalizeHarnesses(src.harnesses),
  };
}

/** True when a config file still carries a thinking value for scouts, which is ignored. */
export function hasScoutThinking(partial: unknown): boolean {
  const scout = (partial as { scout?: Record<string, unknown> } | undefined)?.scout;
  return Boolean(scout && typeof scout === "object" && "thinking" in scout);
}

/** What one subagent run uses: model (undefined = not configured), thinking and grants. */
export interface AgentProfile {
  kind: WorkflowProfileKind;
  model?: string;
  thinking: string;
  instructions?: string;
  /** Exact native MCP tool names this profile may call; empty grants none. */
  mcpTools?: string[];
  /** Skill names it may load; absent keeps every skill pi finds. */
  skills?: string[];
  /** False when its settings turn auto-compaction off. */
  autoCompact?: boolean;
  /** The third-party harness it runs on; absent runs it on pi. */
  harness?: HarnessRun;
}

/** `{ harness }` when an entry runs on a third-party harness, else nothing. */
function harnessField(config: BotLobbyConfig, entry: HarnessChoice): { harness?: HarnessRun } {
  const harness = harnessRunOf(entry, config.harnesses);
  return harness ? { harness } : {};
}

/** `{ autoCompact: false }` when an entry turns auto-compaction off, else nothing. */
function compactField(entry: { autoCompact?: boolean }): { autoCompact?: false } {
  return entry.autoCompact === false ? { autoCompact: false } : {};
}

/** The MCP tools and skills an entry grants, leaving out what it does not name. */
function grantFields(entry: { mcpTools?: string[]; skills?: string[] }): { mcpTools?: string[]; skills?: string[] } {
  return { ...(entry.mcpTools?.length ? { mcpTools: entry.mcpTools } : {}), ...(entry.skills ? { skills: entry.skills } : {}) };
}

/** The settings entry a domain/role run draws from. */
export function profileKind(domain: Domain, role: Role): WorkflowProfileKind {
  if (role === "scout") return "scout";
  if (role === "researcher") return "researcher";
  return domain;
}

function modelOf(ref: ModelRef): string | undefined {
  return ref === INHERIT_MODEL || !ref.trim() ? undefined : ref;
}

/**
 * Resolve model, thinking and grants for one run from settings alone.
 * Workers and the QA gate use their domain's entry, scouts and researchers
 * their own; custom instructions always come from the domain, so a designer
 * scout still carries the designer's house rules.
 */
export function agentProfile(config: BotLobbyConfig, domain: Domain, role: Role): AgentProfile {
  const kind = profileKind(domain, role);
  const instructions = config.agents[domain].instructions;
  if (kind === "scout") {
    return { kind, model: modelOf(config.scout.model), thinking: SCOUT_THINKING, instructions, ...grantFields(config.scout), ...compactField(config.scout), ...harnessField(config, config.scout) };
  }
  const entry = kind === "researcher" ? config.researcher : config.agents[kind];
  return { kind, model: modelOf(entry.model), thinking: entry.thinking, instructions, ...grantFields(entry), ...compactField(entry), ...harnessField(config, entry) };
}

/** The settings entry of a lobby agent (quick fix or planner). */
export function lobbyAgentConfig(config: BotLobbyConfig, kind: LobbyAgentKind): AgentModelConfig {
  return kind === "quickfix" ? config.quickFix : config.planner;
}

/** Profile for a lobby agent run, from settings alone; `model` is undefined while unset. */
export function lobbyAgentProfile(config: BotLobbyConfig, kind: LobbyAgentKind): { model?: string; thinking: string; instructions?: string; mcpTools?: string[]; skills?: string[]; autoCompact?: boolean; harness?: HarnessRun } {
  const entry = lobbyAgentConfig(config, kind);
  return { model: modelOf(entry.model), thinking: entry.thinking, instructions: entry.instructions, ...grantFields(entry), ...compactField(entry), ...harnessField(config, entry) };
}

/**
 * A planning panel seat's profile: the domain's (or the researcher's) model,
 * thinking, custom instructions and grants.
 */
export function panelMemberProfile(config: BotLobbyConfig, member: PanelMember): { model?: string; thinking: string; instructions?: string; mcpTools?: string[]; skills?: string[]; autoCompact?: boolean; harness?: HarnessRun } {
  const entry = member === "researcher" ? config.researcher : config.agents[member];
  return { model: modelOf(entry.model), thinking: entry.thinking, instructions: entry.instructions, ...grantFields(entry), ...compactField(entry), ...harnessField(config, entry) };
}

/** The model and thinking a worker's `ask_expert` consults: the configured expert, or the oracle's model. */
export function expertProfile(config: BotLobbyConfig): { model?: string; thinking: string } {
  const model = config.workflow.expertModel ? modelOf(config.workflow.expertModel) : modelOf(config.master.model);
  return { ...(model ? { model } : {}), thinking: "high" };
}

/** Resolves the model, thinking and grants one subagent run uses. */
export type ProfileResolver = (domain: Domain, role: Role) => AgentProfile;

/** The resolver a request carries, or plain settings when none was supplied (tests, headless use). */
export function profileFor(config: BotLobbyConfig, resolver: ProfileResolver | undefined, domain: Domain, role: Role): AgentProfile {
  return resolver ? resolver(domain, role) : agentProfile(config, domain, role);
}
