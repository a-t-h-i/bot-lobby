import type { AgentRun } from "../schemas/findings.ts";
import type { Task } from "../schemas/task.ts";
import { truncate } from "../text.ts";

/** ASCII mascot frames; the zen widget advances one frame per animation tick. */
export const MASCOT_FRAMES: readonly (readonly string[])[] = [
  ["   (\\_/)", "   (•_•)", "   / > \\"],
  ["   (\\_/)", "   (-_-)", "   / > \\"],
  ["   (\\_/)", "   (•_•)", "   / > \\"],
  ["   (\\_/)", "   (^_^)", "   / > \\"],
];

/** Human-readable duration such as "9s" or "2m 05s". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

function runElapsed(run: AgentRun, now: number): number {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return end - Date.parse(run.startedAt);
}

function runLine(run: AgentRun, now: number): string {
  const icon = run.status === "running" ? "◐" : run.status === "success" ? "✓" : "✗";
  const retry = run.attempts > 1 ? ` ×${run.attempts}` : "";
  const status = run.status.padEnd(8);
  return `  ${icon} ${run.domain}/${run.role}  ${status} ${formatDuration(runElapsed(run, now))}${retry}`;
}

/** Upper bound on parsed plan steps / panel rows so the widget stays bounded. */
export const MAX_PLAN_STEPS = 50;
export const MAX_PANEL_LINES = 10;

const STEP_LINE = /^\s*\d+\.\s+(.*\S)\s*$/;
const CHECKLIST_ROWS = 3;
const PREFIX_CHARS = 32;
const MIN_PREFIX = 8;

export type PlanStepStatus = "done" | "current" | "pending";

export interface PlanStep {
  text: string;
  status: PlanStepStatus;
}

/** Numbered `1. \`path\`: …` lines from a free-form plan, capped. */
export function planSteps(plan: string): string[] {
  const steps: string[] = [];
  for (const line of plan.split("\n")) {
    const match = STEP_LINE.exec(line);
    if (match) steps.push(match[1]!);
    if (steps.length >= MAX_PLAN_STEPS) break;
  }
  return steps;
}

function normalize(text: string): string {
  return text.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesInstruction(step: string, instruction: string): boolean {
  const hay = normalize(instruction);
  const path = /`([^`]+)`/.exec(step)?.[1];
  if (path && hay.includes(normalize(path))) return true;
  const tail = normalize(step.replace(/`[^`]+`/g, " ").replace(/^[\s:;,.—–-]+/, ""));
  return tail.length >= MIN_PREFIX && hay.includes(tail.slice(0, PREFIX_CHARS));
}

function latestWorkerInstruction(runs: AgentRun[]): string | undefined {
  let latest: AgentRun | undefined;
  for (const run of runs) {
    if (run.role !== "worker" || !run.instruction) continue;
    if (!latest || Date.parse(run.startedAt) >= Date.parse(latest.startedAt)) latest = run;
  }
  return latest?.instruction;
}

function stepStatus(index: number, current: number): PlanStepStatus {
  if (current < 0) return index === 0 ? "current" : "pending";
  if (index < current) return "done";
  return index === current ? "current" : "pending";
}

/** Done/current/pending per plan step, matched from the latest worker instruction. */
export function planChecklist(plan: string, runs: AgentRun[]): PlanStep[] {
  const steps = planSteps(plan);
  const instruction = latestWorkerInstruction(runs);
  const current = instruction ? steps.findIndex((step) => matchesInstruction(step, instruction)) : -1;
  return steps.map((text, index) => ({ text, status: stepStatus(index, current) }));
}

function checklistWindow(steps: PlanStep[]): number[] {
  if (steps.length <= CHECKLIST_ROWS) return steps.map((_step, index) => index);
  const found = steps.findIndex((step) => step.status === "current");
  const current = found < 0 ? 0 : found;
  const start = Math.min(Math.max(current - 1, 0), steps.length - CHECKLIST_ROWS);
  return [start, start + 1, start + 2];
}

function stepLine(step: PlanStep, ordinal: number): string {
  const icon = step.status === "done" ? "✓" : step.status === "current" ? "◐" : "○";
  return `  ${icon} ${ordinal}. ${step.text}`;
}

function headerLine(task: Task, now: number, quiet: boolean): string {
  const paused = task.paused ? " (paused)" : "";
  const elapsed = formatDuration(now - Date.parse(task.createdAt));
  const mode = quiet ? "tools hidden (alt+t)" : "tools shown";
  return `dev-house ${task.id} · ${task.state}${paused}   ⏱ ${elapsed} · ${mode}`;
}

function alertLine(task: Task): string | undefined {
  const pending = task.approvals.filter((approval) => approval.status === "pending");
  if (pending.length > 0) return `approvals pending: ${pending.map((approval) => approval.id).join(", ")}`;
  if (task.blockers.length > 0) return `blocked: ${truncate(task.blockers[0]!.reason, 60)}`;
  return undefined;
}

function activityLine(runs: AgentRun[], now: number): string {
  const run = runs.at(-1);
  return run ? runLine(run, now) : "  ○ waiting for the first agent…";
}

function mascotLine(tick: number): string {
  return mascotFrame(tick).join(" ");
}

export function mascotFrame(tick: number): string[] {
  return [...MASCOT_FRAMES[Math.abs(tick) % MASCOT_FRAMES.length]!];
}

/** Zen panel lines, at most `MAX_PANEL_LINES`; empty when no task is active. */
export function panelLines(
  task: Task | undefined,
  runs: AgentRun[],
  now: number,
  quiet: boolean,
  tick = 0,
): string[] {
  if (!task) return [];
  const steps = planChecklist(task.plan ?? "", runs);
  const lines = [headerLine(task, now, quiet)];
  if (steps.length > 0) {
    const done = steps.filter((step) => step.status === "done").length;
    lines.push(`steps ${done}/${steps.length}`);
    for (const index of checklistWindow(steps)) lines.push(stepLine(steps[index]!, index + 1));
  }
  const alert = alertLine(task);
  if (alert) lines.push(alert);
  lines.push(activityLine(runs, now), mascotLine(tick));
  return lines.slice(0, MAX_PANEL_LINES);
}
