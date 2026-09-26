export type ModelRef = "inherit" | string;

/** Thinking levels accepted by the pi CLI (`--thinking`). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

/** Value meaning "use the model/thinking of the current session". */
const INHERIT = "inherit";
export const INHERIT_MODEL = INHERIT;
export const INHERIT_THINKING = INHERIT;

export function isThinkingLevel(value: string): value is ThinkingLevelName {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

export interface AgentModelConfig {
  model: ModelRef;
  thinking: string;
  /** Free-form instructions layered on top of this agent's built-in prompt. */
  instructions?: string;
}

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
  workflow: WorkflowConfig;
  knowledge: KnowledgeConfig;
}

export const DEFAULT_CONFIG: BotLobbyConfig = {
  master: { model: INHERIT_MODEL, thinking: "high", instructions: "" },
  agents: {
    designer: { model: INHERIT_MODEL, thinking: INHERIT_THINKING, instructions: "" },
    backend: { model: INHERIT_MODEL, thinking: INHERIT_THINKING, instructions: "" },
    qa: { model: INHERIT_MODEL, thinking: INHERIT_THINKING, instructions: "" },
  },
  workflow: {
    maxReviewIterations: 2,
    maxParallelScouts: 3,
    requireApprovalForFeatures: true,
    requireApprovalForDependencies: true,
    requireApprovalForArchitectureChanges: true,
    agentTimeoutMs: 15 * 60 * 1000,
    maxAgentRetries: 1,
    stallTimeoutMs: 3 * 60 * 1000,
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

/** Merge one agent's override over its default, dropping an invalid thinking level but keeping the inherit sentinel. */
function normalizeAgent(base: AgentModelConfig, override: Partial<AgentModelConfig> | undefined): AgentModelConfig {
  const merged = { ...base, ...(override ?? {}) };
  const thinking = merged.thinking === INHERIT_THINKING || isThinkingLevel(merged.thinking) ? merged.thinking : base.thinking;
  return { ...merged, thinking };
}

/** Replace every agent's inherit thinking with the live session level; a missing/invalid level omits the flag. */
export function inheritThinking(config: BotLobbyConfig, level: string | undefined): BotLobbyConfig {
  const resolved = level && isThinkingLevel(level) ? level : "";
  const agents = Object.fromEntries(
    Object.entries(config.agents).map(([name, agent]) => [
      name,
      agent.thinking === INHERIT_THINKING ? { ...agent, thinking: resolved } : { ...agent },
    ]),
  ) as BotLobbyConfig["agents"];
  return { ...config, agents };
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
    workflow,
    knowledge,
  };
}
