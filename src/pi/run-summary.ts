/**
 * One-line descriptions of subagent runs, shared by the transcript entries,
 * `/bot-lobby runs`, the Master's reports and the zen feed row. Pure: every
 * clock read arrives as `now`.
 */
import type { AgentRun } from "../schemas/findings.ts";
import type { RunLogEntry } from "../schemas/task.ts";
import { shortDuration } from "../text.ts";
import { SLOT_LABELS, type SlotId } from "./mascot-art.ts";

/** The zen column a run belongs to; a researcher reports under RESEARCH from any domain. */
export function slotOf(run: Pick<AgentRun, "domain" | "role">): SlotId {
  if (run.role === "researcher") return "research";
  if (run.domain === "backend") return "dev";
  return run.domain === "designer" ? "design" : "qa";
}

/** Upper-case agent name as the scene shows it (DEV, DESIGN, RESEARCH, QA). */
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
export function runFlags(run: Pick<AgentRun, "status" | "stalled" | "wrappedUp" | "attempts">): string[] {
  const flags: string[] = [];
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
    domain: run.domain,
    role: run.role,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run.model ? { model: run.model } : {}),
    ...(run.turns ?? run.usage?.turns ? { turns: run.turns ?? run.usage?.turns } : {}),
    ...(run.tools ? { tools: run.tools } : {}),
    ...(run.usage ? { input: run.usage.input, output: run.usage.output, cost: run.usage.cost } : {}),
    attempts: run.attempts,
    ...(run.stalled ? { stalled: true } : {}),
    ...(run.wrappedUp ? { wrappedUp: true } : {}),
    ...(run.error ? { error: run.error.split("\n")[0]!.slice(0, 200) } : {}),
  };
}

/** A persisted entry back as a run, so `describeRun` formats both the same way. */
export function runFromLog(entry: RunLogEntry, taskId: string): AgentRun {
  return {
    runId: entry.runId,
    taskId,
    domain: entry.domain,
    role: entry.role,
    status: entry.status,
    output: "",
    attempts: entry.attempts ?? 1,
    startedAt: entry.startedAt,
    ...(entry.finishedAt ? { finishedAt: entry.finishedAt } : {}),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.turns ? { turns: entry.turns } : {}),
    ...(entry.tools ? { tools: entry.tools } : {}),
    ...(entry.input !== undefined ? { usage: { input: entry.input, output: entry.output ?? 0, cost: entry.cost ?? 0, turns: entry.turns ?? 0 } } : {}),
    ...(entry.stalled ? { stalled: true } : {}),
    ...(entry.wrappedUp ? { wrappedUp: true } : {}),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

/** Silence after which a working agent reads as "quiet" in the scene. */
export const QUIET_MS = 45_000;

/** How long a running agent has produced nothing, or 0 when it is not running or has no clock yet. */
export function quietFor(run: Pick<AgentRun, "status" | "lastEventAt" | "startedAt">, now: number): number {
  if (run.status !== "running") return 0;
  const last = run.lastEventAt ?? Date.parse(run.startedAt);
  const quiet = now - last;
  return Number.isFinite(quiet) && quiet > 0 ? quiet : 0;
}

export interface FeedLine {
  text: string;
  kind: "info" | "warning";
}

/** Ticks one working agent holds the feed before it rotates to the next (~3 s at the live clock). */
export const FEED_ROTATE_TICKS = 12;

/** What one working agent is doing right now, with a warning when something needs attention. */
function liveFeed(run: AgentRun, now: number): FeedLine {
  const name = agentName(run);
  if (run.waitingFor) return { text: `⧗ ${name} waiting for ${run.waitingFor}${run.note ? ` · ${run.note}` : ""}`, kind: "warning" };
  const quiet = quietFor(run, now);
  if (quiet >= QUIET_MS) {
    const doing = run.activity ? ` (last: ${run.activity}${run.detail ? ` ${run.detail}` : ""})` : "";
    return { text: `! ${name} quiet for ${shortDuration(quiet)}${doing}`, kind: "warning" };
  }
  if (run.note && run.noteKind === "warning") return { text: `! ${name} ${run.note}`, kind: "warning" };
  const parts = [`▸ ${name} ${run.activity ?? "working"}${run.detail ? ` ${run.detail}` : ""}`];
  const turns = run.turns ?? run.usage?.turns;
  if (turns) parts.push(`turn ${turns}`);
  if (run.tools) parts.push(`${run.tools} tools`);
  if (run.usage && run.usage.input + run.usage.output > 0) parts.push(`${tokens(run.usage.input + run.usage.output)} tok`);
  if (run.note) parts.push(run.note);
  return { text: parts.join(" · "), kind: "info" };
}

/**
 * The scene's feed row: a working agent that needs attention first, otherwise
 * the working agents in rotation, otherwise the most recent finished run.
 * Undefined before anything has run.
 */
export function feedLine(runs: readonly AgentRun[], now: number, tick: number): FeedLine | undefined {
  const running = runs.filter((run) => run.status === "running");
  if (running.length > 0) {
    const lines = running.map((run) => liveFeed(run, now));
    const warning = lines.find((line) => line.kind === "warning");
    if (warning) return warning;
    const index = Math.floor(Math.max(0, tick) / FEED_ROTATE_TICKS) % lines.length;
    return lines[index];
  }
  const last = [...runs].filter((run) => run.finishedAt).sort((a, b) => Date.parse(a.finishedAt!) - Date.parse(b.finishedAt!)).at(-1);
  if (!last) return undefined;
  return { text: describeRun(last, now), kind: last.status === "success" && !last.wrappedUp ? "info" : "warning" };
}
