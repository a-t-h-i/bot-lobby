import type { Domain, Role } from "./agent.ts";

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

/** One finished subagent run of any role, kept for `/bot-lobby runs`. */
export interface RunLogEntry {
  runId: string;
  domain: Domain;
  role: Role;
  status: "running" | "success" | "failed" | "cancelled" | "timeout";
  startedAt: string;
  finishedAt?: string;
  model?: string;
  thinking?: string;
  turns?: number;
  tools?: number;
  input?: number;
  output?: number;
  cost?: number;
  attempts?: number;
  stalled?: boolean;
  wrappedUp?: boolean;
  error?: string;
  /** The classifier routed this run down from this configured profile. */
  routedFrom?: string;
}

/** Upper bound on persisted run-log entries. */
export const MAX_RUN_LOG = 64;

export type TriageSize = "trivial" | "small" | "medium" | "large";

/** What the classifier made of the request when the task started: hints for the Master, never rules. */
export interface TaskTriage {
  size: TriageSize;
  sizeConfidence: number;
  /** How likely each domain is touched, 0 to 1. */
  domains: Partial<Record<Domain, number>>;
  /** How likely building it needs outside facts. */
  research: number;
  /** How likely it is ambiguous as written. */
  ambiguous: number;
  kind?: string;
  kindProbability?: number;
  likelyFiles?: string[];
  at: string;
}

/** What the working tree held when a task's agents started editing: its changed files, repository-relative. */
export interface ChangeBaseline {
  at: string;
  files: string[];
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
  /** Worker delegations in start order; absent on tasks created before tracking. */
  workerRuns?: WorkerRunRecord[];
  /** Recent finished runs of every role, newest last. */
  runLog?: RunLogEntry[];
  createdAt: string;
  updatedAt: string;
  /** The pi session (ctx.sessionManager id) that owns this task; absent on legacy tasks. */
  ownerSessionId?: string;
  /** The planned task (PLAN-…) whose plan the user agreed in the planning panel: its proposal needs no approval. */
  approvedPlan?: string;
  /** When the task was archived from the lobby (it then lives under archive/tasks, out of every list). */
  archivedAt?: string;
  /** The classifier's read of the request, when it was on as the task started. */
  triage?: TaskTriage;
  /** Files already changed when the first worker started: the QA gate reads them as pre-existing, not as this task's work. */
  baseline?: ChangeBaseline;
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
