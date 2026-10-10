/**
 * One-line descriptions of subagent runs, shared by the transcript entries,
 * `/bot-lobby runs`, the Master's reports and the zen feed row. Pure: every
 * clock read arrives as `now`.
 */
import type { AgentRun } from "../schemas/findings.ts";
import type { RunLogEntry } from "../schemas/task.ts";
import { shortDuration } from "../text.ts";

export type SlotId = "dev" | "design" | "research" | "qa";

/** Uppercase agent names. */
const SLOT_LABELS: Record<SlotId, string> = {
  dev: "DEV",
  design: "DESIGN",
  research: "RESEARCH",
  qa: "QA",
};

/** The agent slot a run belongs to; a researcher reports under RESEARCH from any domain. */
export function slotOf(run: Pick<AgentRun, "domain" | "role">): SlotId {
  if (run.role === "researcher") return "research";
  if (run.domain === "backend") return "dev";
  return run.domain === "designer" ? "design" : "qa";
}

/** Upper-case agent name (DEV, DESIGN, RESEARCH, QA). */
export function agentName(run: Pick<AgentRun, "domain" | "role">): string {
  return SLOT_LABELS[slotOf(run)];
}

/** Compact token count: 950, 41k, 1.2M. */
export function tokens(count: number): string {
  if (!Number.isFinite(count) || count < 1000) return String(Math.max(0, Math.round(count || 0)));
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function durationOf(run: Pick<AgentRun, "startedAt" | "finishedAt">, now: number): number {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const elapsed = end - Date.parse(run.startedAt);
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
}

const STATUS_ICONS: Record<AgentRun["status"], string> = {
  running: "◐",
  success: "✓",
  failed: "✗",
  cancelled: "·",
  timeout: "✗",
};

/** Why a run ended the way it did, in words, when that is not plain success. */
export function runFlags(run: Pick<AgentRun, "status" | "stalled" | "wrappedUp" | "attempts" | "route">): string[] {
  const flags: string[] = [];
  if (run.route) flags.push(`routed ${run.route}`);
  if (run.stalled) flags.push("stalled");
  else if (run.status === "timeout") flags.push("hit its time limit");
  else if (run.status === "failed") flags.push("failed");
  else if (run.status === "cancelled") flags.push("cancelled");
  if (run.wrappedUp) flags.push(run.status === "success" ? "wrapped up early — report may be partial" : "asked to wrap up");
  if (run.attempts > 1) flags.push(`${run.attempts} attempts`);
  return flags;
}

/**
 * `✓ DEV worker · 3m 12s · 9 turns · 23 tools · 41k↑ 6k↓ · $0.12 · provider/model`,
 * followed by any flags (stalled, time limit, wrapped up early, attempts).
 */
export function describeRun(run: AgentRun, now = Date.now()): string {
  const parts = [`${STATUS_ICONS[run.status]} ${agentName(run)} ${run.role}`, shortDuration(durationOf(run, now))];
  if (run.parentRunId) parts.push(`child of ${run.parentRunId}`);
  const turns = run.turns ?? run.usage?.turns;
  if (turns) parts.push(`${turns} turn${turns === 1 ? "" : "s"}`);
  if (run.tools) parts.push(`${run.tools} tool${run.tools === 1 ? "" : "s"}`);
  if (run.usage && (run.usage.input || run.usage.output)) parts.push(`${tokens(run.usage.input)}↑ ${tokens(run.usage.output)}↓`);
  if (run.usage?.cost) parts.push(`$${run.usage.cost.toFixed(2)}`);
  if (run.model) parts.push(run.model);
  parts.push(...runFlags(run));
  const line = parts.join(" · ");
  return run.status === "success" || !run.error ? line : `${line} — ${run.error.split("\n")[0]}`;
}

/** The persisted form of a finished run, for `task.runLog`. */
export function runLogEntry(run: AgentRun): RunLogEntry {
  return {
    runId: run.runId,
    ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
    ...(run.depth ? { depth: run.depth } : {}),
    ...(run.instruction ? { instruction: run.instruction } : {}),
    ...(run.stepInstruction ? { stepInstruction: run.stepInstruction } : {}),
    domain: run.domain,
    role: run.role,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.model ? { model: run.model } : {}),
    ...(run.thinking ? { thinking: run.thinking } : {}),
    ...(run.turns ?? run.usage?.turns ? { turns: run.turns ?? run.usage?.turns } : {}),
    ...(run.tools ? { tools: run.tools } : {}),
    ...(run.usage ? { input: run.usage.input, output: run.usage.output, cost: run.usage.cost } : {}),
    attempts: run.attempts,
    ...(run.stalled ? { stalled: true } : {}),
    ...(run.wrappedUp ? { wrappedUp: true } : {}),
    ...(run.error ? { error: run.error.split("\n")[0]!.slice(0, 200) } : {}),
    ...(run.routedFrom ? { routedFrom: run.routedFrom } : {}),
  };
}

/** A persisted entry back as a run, so `describeRun` formats both the same way. */
export function runFromLog(entry: RunLogEntry, taskId: string): AgentRun {
  return {
    runId: entry.runId,
    ...(entry.parentRunId ? { parentRunId: entry.parentRunId } : {}),
    ...(entry.depth ? { depth: entry.depth } : {}),
    ...(entry.instruction ? { instruction: entry.instruction } : {}),
    ...(entry.stepInstruction ? { stepInstruction: entry.stepInstruction } : {}),
    taskId,
    domain: entry.domain,
    role: entry.role,
    status: entry.status,
    output: "",
    attempts: entry.attempts ?? 1,
    startedAt: entry.startedAt,
    ...(entry.finishedAt ? { finishedAt: entry.finishedAt } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.thinking ? { thinking: entry.thinking } : {}),
    ...(entry.turns ? { turns: entry.turns } : {}),
    ...(entry.tools ? { tools: entry.tools } : {}),
    ...(entry.input !== undefined ? { usage: { input: entry.input, output: entry.output ?? 0, cost: entry.cost ?? 0, turns: entry.turns ?? 0 } } : {}),
    ...(entry.stalled ? { stalled: true } : {}),
    ...(entry.wrappedUp ? { wrappedUp: true } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
}
