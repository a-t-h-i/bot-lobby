export type ModelRef = "inherit" | string;

export interface AgentModelConfig {
  model: ModelRef;
  thinking: string;
}

export interface WorkflowConfig {
  maxReviewIterations: number;
  maxParallelScouts: number;
  requireApprovalForFeatures: boolean;
  requireApprovalForDependencies: boolean;
  requireApprovalForArchitectureChanges: boolean;
  agentTimeoutMs: number;
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
  master: { model: "inherit", thinking: "high" },
  agents: {
    designer: { model: "inherit", thinking: "medium" },
    backend: { model: "inherit", thinking: "medium" },
    qa: { model: "inherit", thinking: "high" },
  },
  workflow: {
    maxReviewIterations: 2,
    maxParallelScouts: 3,
    requireApprovalForFeatures: true,
    requireApprovalForDependencies: true,
    requireApprovalForArchitectureChanges: true,
    agentTimeoutMs: 15 * 60 * 1000,
  },
  knowledge: {
    compactionThreshold: 20000,
    backupCount: 1,
    scratchpadMaxParagraphs: 4,
    scratchpadMaxChars: 2000,
  },
};

/** Deep-merge user config over defaults, keeping unknown keys out. */
export function resolveConfig(partial: unknown): DevHouseConfig {
  const src = (partial ?? {}) as Record<string, unknown>;
  const workflow = { ...DEFAULT_CONFIG.workflow, ...(src.workflow as Partial<WorkflowConfig> | undefined) };
  const knowledge = { ...DEFAULT_CONFIG.knowledge, ...(src.knowledge as Partial<KnowledgeConfig> | undefined) };
  const agents = {
    ...DEFAULT_CONFIG.agents,
    ...(src.agents as Partial<DevHouseConfig["agents"]> | undefined),
  };
  const master = { ...DEFAULT_CONFIG.master, ...(src.master as Partial<AgentModelConfig> | undefined) };
  return { master, agents, workflow, knowledge };
}
