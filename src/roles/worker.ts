import type { AssignmentExpansionRequest, WorkerAssignment } from "../execution/assignment.ts";
import type { Domain, RoleSpec } from "../schemas/agent.ts";
import type { Blocker } from "../schemas/task.ts";
import type { FileChange, KnowledgeProposal, ScriptProposal, WorkerResult } from "../schemas/findings.ts";
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
    "`## Knowledge Proposals` (`- knowledge: ...`, `- standard: ...`, or `- decision: ...`; end a line with `— NN%` for how sure you are, and `(replaces: old text)` when it corrects a saved note).",
    "An optional `## Script Proposals` (`- \\`name.ext\\` — what it does — draft: \\`path\\``) proposes a script you wrote for a job that will come back, for the shared library.",
    "`## Files Changed` entries are `- \\`path\\` — change`.",
    "`## Verification` entries are `- command — result`.",
    "Blocked work uses `**Blocker:**`, `**Tried:**`, `**Need:**` under `## Blockers`.",
    "Never install a dependency or make a significant architectural change yourself; list it under",
    "the matching section instead. Do not narrate. Report only what you actually changed and verified.",
    "An optional `## Pushback` (`**Request:**`, `**Reason:**`, optional `**Alternative:**`) states a change you",
    "believe is wrong, with your reason, instead of doing it; still complete everything else you safely can.",
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

/** Parse `` - `name.ext` — purpose — draft: `path` `` proposals; one without a name is dropped. */
export function parseScriptProposals(domain: Domain, text: string | undefined): ScriptProposal[] {
  return bullets(text).flatMap((entry): ScriptProposal[] => {
    const draftMatch = /\bdraft\s*:\s*`?([^`\s]+)`?/i.exec(entry);
    const rest = (draftMatch ? entry.slice(0, draftMatch.index) : entry).replace(/[\s—–(-]+$/, "");
    const named = /^`?([A-Za-z0-9_.-]+\.[A-Za-z0-9]+)`?\s*(?:[—–:-]+\s*)?(.*)$/.exec(rest.trim());
    if (!named) return [];
    const purpose = named[2]!.replace(/^[—–:-]+\s*/, "").trim();
    return [{ domain, name: named[1]!, purpose, ...(draftMatch ? { draft: draftMatch[1]! } : {}) }];
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

/** A bullet that says there is nothing: `None.`, `N/A`, `No new dependencies (three.js from a CDN)`. */
const NOTHING = /^(?:\*\*|_)?(?:none|n\/?a|nil|nothing|not applicable|no(?:ne)?\s+(?:new\s+|additional\s+|extra\s+)?(?:dependenc|packages?|librar|architecture|architectural|changes?\b))/i;

/** Asks that need the Master's approval: a report that lists "None." asks for nothing. */
export function realAsks(items: readonly string[]): string[] {
  return items.filter((item) => !NOTHING.test(item.trim()));
}

/** Find the end of one JSON container without treating braces in strings as delimiters. */
function jsonEnd(text: string, start: number): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if ((char === "}" || char === "]") && --depth === 0) return i + 1;
  }
  return text.length;
}

/** Notes can contain prose plus standalone JSON objects, optionally fenced. */
function expansionJson(notes: string): string[] {
  const candidates: string[] = [];
  const plain = notes.replace(/```(?:json)?[ \t]*\r?\n([\s\S]*?)(?:```|$)/gi, (_block, body: string) => {
    candidates.push(body.trim());
    return "\n";
  });
  const starts = /(?:^|\n)[ \t]*(?:[-*][ \t]+)?(?=[{[])/g;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(plain))) {
    const start = match.index + match[0].length;
    const end = jsonEnd(plain, start);
    candidates.push(plain.slice(start, end));
    starts.lastIndex = end;
  }
  return candidates;
}

function expansionIssue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "must be an object";
  const need = value as Record<string, unknown>;
  const unknown = Object.keys(need).find((key) => !["kind", "reason", "requested"].includes(key));
  if (unknown) return `unknown key ${unknown}; only kind, reason and requested are allowed`;
  if (typeof need.kind !== "string" || !["files", "tools", "discovery", "decision"].includes(need.kind)) {
    return "kind must be files, tools, discovery or decision";
  }
  if (typeof need.reason !== "string" || !need.reason.trim()) return "reason must be nonempty text";
  if (!Array.isArray(need.requested) || need.requested.length === 0 ||
    need.requested.some((item: unknown) => typeof item !== "string" || !item.trim())) {
    return "requested must be a nonempty array of nonempty strings";
  }
  return undefined;
}

function parseExpansions(notes: string): { needs: AssignmentExpansionRequest[]; issues: string[] } {
  const needs: AssignmentExpansionRequest[] = [];
  const issues: string[] = [];
  for (const [index, candidate] of expansionJson(notes).entries()) {
    try {
      const value: unknown = JSON.parse(candidate);
      const issue = expansionIssue(value);
      if (issue) issues.push(`Notes expansion request ${index + 1}: ${issue}`);
      else needs.push(value as AssignmentExpansionRequest);
    } catch {
      issues.push(`Notes expansion request ${index + 1}: invalid JSON; provide a standalone request object`);
    }
  }
  return { needs, issues };
}

/** Parse a worker's markdown into a structured result (never throws). */
export function parseWorkerResult(domain: Domain, raw: string, now = new Date().toISOString()): WorkerResult {
  const sections = parseSections(raw);
  const notes = findSection(sections, "notes") ?? "";
  const { needs } = parseExpansions(notes);
  return {
    domain,
    role: "worker",
    completed: findSection(sections, "completed") ?? "",
    filesChanged: bullets(findSection(sections, "files changed")).map((entry): FileChange => {
      const file = parseFileBullet(entry);
      return { path: file.path, change: file.reason };
    }),
    verification: findSection(sections, "verification") ?? "",
    notes,
    ...(needs.length > 0 ? { needs } : {}),
    blockers: parseBlockers(sections, domain, now),
    knowledgeProposals: parseKnowledgeProposals(domain, findSection(sections, "knowledge proposals")),
    scriptProposals: parseScriptProposals(domain, findSection(sections, "script proposals")),
    pushback: parsePushback(sections),
    dependencyNeeds: realAsks(bullets(findSection(sections, "dependencies needed"))),
    architectureChanges: realAsks(bullets(findSection(sections, "architecture changes"))),
    raw,
  };
}

/** Assignment-specific content belongs in the user instruction, not the shared system prefix. */
export function assignmentPrompt(assignment: WorkerAssignment): string {
  return [
    "## Validated master assignment",
    JSON.stringify(assignment, null, 2),
    "Actions are numbered and authoritative. Begin with assigned files; paths and purposes are provided, not file bodies.",
    "Read current contents before editing; re-read after file handover. Reference paths are read-only. Only edit/create paths authorize changes.",
    `Discovery allowance: ${assignment.discoveryLimit ?? 2} total targeted lookups. Each nested or batched discovery call counts separately; retries and revisions do not reset consumed allowance. Assigned-file reads and assigned verification are exempt. Shell discovery follows the same limit.`,
    "Discovery never authorizes editing a newly found file. Tools listed here are a replacement selection intersected with existing grants; an empty list grants no tools. Codemode does not grant unselected nested or MCP tools.",
    "If files, tools, discovery allowance or decisions are missing, report each expansion request under Notes as a standalone JSON object (optionally in a json fence), with exactly these keys: {\"kind\":\"files|tools|discovery|decision\",\"reason\":\"why needed\",\"requested\":[\"exact path, tool, allowance or decision\"]}. Continue unaffected work; do not expand permissions yourself.",
    "Report completed work and evidence, outstanding needs, and one Brief Check per verification criterion. Reference-only work may succeed without edits; do not make artificial changes. Every changed file still requires verification.",
  ].join("\n\n");
}

/** Report contract deviations so the Master does not accept unverified work. */
export function validateWorkerResult(result: WorkerResult, assignment?: WorkerAssignment): string[] {
  const issues = parseExpansions(result.notes).issues;
  if (result.needs !== undefined) {
    if (!Array.isArray(result.needs)) issues.push("needs must be an array of expansion requests");
    else result.needs.forEach((need, index) => {
      const issue = expansionIssue(need);
      if (issue) issues.push(`needs[${index}]: ${issue}`);
    });
  }
  if (!result.completed) issues.push("missing Completed section");
  if (result.filesChanged.length > 0 && !result.verification?.trim()) issues.push("changed files without verification");
  const claimedNothing = /no changes|nothing to change|no modifications/i.test(result.raw);
  const referenceOnly = assignment !== undefined && assignment.files.every((file) => file.access === "reference");
  if (assignment) {
    const writable = new Set(assignment.files.filter((file) => file.access !== "reference").map((file) => file.path));
    for (const file of result.filesChanged) {
      if (!writable.has(file.path)) issues.push(`changed file outside assignment edit/create paths: ${file.path}`);
    }
  }
  if (result.filesChanged.length === 0 && result.blockers.length === 0 && !claimedNothing && !referenceOnly) {
    issues.push("no files changed and no blocker reported");
  }
  return issues;
}
