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
  /** Assignment bookmarks: bounded reference metadata pointing into the knowledge catalogue. */
  bookmarks?: string;
  /** The shared scripts that fit the step, or the library for the oracle. */
  scripts?: string;
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
 * The invariant layers for a domain/role: global + domain + role prompt and the
 * role's output contract. Determined by domain and role alone, so identical
 * configuration yields a byte-identical prefix ahead of task-selected context.
 */
export function invariantPrefix(domain: PromptDomain, role?: Role): string {
  const spec = role ? ROLE_SPECS[role] : undefined;
  const layers = [
    loadPrompt("global.md"),
    loadPrompt(domainPromptFile(domain)),
    spec ? loadPrompt(spec.promptFile) : "",
    spec?.contract ?? "",
  ];
  return layers.filter((layer) => layer.trim().length > 0).join("\n\n---\n\n");
}

/**
 * Compose the layered prompt: invariant prefix (global + domain + role + output
 * contract) + custom instructions + task context + standards + knowledge +
 * decisions + scripts + workflow context. Empty layers are dropped so agents
 * never receive empty headings. Custom instructions keep their precedence over
 * the role layers, including the contract.
 */
export function compilePrompt(input: CompileInput): string {
  const layers = [
    invariantPrefix(input.domain, input.role),
    section("Custom Instructions", input.instructions),
    section("Task Context", input.task),
    section("Standards", input.standards),
    section("Knowledge", input.knowledge),
    section("Decisions", input.decisions),
    section("Bookmarks", input.bookmarks),
    section("Scripts", input.scripts),
    section("Workflow Context", input.workflowContext),
  ];
  return layers.filter((layer) => layer.trim().length > 0).join("\n\n---\n\n");
}
