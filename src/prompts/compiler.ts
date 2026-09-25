import type { Domain, Role } from "../schemas/agent.ts";
import { ROLE_SPECS } from "../roles/registry.ts";
import { DOMAIN_SPECS } from "../agents/registry.ts";
import { loadPrompt } from "./loader.ts";

export type PromptDomain = Domain | "master";

export interface CompileInput {
  domain: PromptDomain;
  role?: Role;
  /** Per-agent custom instructions layered on top of the built-in prompts. */
  instructions?: string;
  /** Task context: requirements, objective, approved plan, boundaries. */
  task: string;
  standards?: string;
  knowledge?: string;
  decisions?: string;
  workflowContext?: string;
}

function domainPromptFile(domain: PromptDomain): string {
  return domain === "master" ? "master.md" : DOMAIN_SPECS[domain].promptFile;
}

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
    loadPrompt(domainPromptFile(input.domain)),
    spec ? loadPrompt(spec.promptFile) : "",
    section("Custom Instructions", input.instructions),
    section("Task Context", input.task),
    section("Standards", input.standards),
    section("Knowledge", input.knowledge),
    section("Decisions", input.decisions),
    section("Workflow Context", input.workflowContext),
    spec?.contract ?? "",
  ];
  return layers.filter((layer) => layer.trim().length > 0).join("\n\n---\n\n");
}
