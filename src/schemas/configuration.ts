export type ModelRef = "inherit" | string;

/** Thinking levels accepted by the pi CLI (`--thinking`). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

/** Value meaning "use the model/thinking of the current session". */
export const INHERIT_MODEL = "inherit";

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
  /** Bounded retries for transient agent failures (crash/timeout), §59. */
  maxAgentRetries: number;
}

export interface KnowledgeConfig {
  compactionThreshold: number;
  backupCount: number;
  scratchpadMaxParagraphs: number;
  scratchpadMaxChars: number;
}

export interface DevHouseConfig {
  master: AgentModelConfig;
  agents: Record<"designer" | "backend" | "qa", AgentModelConfig>;
  workflow: WorkflowConfig;
  knowledge: KnowledgeConfig;
}

export const DEFAULT_CONFIG: DevHouseConfig = {
  master: { model: INHERIT_MODEL, thinking: "high", instructions: "" },
  agents: {
    designer: { model: INHERIT_MODEL, thinking: "medium", instructions: "" },
    backend: { model: INHERIT_MODEL, thinking: "medium", instructions: "" },
    qa: { model: INHERIT_MODEL, thinking: "high", instructions: "" },
  },
  workflow: {
    maxReviewIterations: 2,
    maxParallelScouts: 3,
    requireApprovalForFeatures: true,
    requireApprovalForDependencies: true,
    requireApprovalForArchitectureChanges: true,
    agentTimeoutMs: 15 * 60 * 1000,
    maxAgentRetries: 1,
  },
  knowledge: {
    compactionThreshold: 20000,
    backupCount: 1,
    scratchpadMaxParagraphs: 4,
    scratchpadMaxChars: 2000,
  },
};

/** Merge one agent's override over its default, dropping an invalid thinking level. */
function normalizeAgent(base: AgentModelConfig, override: Partial<AgentModelConfig> | undefined): AgentModelConfig {
  const merged = { ...base, ...(override ?? {}) };
  return { ...merged, thinking: isThinkingLevel(merged.thinking) ? merged.thinking : base.thinking };
}

/** Deep-merge user config over defaults, keeping unknown keys out. */
export function resolveConfig(partial: unknown): DevHouseConfig {
  const src = (partial ?? {}) as Record<string, unknown>;
  const workflow = { ...DEFAULT_CONFIG.workflow, ...(src.workflow as Partial<WorkflowConfig> | undefined) };
  const knowledge = { ...DEFAULT_CONFIG.knowledge, ...(src.knowledge as Partial<KnowledgeConfig> | undefined) };
  const srcAgents = (src.agents ?? {}) as Partial<DevHouseConfig["agents"]>;
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
