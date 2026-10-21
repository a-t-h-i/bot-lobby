/**
 * The goal check: before a task is called done, one read-only agent with a
 * clean context compares the change with what the user actually asked for
 * (the request and its amendments, not the plan) and names any requirement
 * the change does not meet. Plans drift and agents can finish every step and
 * still miss the point; this catches it at the one moment it is cheap to fix.
 */
import type { AgentRun } from "../schemas/findings.ts";
import type { BotLobbyConfig, ProfileResolver } from "../schemas/configuration.ts";
import { profileFor } from "../schemas/configuration.ts";
import { runAgent, watchdogOptions } from "../execution/agent-runner.ts";
import { spawnPiProcess, type ProcessRunner } from "../execution/pi-runner.ts";
import { loadPrompt } from "../prompts/loader.ts";
import { truncate } from "../text.ts";

export type GoalVerdict = "met" | "not_met" | "unread";

export interface GoalCheckResult {
  verdict: GoalVerdict;
  /** Requirements the change does not meet, one line each. */
  gaps: string[];
  run: AgentRun;
}

export interface GoalCheckRequest {
  taskId: string;
  /** The user's request as they wrote it. */
  request: string;
  amendments: readonly string[];
  diff: string;
  cwd: string;
  config: BotLobbyConfig;
  profile?: ProfileResolver;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
}

/** Most of the change it reads; a longer diff is cut, and the check reads the files it needs. */
export const GOAL_DIFF_CHARS = 60_000;

function section(text: string, title: string): string {
  const match = new RegExp(`^#{1,3}\\s+${title}\\s*:?\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|(?![\\s\\S]))`, "im").exec(text);
  return match?.[1]?.trim() ?? "";
}

/** The verdict as written: on the heading line (`## Verdict: MET`, `**Verdict:** MET`) or the first line under it. */
function verdictLine(text: string): string {
  const inline = /^\s*(?:#{1,3}\s*)?\**verdict\**\s*:\**\s*(\S.*)$/im.exec(text);
  if (inline?.[1]) return inline[1];
  return section(text, "Verdict").split("\n").find((line) => line.trim()) ?? "";
}

/** Words that make a verdict anything but a plain MET. */
const QUALIFIED = /\b(NOT|UNMET|PARTIAL(LY)?|MOSTLY|LARGELY|EXCEPT|BUT|SOME|INCOMPLETE|FAIL(ED|S)?)\b/;

/**
 * The verdict and gaps from a goal check's report; `unread` when it has no
 * verdict. Only a plain MET is met: a qualified one (`NOT MET`, `NOT-MET`,
 * `PARTIALLY MET`, `MET except …`) is not, and neither is a MET with gaps listed.
 */
export function parseGoalCheck(output: string): { verdict: GoalVerdict; gaps: string[] } {
  const said = verdictLine(output).toUpperCase().replace(/[*_`]/g, " ").replace(/\s+/g, " ").trim();
  const gaps = section(output, "Gaps")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^\(?none\b[^a-z]*$/i.test(line) && !/^no gaps\.?$/i.test(line));
  // The format line copied back (`MET or NOT MET`) says nothing.
  if (/\bOR\b/.test(said)) return { verdict: "unread", gaps: [] };
  let verdict: GoalVerdict = QUALIFIED.test(said) || /NOT[-_ ]?MET|UNMET/.test(said) ? "not_met" : /^MET\b/.test(said) ? "met" : "unread";
  if (verdict === "met" && gaps.length > 0) verdict = "not_met";
  // A NOT MET without any gap named is still a gap: point at the requirements list.
  if (verdict === "not_met" && gaps.length === 0) {
    const unmet = section(output, "Requirements").split("\n").filter((line) => /—\s*(not|partly|partially) met\s*—/i.test(line)).map((line) => line.replace(/^\s*[-*]\s*/, "").trim());
    return { verdict, gaps: unmet.length > 0 ? unmet : [`the goal check found the request not fully met (${truncate(said, 120)}) but named no gap`] };
  }
  return { verdict, gaps: verdict === "met" ? [] : gaps };
}

export function goalCheckInstruction(request: GoalCheckRequest): string {
  return [
    "Check this change against what the user asked for.",
    `## The user's request\n\n${request.request.trim()}`,
    request.amendments.length > 0 ? `## The user's amendments\n\n${request.amendments.map((entry) => `- ${entry}`).join("\n")}` : "",
    `## The change\n\n${truncate(request.diff, GOAL_DIFF_CHARS)}`,
  ].filter(Boolean).join("\n\n");
}

/** The goal check's prompt, with the QA settings' own instructions when the user gave any. */
export function goalCheckPrompt(instructions?: string): string {
  const custom = instructions?.trim();
  return custom ? `${loadPrompt("goal-check.md")}\n\n## Custom Instructions\n\n${custom}` : loadPrompt("goal-check.md");
}

export async function runGoalCheck(request: GoalCheckRequest, run: ProcessRunner = spawnPiProcess): Promise<GoalCheckResult> {
  // The QA settings' model reads the change: the same reader the gate trusts, on a much smaller job.
  const profile = profileFor(request.config, request.profile, "qa", "reviewer");
  const agentRun = await runAgent({
    taskId: request.taskId,
    domain: "qa",
    role: "reviewer",
    instruction: goalCheckInstruction(request),
    context: { task: request.request },
    systemPrompt: goalCheckPrompt(profile.instructions),
    ...(profile.model ? { model: profile.model } : {}),
    thinking: profile.thinking,
    cwd: request.cwd,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onUpdate ? { onUpdate: (update: AgentRun) => request.onUpdate!({ ...update, note: update.note ?? "goal check" }) } : {}),
    ...watchdogOptions(request.config.workflow),
    retries: 0,
  }, run);
  if (agentRun.status !== "success") return { verdict: "unread", gaps: [], run: agentRun };
  return { ...parseGoalCheck(agentRun.output), run: agentRun };
}
