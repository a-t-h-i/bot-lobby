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

export type ApprovalKind = "dependency" | "architecture";

/** A Worker-requested exception the Master must resolve before proceeding. */
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
  createdAt: string;
  updatedAt: string;
}

export function createTask(
  id: string,
  title: string,
  now = new Date().toISOString(),
  request = title,
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
