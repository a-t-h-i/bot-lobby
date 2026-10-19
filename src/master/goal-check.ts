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
import { runAgent, watchdogOptions, type AgentTime } from "../execution/agent-runner.ts";
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
  time?: AgentTime;
}

/** At most this long: it reads, it does not test. */
export const GOAL_CHECK_MS = 6 * 60 * 1000;
const MAX_DIFF = 60_000;

function section(text: string, title: string): string {
  const match = new RegExp(`^##\\s+${title}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im").exec(text);
  return match?.[1]?.trim() ?? "";
}

/** The verdict and gaps from a goal check's report; `unread` when it has no verdict. */
export function parseGoalCheck(output: string): { verdict: GoalVerdict; gaps: string[] } {
  const verdictText = section(output, "Verdict").toUpperCase();
  const verdict: GoalVerdict = /\bNOT\s+MET\b/.test(verdictText) ? "not_met" : /\bMET\b/.test(verdictText) ? "met" : "unread";
  const gaps = section(output, "Gaps")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^none\.?$/i.test(line));
  // A NOT MET without any gap named is still a gap: point at the requirements list.
  if (verdict === "not_met" && gaps.length === 0) {
    const unmet = section(output, "Requirements").split("\n").filter((line) => /—\s*not met\s*—/i.test(line)).map((line) => line.replace(/^\s*[-*]\s*/, "").trim());
    return { verdict, gaps: unmet.length > 0 ? unmet : ["the goal check found the request not fully met but named no gap"] };
  }
  return { verdict, gaps: verdict === "met" ? [] : gaps };
}

export function goalCheckInstruction(request: GoalCheckRequest): string {
  return [
    "Check this change against what the user asked for.",
    `## The user's request\n\n${request.request.trim()}`,
    request.amendments.length > 0 ? `## The user's amendments\n\n${request.amendments.map((entry) => `- ${entry}`).join("\n")}` : "",
    `## The change\n\n${truncate(request.diff, MAX_DIFF)}`,
  ].filter(Boolean).join("\n\n");
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
    systemPrompt: loadPrompt("goal-check.md"),
    ...(profile.model ? { model: profile.model } : {}),
    thinking: profile.thinking,
    timeoutMs: Math.min(GOAL_CHECK_MS, profile.timeoutMs),
    ...(request.time ? { time: request.time } : {}),
    cwd: request.cwd,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onUpdate ? { onUpdate: (update: AgentRun) => request.onUpdate!({ ...update, note: update.note ?? "goal check" }) } : {}),
    ...watchdogOptions(request.config.workflow),
    retries: 0,
  }, run);
  if (agentRun.status !== "success") return { verdict: "unread", gaps: [], run: agentRun };
  return { ...parseGoalCheck(agentRun.output), run: agentRun };
}
