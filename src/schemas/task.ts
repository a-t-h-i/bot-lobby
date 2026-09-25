import type { Domain } from "./agent.ts";

export const TASK_STATES = [
  "created",
  "clarifying",
  "scouting",
  "synthesizing",
  "awaiting_approval",
  "planning",
  "implementing",
  "reviewing",
  "blocked",
  "completed",
  "abandoned",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_STATES: readonly TaskState[] = ["completed", "abandoned"];

export type Verdict = "pass" | "changes_required" | "blocked";
export type Severity = "critical" | "major" | "minor" | "info";

export interface Blocker {
  domain: Domain;
  reason: string;
  tried: string[];
  need: string;
  createdAt: string;
}

export interface Decision {
  domain: Domain | "master";
  text: string;
  createdAt: string;
}

export type ApprovalKind = "dependency" | "architecture" | "pushback";

/** A Worker-requested exception or pushback the Master must resolve before proceeding. */
export interface Approval {
  id: string;
  kind: ApprovalKind;
  domain: Domain;
  detail: string;
  status: "pending" | "approved" | "rejected";
  note?: string;
  createdAt: string;
}

export interface ReviewRecord {
  domain: Domain;
  verdict: Verdict;
  findings: { severity: Severity; text: string }[];
  requiredChanges: string[];
  createdAt: string;
}
/**
 * One finished worker delegation, kept on the task so the plan checklist can be
 * replayed after a reload instead of resetting to the first step.
 */
export interface WorkerRunRecord {
  runId: string;
  domain: Domain;
  instruction: string;
  status: "running" | "success" | "failed" | "cancelled" | "timeout";
  startedAt: string;
  finishedAt?: string;
}

/** Upper bound on persisted worker records; plans cap at 50 steps. */
export const MAX_WORKER_RECORDS = 64;

export interface Task {
  id: string;
  title: string;
  /** The user's original request, kept in full while `title` stays a short label. */
  request: string;
  state: TaskState;
  domains: Domain[];
  proposal?: string;
  plan?: string;
  amendments: string[];
  paused: boolean;
  reviewIterations: { qa: number };
  reviewRecords: ReviewRecord[];
  qaVerdict?: Verdict;
  blockers: Blocker[];
  decisions: Decision[];
  approvals: Approval[];
  /** Worker delegations in start order; absent on tasks created before tracking. */
  workerRuns?: WorkerRunRecord[];
  createdAt: string;
  updatedAt: string;
  /** The pi session (ctx.sessionManager id) that owns this task; absent on legacy tasks. */
  ownerSessionId?: string;
}

export function createTask(
  id: string,
  title: string,
  now = new Date().toISOString(),
  request = title,
  ownerSessionId?: string,
): Task {
  return {
    id,
    title,
    request,
    state: "created",
    domains: [],
    amendments: [],
    paused: false,
    reviewIterations: { qa: 0 },
    reviewRecords: [],
    blockers: [],
    decisions: [],
    approvals: [],
    createdAt: now,
    ...(ownerSessionId ? { ownerSessionId } : {}),
    updatedAt: now,
  };
}

/** The full request for a task, falling back to the title for pre-field state. */
export function taskRequest(task: Task): string {
  return task.request || task.title;
}

export function isTaskState(value: string): value is TaskState {
  return (TASK_STATES as readonly string[]).includes(value);
}
