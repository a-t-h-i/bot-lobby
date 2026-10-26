/**
 * Draft worker assignments read off a plan, so the oracle starts from the
 * files and steps the plan already names instead of deriving them again. A
 * draft carries what the plan says for certain (the step, its objective, the
 * project files it names, whether each exists) and leaves the rest to the
 * oracle: the domain when the step does not say, the tools, contracts and
 * verification. Consecutive small steps of one domain (a file each, at most)
 * are folded into one draft, so they go out as one worker run.
 *
 * Drafts are hints for the oracle's `workerAssignment`, never dispatched as they are.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Domain } from "../schemas/agent.ts";
import type { AssignmentFile } from "../execution/assignment.ts";
import { planStepBlocks, planSteps } from "../pi/plan-checklist.ts";

export interface DraftAssignment {
  /** 1-based plan steps the draft covers: one, or a run of small steps folded together. */
  steps: number[];
  id: string;
  domain?: Domain;
  objective: string;
  actions: { step: number; instruction: string }[];
  files: AssignmentFile[];
}

/** Path-like tokens: `src/a.ts`, `webui/src/App.tsx:42`, `docs/plan.md#x`. */
const PATH = /(?:^|[\s`'"(\[])((?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][\w]{0,7})(?::\d+(?:-\d+)?)?(?=$|[\s`'",;:)\]#])/g;
const CREATE_WORDS = /\b(create|add(?:s|ing)? (?:a |an )?new|new file|scaffold|introduce)\b/i;
const DOMAIN_WORDS: [Domain, RegExp][] = [
  ["designer", /\b(designer|design|ui|frontend|front-end|webui|css|styles?)\b/i],
  ["qa", /\b(qa|tests?|testing|spec|coverage)\b/i],
  ["backend", /\b(backend|back-end|dev|engine|server|api|runtime)\b/i],
];
/** At most this many files for a step to count as small enough to fold. */
const SMALL_STEP_FILES = 1;
const MAX_FOLD = 4;

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

/** The project files a step names: existing ones to edit, absent ones it creates under an existing folder. */
export function stepFiles(text: string, cwd: string): AssignmentFile[] {
  const root = resolve(cwd);
  const creates = CREATE_WORDS.test(text);
  const seen = new Set<string>();
  const files: AssignmentFile[] = [];
  for (const match of text.matchAll(PATH)) {
    const raw = match[1]!;
    if (/^\d|^https?:|^www\./i.test(raw)) continue;
    const full = resolve(root, raw);
    if (!inside(root, full)) continue;
    const path = relative(root, full).split(sep).join("/");
    if (seen.has(path)) continue;
    const exists = existsSync(full);
    if (exists && !statSync(full).isFile()) continue;
    if (!exists && !(creates && existsSync(dirname(full)))) continue;
    seen.add(path);
    files.push({ path, access: exists ? "edit" : "create", purpose: exists ? "Named in the plan's step; change it, or mark it reference if it is only read" : "The plan's step creates it" });
  }
  return files;
}

/** The domain a step's own words name, when exactly one does. */
export function stepDomain(text: string): Domain | undefined {
  const tag = /\[(DEV|DESIGN|QA|BACKEND|DESIGNER)\]|\((backend|designer|qa)\)|^\s*(?:[-*\d.)\s]*)(backend|designer|qa)\s*[:—-]/im.exec(text);
  const named = (tag?.[1] ?? tag?.[2] ?? tag?.[3])?.toLowerCase();
  if (named) return named === "dev" ? "backend" : named === "design" ? "designer" : (named as Domain);
  const hits = DOMAIN_WORDS.filter(([, words]) => words.test(text)).map(([domain]) => domain);
  return hits.length === 1 ? hits[0] : undefined;
}

function clean(text: string): string {
  return text.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim();
}

/** Drafts for every step of `plan`, small consecutive same-domain steps folded together. */
export function draftAssignments(plan: string, cwd: string): DraftAssignment[] {
  const blocks = planStepBlocks(plan)?.blocks;
  const steps = blocks && blocks.length > 0 ? blocks : planSteps(plan);
  const singles = steps.map((text, index) => ({ step: index + 1, text: clean(text), files: stepFiles(text, cwd), domain: stepDomain(text) }));
  const drafts: DraftAssignment[] = [];
  for (const single of singles) {
    const last = drafts.at(-1);
    const small = single.files.length <= SMALL_STEP_FILES;
    const lastSmall = last && last.steps.length < MAX_FOLD && last.files.length <= last.steps.length * SMALL_STEP_FILES
      && last.steps.every((step) => (singles[step - 1]?.files.length ?? 0) <= SMALL_STEP_FILES);
    if (last && small && lastSmall && single.domain && last.domain === single.domain && last.steps.at(-1) === single.step - 1) {
      last.steps.push(single.step);
      last.id = `steps-${last.steps[0]}-${single.step}`;
      last.objective = `Steps ${last.steps[0]}-${single.step}: ${last.actions.map((action) => action.instruction).concat(single.text).join("; ")}`;
      last.actions.push({ step: last.actions.length + 1, instruction: single.text });
      for (const file of single.files) if (!last.files.some((entry) => entry.path === file.path)) last.files.push(file);
      continue;
    }
    drafts.push({
      steps: [single.step], id: `step-${single.step}`, ...(single.domain ? { domain: single.domain } : {}),
      objective: `Step ${single.step}: ${single.text}`, actions: [{ step: 1, instruction: single.text }], files: single.files,
    });
  }
  return drafts;
}

/** The drafts as the oracle reads them: one compact line each, JSON for the files. */
export function draftAssignmentsNote(drafts: readonly DraftAssignment[]): string {
  if (drafts.length === 0) return "";
  const lines = drafts.map((draft) => {
    const label = draft.steps.length > 1 ? `Steps ${draft.steps[0]}-${draft.steps.at(-1)}` : `Step ${draft.steps[0]}`;
    return `- ${label} → id "${draft.id}"${draft.domain ? `, domain ${draft.domain}` : ""}; files ${JSON.stringify(draft.files.map(({ path, access }) => ({ path, access })))}${draft.steps.length > 1 ? " (small steps folded into one worker run)" : ""}`;
  });
  return [
    "Draft assignments from the plan (the engine read the step texts and checked each named file exists). Start each workerAssignment from its draft: keep the id and files, mark files only read as reference, and add the tools, contracts and verification yourself. Steps without files need their files found first.",
    ...lines,
  ].join("\n");
}
