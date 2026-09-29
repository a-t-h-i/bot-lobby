import type { Domain, RoleSpec } from "../schemas/agent.ts";
import type { Blocker } from "../schemas/task.ts";
import type { FileChange, KnowledgeProposal, WorkerResult } from "../schemas/findings.ts";
import { bullets, fieldValue, findSection, parseFileBullet, parsePushback, parseSections } from "./markdown.ts";

/**
 * Workers implement, so they get the full built-in set, including the fast
 * search tools; the file desk adds its own tools when workers run in parallel.
 */
export const WORKER_TOOLS: readonly string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export const workerSpec: RoleSpec = {
  role: "worker",
  promptFile: "worker.md",
  tools: WORKER_TOOLS,
  contract: [
    "### Output contract",
    "Respond with exactly these sections and nothing else: `## Completed`, `## Files Changed`,",
    "`## Verification`, `## Brief Check` (one `- criterion — met|not met — evidence` line per \"Done when\" item of your brief), `## Notes`, `## Blockers`, `## Dependencies Needed`, `## Architecture Changes`,",
    "`## Knowledge Proposals` (`- knowledge: ...`, `- standard: ...`, or `- decision: ...`).",
    "`## Files Changed` entries are `- \\`path\\` — change`.",
    "`## Verification` entries are `- command — result`.",
    "Blocked work uses `**Blocker:**`, `**Tried:**`, `**Need:**` under `## Blockers`.",
    "Never install a dependency or make a significant architectural change yourself; list it under",
    "the matching section instead. Do not narrate. Report only what you actually changed and verified.",
    "An optional `## Pushback` (`**Request:**`, `**Reason:**`, optional `**Alternative:**`) states a change you",
    "believe is wrong, with your reason, instead of doing it; still complete everything else you safely can.",
    "Stopped because your time is up, also add `## Left Off` (what you were doing, what is still to do) and",
    "`## More Time` (`N minutes — why`).",
  ].join(" "),
};

/** Parse `- kind: text` proposals; unknown kinds fall back to plain knowledge. */
export function parseKnowledgeProposals(domain: Domain, text: string | undefined): KnowledgeProposal[] {
  return bullets(text).map((entry) => {
    const match = /^(knowledge|standard|decision|completed)\s*:\s*(.+)$/i.exec(entry);
    const kind = (match?.[1]?.toLowerCase() ?? "knowledge") as KnowledgeProposal["kind"];
    return { domain, kind, content: (match?.[2] ?? entry).trim() };
  });
}

function splitList(text: string | undefined): string[] {
  return (text ?? "")
    .split(/[;\n]|\s+then\s+/)
    .map((entry) => entry.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((entry) => entry.length > 0);
}

/** Parse the worker's `**Blocker:**`/`**Tried:**`/`**Need:**` block, if present. */
export function parseBlockers(
  sections: Map<string, string>,
  domain: Domain,
  now = new Date().toISOString(),
): Blocker[] {
  const body = findSection(sections, "blockers");
  if (!body) return [];
  const reason = fieldValue(body, "Blocker");
  if (!reason) return [];
  return [
    {
      domain,
      reason,
      tried: splitList(fieldValue(body, "Tried")),
      need: fieldValue(body, "Need") ?? "",
      createdAt: now,
    },
  ];
}

/** `## More Time` as the minutes asked for (`15 minutes`, `1h`, `20m`) and the reason given. */
export function parseMoreTime(text: string): { minutes?: number; reason: string } {
  const flat = text.replace(/^[-*]\s*/gm, "").replace(/\s+/g, " ").trim();
  const match = /(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/i.exec(flat);
  const minutes = match ? Math.round(Number(match[1]) * (/^h/i.test(match[2]!) ? 60 : 1)) : undefined;
  const reason = match ? flat.slice(match.index + match[0].length).replace(/^\s*(?:—|–|-|:|,|because|to)?\s*/i, "").trim() : flat;
  return { ...(minutes && minutes > 0 ? { minutes } : {}), reason: reason || flat };
}

/** A bullet that says there is nothing: `None.`, `N/A`, `No new dependencies (three.js from a CDN)`. */
const NOTHING = /^(?:\*\*|_)?(?:none|n\/?a|nil|nothing|not applicable|no(?:ne)?\s+(?:new\s+|additional\s+|extra\s+)?(?:dependenc|packages?|librar|architecture|architectural|changes?\b))/i;

/** Asks that need the Master's approval: a report that lists "None." asks for nothing. */
export function realAsks(items: readonly string[]): string[] {
  return items.filter((item) => !NOTHING.test(item.trim()));
}

/** Parse a worker's markdown into a structured result (never throws). */
export function parseWorkerResult(domain: Domain, raw: string, now = new Date().toISOString()): WorkerResult {
  const sections = parseSections(raw);
  return {
    domain,
    role: "worker",
    completed: findSection(sections, "completed") ?? "",
    ...leftOffFields(sections),
    filesChanged: bullets(findSection(sections, "files changed")).map((entry): FileChange => {
      const file = parseFileBullet(entry);
      return { path: file.path, change: file.reason };
    }),
    verification: findSection(sections, "verification") ?? "",
    notes: findSection(sections, "notes") ?? "",
    blockers: parseBlockers(sections, domain, now),
    knowledgeProposals: parseKnowledgeProposals(domain, findSection(sections, "knowledge proposals")),
    pushback: parsePushback(sections),
    dependencyNeeds: realAsks(bullets(findSection(sections, "dependencies needed"))),
    architectureChanges: realAsks(bullets(findSection(sections, "architecture changes"))),
    raw,
  };
}

function leftOffFields(sections: Map<string, string>): Pick<WorkerResult, "leftOff" | "moreTime"> {
  const leftOff = findSection(sections, "left off")?.trim();
  const more = findSection(sections, "more time")?.trim();
  return { ...(leftOff ? { leftOff } : {}), ...(more ? { moreTime: parseMoreTime(more) } : {}) };
}

/** Report contract deviations so the Master does not accept unverified work. */
export function validateWorkerResult(result: WorkerResult): string[] {
  const issues: string[] = [];
  if (!result.completed) issues.push("missing Completed section");
  if (result.filesChanged.length > 0 && !result.verification) issues.push("changed files without verification");
  const claimedNothing = /no changes|nothing to change|no modifications/i.test(result.raw);
  if (result.filesChanged.length === 0 && result.blockers.length === 0 && !claimedNothing) {
    issues.push("no files changed and no blocker reported");
  }
  return issues;
}
