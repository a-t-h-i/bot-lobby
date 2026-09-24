import { join } from "node:path";
import type { Domain } from "../schemas/agent.ts";

export type KnowledgeAgent = Domain | "master";

/** Title-cased directory names per the build plan §21. */
export const AGENT_DIR_NAMES: Record<KnowledgeAgent, string> = {
  master: "Master",
  designer: "Designer",
  backend: "Backend",
  qa: "QA",
};

export const KNOWLEDGE_FILES: Record<KnowledgeAgent, readonly string[]> = {
  master: ["knowledge.md", "standards.md", "decisions.md", "completed-tasks.md"],
  designer: ["knowledge.md", "design-language.md", "decisions.md", "completed-tasks.md"],
  backend: ["knowledge.md", "engineering-standards.md", "decisions.md", "completed-tasks.md"],
  qa: ["knowledge.md", "testing-standards.md", "decisions.md", "completed-tasks.md"],
};

export function knowledgeDir(dataRoot: string, agent: KnowledgeAgent): string {
  return join(dataRoot, AGENT_DIR_NAMES[agent], "knowledge");
}

export function tasksRoot(dataRoot: string): string {
  return join(dataRoot, "tasks");
}

export function taskDir(dataRoot: string, taskId: string): string {
  return join(tasksRoot(dataRoot), taskId);
}

export function scratchpadPath(taskDir: string, domain: Domain): string {
  return join(taskDir, `${domain}.md`);
}
