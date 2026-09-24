import type { Domain, RoleSpec } from "../schemas/agent.ts";
import type { Blocker } from "../schemas/task.ts";
import type { FileChange, WorkerResult } from "../schemas/findings.ts";
import { bullets, findSection, parseFileBullet, parseSections } from "./markdown.ts";

/** Worker has no tool allowlist: it needs the full set to implement. */
export const workerSpec: RoleSpec = {
  role: "worker",
  promptFile: "worker.md",
  contract: [
    "### Output contract",
    "Respond with exactly these sections and nothing else: `## Completed`, `## Files Changed`,",
    "`## Verification`, `## Notes`, `## Blockers`, `## Dependencies Needed`, `## Architecture Changes`.",
    "`## Files Changed` entries are `- \\`path\\` — change`.",
    "`## Verification` entries are `- command — result`.",
    "Blocked work uses `**Blocker:**`, `**Tried:**`, `**Need:**` under `## Blockers`.",
    "Never install a dependency or make a significant architectural change yourself; list it under",
    "the matching section instead. Do not narrate. Report only what you actually changed and verified.",
  ].join(" "),
};

function fieldValue(body: string, name: string): string | undefined {
  const match = new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`, "i").exec(body);
  return match?.[1]?.trim();
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

/** Parse a worker's markdown into a structured result (never throws). */
export function parseWorkerResult(domain: Domain, raw: string, now = new Date().toISOString()): WorkerResult {
  const sections = parseSections(raw);
  return {
    domain,
    role: "worker",
    completed: findSection(sections, "completed") ?? "",
    filesChanged: bullets(findSection(sections, "files changed")).map((entry): FileChange => {
      const file = parseFileBullet(entry);
      return { path: file.path, change: file.reason };
    }),
    verification: findSection(sections, "verification") ?? "",
    notes: findSection(sections, "notes") ?? "",
    blockers: parseBlockers(sections, domain, now),
    knowledgeProposals: [],
    dependencyNeeds: bullets(findSection(sections, "dependencies needed")),
    architectureChanges: bullets(findSection(sections, "architecture changes")),
    raw,
  };
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
