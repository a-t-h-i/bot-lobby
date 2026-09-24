import type { Domain, Role } from "../schemas/agent.ts";
import { ROLE_SPECS } from "../roles/registry.ts";
import { loadPrompt } from "./loader.ts";

export type PromptDomain = Domain | "master";

export interface CompileInput {
  domain: PromptDomain;
  role?: Role;
  /** Task context: requirements, objective, approved plan, boundaries. */
  task: string;
  standards?: string;
  knowledge?: string;
  decisions?: string;
  workflowContext?: string;
}

const DOMAIN_PROMPT_FILES: Record<PromptDomain, string> = {
  master: "master.md",
  designer: "designer.md",
  backend: "backend.md",
  qa: "qa.md",
};

function section(title: string, body?: string): string {
  const text = body?.trim();
  return text ? `## ${title}\n\n${text}` : "";
}

/**
 * Compose the layered prompt: global + domain + role + task context +
 * standards + knowledge + decisions + workflow context + output contract.
 * Empty layers are dropped so agents never receive empty headings.
 */
export function compilePrompt(input: CompileInput): string {
  const spec = input.role ? ROLE_SPECS[input.role] : undefined;
  const layers = [
    loadPrompt("global.md"),
    loadPrompt(DOMAIN_PROMPT_FILES[input.domain]),
    spec ? loadPrompt(spec.promptFile) : "",
    section("Task Context", input.task),
    section("Standards", input.standards),
    section("Knowledge", input.knowledge),
    section("Decisions", input.decisions),
    section("Workflow Context", input.workflowContext),
    spec?.contract ?? "",
  ];
  return layers.filter((layer) => layer.trim().length > 0).join("\n\n---\n\n");
}
