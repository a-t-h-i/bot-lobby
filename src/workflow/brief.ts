/**
 * A cheap check that a delegation is a brief a small model can act on: it
 * points at something concrete, and a longer one says when it is done. It only
 * ever asks the master to add detail once: repeating the same instruction
 * unchanged is accepted, so a short task that really is complete never gets
 * stuck behind it. Pure apart from that one-entry-per-step memory.
 */

/** Longest instruction that only has to point at something concrete. */
export const SHORT_BRIEF_CHARS = 200;

/** A path, a file name with an extension, a `code` span, a quoted string or a "Files" label. */
const ANCHOR = /(?:[\w.-]+\/[\w./-]+)|(?:\b[\w-]+\.[a-z]{1,5}\b)|`[^`\n]+`|"[^"\n]{2,}"|\*\*files?\*\*|\bfiles?:/i;
/** An identifier in camelCase, PascalCase or snake_case (case matters, so it is kept apart). */
const IDENTIFIER = /\b[a-z]+[A-Z]\w*\b|\b[A-Z][a-z]+[A-Z]\w*\b|\b[a-z]+_[a-z_]+\b/;
/** Wording that states when the step is finished or how it is checked. */
const CRITERIA = /done when|definition of done|acceptance|success criteri|verif|must (?:pass|print|return|show|exist|render|display|work)|should (?:pass|print|return|show|exist|render|display|work)|expect|check that|ensure/i;

/** What a delegation is missing, one sentence each; empty when it is fine. */
export function briefProblems(instruction: string): string[] {
  const text = instruction.replace(/\s+/g, " ").trim();
  const problems: string[] = [];
  if (!ANCHOR.test(text) && !IDENTIFIER.test(text)) problems.push("it names no file, path, function, identifier or exact string, so the agent must guess where and what to change");
  if (text.length > SHORT_BRIEF_CHARS && !CRITERIA.test(text)) problems.push("it has no \"Done when\" criteria (observable checks, or commands and what they should show), so the agent cannot tell when it has finished");
  return problems;
}

const lastRejected = new Map<string, string>();

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The error to answer a delegation with, or undefined to let it through. The
 * first time a step's brief falls short it is sent back; sending the same
 * text again means the master has judged it complete.
 */
export function briefRejection(taskId: string, domain: string, instruction: string): string | undefined {
  const key = `${taskId}:${domain}`;
  const problems = briefProblems(instruction);
  if (problems.length === 0) {
    lastRejected.delete(key);
    return undefined;
  }
  if (lastRejected.get(key) === normalize(instruction)) {
    lastRejected.delete(key);
    return undefined;
  }
  lastRejected.set(key, normalize(instruction));
  return [
    `The ${domain} brief was not sent: ${problems.join("; ")}.`,
    "The agent may be a smaller, literal model that assumes nothing. Rewrite the brief as: Goal, Files, numbered What to do (exact names, shapes, values), Contracts, Constraints, Done when, If stuck.",
    "If it really is complete as written, send the same instruction again and it goes through.",
  ].join(" ");
}

/** Forget what was rejected (tests). */
export function resetBriefs(): void {
  lastRejected.clear();
}
