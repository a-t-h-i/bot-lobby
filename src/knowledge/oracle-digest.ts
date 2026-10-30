/**
 * What the oracle learns, shared on its compaction loop. When the oracle's own context is compacted, the checkpoint
 * it writes ends with a "Knowledge to share" section: durable project facts, standards and decisions, each tagged
 * with the agent it belongs to. Those lines go into that agent's knowledge files (through `applyKnowledge`, which
 * drops duplicates), so the oracle keeps its own knowledge current and the domain agents (designer, backend, QA)
 * get what concerns them without the oracle having to remember to write it down.
 */
import { applyKnowledge, type KnowledgeKind } from "./store.ts";
import type { KnowledgeAgent } from "./paths.ts";

export const DIGEST_HEADING = "Knowledge to share";

/** Added to the oracle's compaction instruction. */
export const DIGEST_INSTRUCTION = [
  `Finish with a section headed "## ${DIGEST_HEADING}": the durable things this stretch of work established about the project that an agent will need again, one per line, each as \`- [agent:kind] text\`.`,
  "agent is master (you: how the user works, project-wide facts), designer (UI, UX, design language, frontend), backend (APIs, data, services, infrastructure) or qa (testing, verification, known failures).",
  "kind is knowledge (a fact or a useful pattern), standard (a rule the user wants followed) or decision (a choice the user made, with its reason).",
  "Give the user's own words where they set a rule or a preference. Leave out task progress, guesses, and anything only true for this task. Write `- none` when nothing qualifies. At most 12 lines.",
].join(" ");

const AGENTS: readonly KnowledgeAgent[] = ["master", "designer", "backend", "qa"];
const KINDS: readonly KnowledgeKind[] = ["knowledge", "standard", "decision"];
const MAX_ITEMS = 12;
const MAX_CHARS = 400;

export interface DigestItem {
  agent: KnowledgeAgent;
  kind: KnowledgeKind;
  text: string;
}

/** The tagged lines under the "Knowledge to share" heading; anything malformed is skipped. */
export function parseDigest(summary: string): DigestItem[] {
  const lines = summary.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,4}\s*knowledge to share\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const items: DigestItem[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4}\s/.test(line.trim())) break;
    const match = /^\s*[-*]\s*\[\s*([a-z]+)\s*:\s*([a-z]+)\s*\]\s*(.+?)\s*$/i.exec(line);
    if (!match) continue;
    const agent = match[1]!.toLowerCase() as KnowledgeAgent;
    const kind = match[2]!.toLowerCase() as KnowledgeKind;
    const text = match[3]!.replace(/\s+/g, " ").trim();
    if (!AGENTS.includes(agent) || !KINDS.includes(kind) || !text || text.length > MAX_CHARS) continue;
    items.push({ agent, kind, text });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

/** Write each item into its agent's knowledge; returns how many were new, by agent. */
export function shareDigest(dataRoot: string, items: readonly DigestItem[], now = new Date()): Partial<Record<KnowledgeAgent, number>> {
  const added: Partial<Record<KnowledgeAgent, number>> = {};
  for (const item of items) {
    const text = item.kind === "decision" ? item.text : `- ${item.text}`;
    if (applyKnowledge({ dataRoot, agent: item.agent, kind: item.kind, text, now, by: "Oracle", what: "filed this when it compacted its context", source: "Compaction" }).result === "added") added[item.agent] = (added[item.agent] ?? 0) + 1;
  }
  return added;
}

/** "2 for the designer, 1 for QA" */
export function describeShared(added: Partial<Record<KnowledgeAgent, number>>): string {
  const names: Record<KnowledgeAgent, string> = { master: "the oracle", designer: "the designer", backend: "backend", qa: "QA" };
  return AGENTS.filter((agent) => added[agent]).map((agent) => `${added[agent]} for ${names[agent]}`).join(", ");
}
