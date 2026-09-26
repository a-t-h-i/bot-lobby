import type { Domain, Role } from "./agent.ts";

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
/** Legacy thinking sentinel; configs that still carry it migrate to `DEFAULT_THINKING`. */
export const INHERIT_THINKING = INHERIT;
/** Level used for a missing, legacy `inherit` or unknown thinking value. */
export const DEFAULT_THINKING: ThinkingLevelName = "medium";
/** Scouts are reconnaissance: always fast, never configurable. */
export const SCOUT_THINKING: ThinkingLevelName = "low";

export function isThinkingLevel(value: string): value is ThinkingLevelName {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

export interface AgentModelConfig {
  model: ModelRef;
  thinking: string;
  /** Free-form instructions layered on top of this agent's built-in prompt. */
  instructions?: string;
  /** Time limit per run; falls back to `workflow.agentTimeoutMs`. */
  timeoutMs?: number;
}

/** Scouts pick a model and a time limit only; their thinking is fixed at `SCOUT_THINKING`. */
export interface ScoutConfig {
  model: ModelRef;
  timeoutMs: number;
}

/** Subagent kinds with their own settings entry. */
export const SUBAGENT_KINDS = ["designer", "backend", "qa", "scout", "researcher"] as const;
export type SubagentKind = (typeof SUBAGENT_KINDS)[number];

export interface WorkflowConfig {
  maxReviewIterations: number;
  maxParallelScouts: number;
  requireApprovalForFeatures: boolean;
  requireApprovalForDependencies: boolean;
  requireApprovalForArchitectureChanges: boolean;
  agentTimeoutMs: number;
  /** Bounded retries for transient agent failures (crash/stall), §59. A spent deadline never retries. */
  maxAgentRetries: number;
  /** Kill a subagent after this long without any output; 0 disables. */
  stallTimeoutMs: number;
  /** Silence allowed while a single tool call runs (tests, builds); 0 disables. */
  toolStallTimeoutMs: number;
  /** Fraction of the time limit at which an agent is asked to wrap up and report; 0 disables. */
  wrapUpAt: number;
  /** Workers that may run at once when the Master delegates several domains together. */
  maxParallelWorkers: number;
}

export interface KnowledgeConfig {
  compactionThreshold: number;
  backupCount: number;
  scratchpadMaxParagraphs: number;
  scratchpadMaxChars: number;
}

export interface BotLobbyConfig {
  master: AgentModelConfig;
  agents: Record<"designer" | "backend" | "qa", AgentModelConfig>;
  scout: ScoutConfig;
  researcher: AgentModelConfig;
  workflow: WorkflowConfig;
  knowledge: KnowledgeConfig;
}

export const DEFAULT_CONFIG: BotLobbyConfig = {
  master: { model: INHERIT_MODEL, thinking: "high", instructions: "" },
  agents: {
    designer: { model: INHERIT_MODEL, thinking: DEFAULT_THINKING, instructions: "", timeoutMs: 15 * 60 * 1000 },
    backend: { model: INHERIT_MODEL, thinking: DEFAULT_THINKING, instructions: "", timeoutMs: 15 * 60 * 1000 },
    qa: { model: INHERIT_MODEL, thinking: DEFAULT_THINKING, instructions: "", timeoutMs: 15 * 60 * 1000 },
  },
  scout: { model: INHERIT_MODEL, timeoutMs: 8 * 60 * 1000 },
  researcher: { model: INHERIT_MODEL, thinking: "low", instructions: "", timeoutMs: 10 * 60 * 1000 },
  workflow: {
    maxReviewIterations: 2,
    maxParallelScouts: 3,
    requireApprovalForFeatures: true,
    requireApprovalForDependencies: true,
    requireApprovalForArchitectureChanges: true,
    agentTimeoutMs: 15 * 60 * 1000,
    maxAgentRetries: 1,
    stallTimeoutMs: 5 * 60 * 1000,
    toolStallTimeoutMs: 10 * 60 * 1000,
    wrapUpAt: 0.75,
    maxParallelWorkers: 3,
  },
  knowledge: {
    compactionThreshold: 20000,
    backupCount: 1,
    scratchpadMaxParagraphs: 4,
    scratchpadMaxChars: 2000,
  },
};

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Merge one agent's override over its default; legacy `inherit` or unknown thinking falls back to the default level. */
function normalizeAgent(base: AgentModelConfig, override: Partial<AgentModelConfig> | undefined): AgentModelConfig {
  const merged = { ...base, ...(override ?? {}) };
  const thinking = isThinkingLevel(merged.thinking) ? merged.thinking : base.thinking;
  const timeoutMs = positive(merged.timeoutMs) ?? base.timeoutMs;
  return { ...merged, thinking, ...(timeoutMs ? { timeoutMs } : {}) };
}

/** Scouts keep a model and a time limit; any thinking value in the file is dropped. */
function normalizeScout(override: Partial<ScoutConfig> | undefined): ScoutConfig {
  const base = DEFAULT_CONFIG.scout;
  return {
    model: typeof override?.model === "string" && override.model.trim() ? override.model : base.model,
    timeoutMs: positive(override?.timeoutMs) ?? base.timeoutMs,
  };
}

/** Deep-merge user config over defaults, keeping unknown keys out. */
export function resolveConfig(partial: unknown): BotLobbyConfig {
  const src = (partial ?? {}) as Record<string, unknown>;
  const workflow = { ...DEFAULT_CONFIG.workflow, ...(src.workflow as Partial<WorkflowConfig> | undefined) };
  const knowledge = { ...DEFAULT_CONFIG.knowledge, ...(src.knowledge as Partial<KnowledgeConfig> | undefined) };
  const srcAgents = (src.agents ?? {}) as Partial<BotLobbyConfig["agents"]>;
  return {
    master: normalizeAgent(DEFAULT_CONFIG.master, src.master as Partial<AgentModelConfig> | undefined),
    agents: {
      designer: normalizeAgent(DEFAULT_CONFIG.agents.designer, srcAgents.designer),
      backend: normalizeAgent(DEFAULT_CONFIG.agents.backend, srcAgents.backend),
      qa: normalizeAgent(DEFAULT_CONFIG.agents.qa, srcAgents.qa),
    },
    scout: normalizeScout(src.scout as Partial<ScoutConfig> | undefined),
    researcher: normalizeAgent(DEFAULT_CONFIG.researcher, src.researcher as Partial<AgentModelConfig> | undefined),
    workflow,
    knowledge,
  };
}

/** True when a config file still carries a thinking value for scouts, which is ignored. */
export function hasScoutThinking(partial: unknown): boolean {
  const scout = (partial as { scout?: Record<string, unknown> } | undefined)?.scout;
  return Boolean(scout && typeof scout === "object" && "thinking" in scout);
}

/** What one subagent run uses: model (undefined = not configured), thinking and time limit. */
export interface AgentProfile {
  kind: SubagentKind;
  model?: string;
  thinking: string;
  timeoutMs: number;
  instructions?: string;
}

/** The settings entry a domain/role run draws from. */
export function profileKind(domain: Domain, role: Role): SubagentKind {
  if (role === "scout") return "scout";
  if (role === "researcher") return "researcher";
  return domain;
}

function modelOf(ref: ModelRef): string | undefined {
  return ref === INHERIT_MODEL || !ref.trim() ? undefined : ref;
}

/**
 * Resolve model, thinking and time limit for one run from settings alone.
 * Workers and the QA gate use their domain's entry, scouts and researchers
 * their own; custom instructions always come from the domain, so a designer
 * scout still carries the designer's house rules.
 */
export function agentProfile(config: BotLobbyConfig, domain: Domain, role: Role): AgentProfile {
  const kind = profileKind(domain, role);
  const instructions = config.agents[domain].instructions;
  const fallback = config.workflow.agentTimeoutMs;
  if (kind === "scout") {
    return { kind, model: modelOf(config.scout.model), thinking: SCOUT_THINKING, timeoutMs: config.scout.timeoutMs || fallback, instructions };
  }
  const entry = kind === "researcher" ? config.researcher : config.agents[kind];
  return { kind, model: modelOf(entry.model), thinking: entry.thinking, timeoutMs: entry.timeoutMs ?? fallback, instructions };
}

/** Resolves the model, thinking and time limit one subagent run uses. */
export type ProfileResolver = (domain: Domain, role: Role) => AgentProfile;

/** The resolver a request carries, or plain settings when none was supplied (tests, headless use). */
export function profileFor(config: BotLobbyConfig, resolver: ProfileResolver | undefined, domain: Domain, role: Role): AgentProfile {
  return resolver ? resolver(domain, role) : agentProfile(config, domain, role);
}
