import { randomUUID } from "node:crypto";
import { createLiveRun } from "./live-run.ts";
import type { Domain, Role } from "../schemas/agent.ts";
import type { AgentRun } from "../schemas/findings.ts";
import { roleSpec } from "../roles/registry.ts";
import { compilePrompt } from "../prompts/compiler.ts";
import { EditLog } from "../state/changes.ts";
import { formatMinutes, REPORT_GRACE_MS } from "../state/budget.ts";
import { runPiAgent, spawnPiProcess, type ProcessRunner, type RelayAsk } from "./pi-runner.ts";
import { ASK_ENV } from "../ask/relay.ts";
import { STEP_LIMIT_MS } from "../state/step-limits.ts";
import type { EffortRouter, RunProfileLike } from "../classifier/effort.ts";
import { ASK_TOOL } from "../ask/types.ts";

export interface AgentContext {
  task: string;
  standards?: string;
  knowledge?: string;
  decisions?: string;
  /** The shared scripts that fit the step. */
  scripts?: string;
  /** Per-agent custom instructions from the global config. */
  instructions?: string;
  workflowContext?: string;
}

/** Live fields a caller (the file desk) may set on a running agent. */
export type LivePatch = Pick<AgentRun, "note" | "noteKind" | "waitingFor" | "model" | "thinking" | "route" | "routedFrom">;

/** Control over one running attempt, handed to `onStart`. */
export interface AgentHandle {
  runId: string;
  steer(text: string): void;
  annotate(patch: LivePatch): void;
}

export interface AgentRequest {
  taskId: string;
  domain: Domain;
  role: Role;
  effort?: EffortRouter;
  effortProfile?: RunProfileLike;
  /** Concrete instruction sent as the subagent's task message. */
  instruction: string;
  /** Prompt layers selected for this run. */
  context: AgentContext;
  /** A whole system prompt of its own instead of the compiled role layers (the goal check). */
  systemPrompt?: string;
  model?: string;
  mcpTools?: string[];
  /** False when the agent's settings turn its auto-compaction off. */
  autoCompact?: boolean;
  delegationQuota?: { used: number; consults?: number };
  /** See PiRunOptions.expert. */
  expert?: { model?: string; thinking: string };
  thinking?: string;
  timeoutMs: number;
  cwd: string;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
  /** Bounded retries for transient failures (crash/stall). */
  retries?: number;
  /** Kill after this long without output; 0 or absent disables. */
  stallTimeoutMs?: number;
  /** Silence allowed while one tool call runs. */
  toolStallTimeoutMs?: number;
  /** Fraction of `timeoutMs` at which the agent is asked to wrap up; 0 disables. */
  wrapUpAt?: number;
  /** Extra tools on top of the role allowlist (the file desk's tools). */
  extraTools?: readonly string[];
  env?: Record<string, string>;
  /** Called once per attempt when the process is running. */
  onStart?: (handle: AgentHandle) => void;
  /** Called once per attempt after it ends, before any retry. */
  onAttemptEnd?: (run: AgentRun) => void;
  /** The classifier routed this run down from this configured profile (receipts and metrics show it). */
  routedFrom?: string;
  route?: string;
  /** Under a task time budget: the run's allotted time, which replaces `timeoutMs`. */
  time?: AgentTime;
  /** Lets the agent ask the user (ask_user_question, relayed through the master); its clocks wait for the answers. */
  onAsk?: RelayAsk;
}

/**
 * A run under a task time budget. The agent is told its minutes up front,
 * warned at 75%, and asked to stop and report when they run out. A worker
 * then reports where it left off and how much more it needs; `onTimeUp`
 * (the engine asking the user) grants more, and the same agent carries on.
 */
export interface AgentTime {
  /** Active time shared across attempts and model fallbacks. */
  usedMs?: number;
  /** Include reporting in the hard allowance. */
  strict?: boolean;
  /** When the delegation's time runs out (epoch ms); moved out when more is granted, shared by retries and re-runs. */
  endsAt: number;
  /** The allotment, as the agent and the lobby see it. */
  allotMs: number;
  /** What the agent is told about its time, in its context. */
  note?: string;
  /** Workers only: decide on more time once it has reported where it left off; resolve with ms, 0 to stop it. */
  onTimeUp?: (run: AgentRun, report: string) => Promise<number>;
}

/** The warning at 75% of an allotment. */
export function headsUpMessage(leftMs: number, allotMs: number): string {
  return `bot-lobby: about ${formatMinutes(leftMs)} of your ${formatMinutes(allotMs)} for this step are left. Finish what you have started and make sure it works; leave nice-to-haves.`;
}

/** The steer when an allotment is spent: a worker says where it left off and what more it needs; any other role reports what it has. */
export function timeUpMessage(allotMs: number, canAskForMore: boolean): string {
  return canAskForMore
    ? `bot-lobby: your ${formatMinutes(allotMs)} for this step are up. Stop here: finish or revert the edit in progress so every file is consistent, start nothing new, and write your report now in the required format, adding \`## Left Off\` (what you were doing and what is still to do) and \`## More Time\` (how many more minutes you need, and why). The user decides whether you get more time to finish.`
    : `bot-lobby: your ${formatMinutes(allotMs)} are up. Stop now and write your report in the required format with what you have.`;
}

/** The follow-up that sends an agent on once the user gave it more time. */
export function carryOnMessage(extraMs: number): string {
  return `bot-lobby: the user gave you ${formatMinutes(extraMs)} more. Carry on from where you left off and finish the step, then write your final report in the required format (leave out Left Off and More Time if you finish).`;
}

/** Least time an attempt starts with; a retry with less than this left is not started. */
const MIN_ATTEMPT_MS = 60_000;

export function boundedAgentTime(timeoutMs: number): AgentTime {
  const allotMs = Math.min(STEP_LIMIT_MS, timeoutMs);
  return { endsAt: Date.now() + allotMs, allotMs, strict: true };
}

/** The watchdog fields of an AgentRequest, taken from the workflow config. */
export function watchdogOptions(workflow: {
  maxAgentRetries: number;
  stallTimeoutMs: number;
  toolStallTimeoutMs: number;
  wrapUpAt: number;
}): Pick<AgentRequest, "retries" | "stallTimeoutMs" | "toolStallTimeoutMs" | "wrapUpAt"> {
  return {
    retries: workflow.maxAgentRetries,
    stallTimeoutMs: workflow.stallTimeoutMs,
    toolStallTimeoutMs: workflow.toolStallTimeoutMs,
    wrapUpAt: workflow.wrapUpAt,
  };
}

const activeControllers = new Set<AbortController>();

/** A stall or crash is worth one more try; a spent deadline or a cancel is not. */
function retryable(run: AgentRun): boolean {
  if (run.status === "failed") return true;
  return run.status === "timeout" && run.stalled === true;
}

/**
 * Run one domain/role agent, retrying transient failures a bounded number of
 * times. Cancellation and a spent deadline never retry, so Esc stays responsive
 * and a slow agent cannot double its time budget.
 */
export async function runAgent(request: AgentRequest, run: ProcessRunner = spawnPiProcess): Promise<AgentRun> {
  request.time ??= boundedAgentTime(request.timeoutMs);
  if (!request.time.strict) {
    request.time.endsAt = Math.min(request.time.endsAt, Date.now() + Math.min(STEP_LIMIT_MS, request.timeoutMs));
    request.time.allotMs = Math.min(request.time.allotMs, STEP_LIMIT_MS, request.timeoutMs);
    request.time.strict = true;
  }
  request.time.usedMs ??= Math.max(0, request.time.allotMs - (request.time.endsAt - Date.now()));
  const startedAt = new Date().toISOString();
  if (request.time.endsAt <= Date.now()) {
    const stopped: AgentRun = { ...baseRun(request, `${request.taskId}:${randomUUID()}`, startedAt), status: "timeout", error: "The assignment's shared time limit is spent; request user-approved time before continuing.", finishedAt: startedAt, timeUp: true };
    request.onUpdate?.(stopped);
    return stopped;
  }
  const attempts = Math.max(1, (request.retries ?? 0) + 1);
  // A failed attempt may have edited files before the retry: the run owns every edit.
  const edits = new EditLog(request.cwd);
  let last: AgentRun | undefined;
  const quota = request.delegationQuota ??= { used: 0 };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await runAgentOnce(request, run, attempt, startedAt, edits, quota);
    request.onAttemptEnd?.(last);
    if (!retryable(last)) break;
    // Under a budget a retry only uses what is left of the allotment.
    if (request.time && request.time.endsAt - Date.now() < MIN_ATTEMPT_MS) break;
  }
  const edited = edits.list();
  return edited.length > 0 ? { ...last!, edited } : last!;
}

/** Abort every in-flight subagent (session shutdown, user cancel). */
export function cancelAllRuns(): void {
  for (const controller of activeControllers) controller.abort();
  activeControllers.clear();
}

function baseRun(request: AgentRequest, runId: string, startedAt: string, attempts = 1): AgentRun {
  return {
    runId,
    taskId: request.taskId,
    domain: request.domain,
    role: request.role,
    instruction: request.instruction,
    status: "running",
    output: "",
    attempts,
    startedAt,
    ...(request.thinking ? { thinking: request.thinking } : {}),
    ...(request.routedFrom ? { routedFrom: request.routedFrom } : {}),
    ...(request.route ? { route: request.route } : {}),
    ...(request.time ? { allotMs: request.time.allotMs, endsAt: request.time.endsAt } : {}),
    ...(attempts > 1 ? { note: `retry ${attempts - 1} of ${(request.retries ?? 0)}`, noteKind: "warning" as const } : {}),
  };
}

function toolsFor(request: AgentRequest): readonly string[] | undefined {
  const tools = roleSpec(request.role).tools;
  const extra = [...(request.extraTools ?? []), ...(request.onAsk ? [ASK_TOOL] : [])];
  if (extra.length === 0) return tools;
  return [...(tools ?? []), ...extra];
}

/**
 * Run one domain/role agent in an isolated pi process. The role's tool
 * allowlist comes from its spec, so read-only roles cannot modify anything.
 */
async function runAgentOnce(request: AgentRequest, run: ProcessRunner, attempt: number, startedAt: string, edits: EditLog, quota: { used: number }): Promise<AgentRun> {
  const base = baseRun(request, `${request.taskId}:${request.domain}:${request.role}:${randomUUID()}`, startedAt, attempt);
  request.onUpdate?.(base);
  const time = request.time!;
  const attemptStart = Date.now();
  let pausedMs = 0;
  let asking = 0;
  let askStarted = 0;
  let expired = false;
  const elapsed = () => Math.max(0, Date.now() - attemptStart - pausedMs - (asking ? Date.now() - askStarted : 0));
  const live = createLiveRun(base, { ...request, onUpdate: (update) => request.onUpdate?.({ ...update, activeMs: (time.usedMs ?? 0) + elapsed(), endsAt: time.endsAt }) }, edits);

  const controller = new AbortController();
  activeControllers.add(controller);
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  let deadline: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => { expired = true; controller.abort(new Error("Assignment time limit reached")); }, Math.max(0, time.endsAt - Date.now()));
  };
  arm();
  try {
    const systemPrompt = request.systemPrompt ?? compilePrompt({ domain: request.domain, role: request.role, ...request.context });
    const left = Math.max(1, time.endsAt - Date.now());
    const reportMs = Math.min(REPORT_GRACE_MS, Math.floor(left / 4));
    const wrapUp = Math.floor(left * (request.wrapUpAt || 0.75));
    const onTimeUp = time?.onTimeUp;
    const result = await runPiAgent({
      cwd: request.cwd,
      agent: { runId: base.runId, taskId: request.taskId, domain: request.domain, role: request.role },
      delegationQuota: quota,
      ...(request.expert ? { expert: request.expert } : {}),
      effort: request.effort,
      effortProfile: request.effortProfile,
      onChildRun: (child) => {
        for (const path of child.edited ?? []) edits.note("edit", { path });
        request.onUpdate?.(child);
      },
      mcpTools: request.mcpTools,
      ...(request.autoCompact === false ? { autoCompact: false } : {}),
      task: request.instruction,
      systemPrompt,
      tools: toolsFor(request),
      model: request.model,
      thinking: request.thinking,
      timeoutMs: left,
      ...(time ? {
        time: {
          hardLimit: true,
          upAtMs: Math.max(1, left - reportMs),
          headsUpAtMs: left >= 4 * 60_000 ? Math.floor(left * 0.75) : 0,
          headsUpMessage: headsUpMessage(left - Math.floor(left * 0.75), time.allotMs),
          upMessage: `bot-lobby: your shared step allowance is nearly spent. Start nothing new; finish or revert the edit in progress and report completed work, verification, failed approaches, blockers, and the next action now.${onTimeUp ? " Include ## Left Off and ## More Time (minutes and reason). Only the user can grant more time." : ""}`,
          graceMs: reportMs,
          ...(onTimeUp ? {
            onTimeUp: async (report: string) => {
              clearTimeout(deadline);
              const waiting = Date.now();
              let extraMs: number;
              try { extraMs = await onTimeUp(live.current(), report); }
              finally { pausedMs += Date.now() - waiting; }
              time.endsAt += Date.now() - waiting;
              if (extraMs > 0) {
                time.endsAt = Date.now() + extraMs;
                live.annotate({ note: `given ${formatMinutes(extraMs)} more`, noteKind: "info" });
              }
              arm();
              return { extraMs, message: carryOnMessage(extraMs) };
            },
          } : {}),
        },
      } : {}),
      signal,
      ...(request.onAsk ? { onAsk: request.onAsk } : {}),
      env: request.onAsk ? { ...request.env, [ASK_ENV]: "1" } : request.env,
      stallTimeoutMs: request.stallTimeoutMs,
      toolStallTimeoutMs: request.toolStallTimeoutMs,
      wrapUpAtMs: wrapUp,
      onEvent: (event) => {
        if (event.type === "asking") { if (!asking) askStarted = Date.now(); asking += 1; clearTimeout(deadline); }
        if (event.type === "answered") { asking = 0; pausedMs += event.waitedMs; }
        live.onEvent(event);
        if (event.type === "answered" && asking === 0) arm();
      },
      onStart: (handle) => request.onStart?.({ runId: base.runId, steer: handle.steer, annotate: live.annotate }),
    }, run);
    const current = live.current();
    const final: AgentRun = {
      ...base,
      status: expired ? "timeout" : result.status,
      output: result.output,
      error: expired ? describeError("hit the shared assignment time limit", current, false) : result.error ? describeError(result.error, current, result.stalled === true) : undefined,
      usage: result.usage,
      finishedAt: new Date().toISOString(),
      activeMs: (time.usedMs ?? 0) + elapsed(),
      turns: current.turns ?? (result.usage.turns || undefined),
      tools: current.tools,
      model: result.model ?? current.model,
      ...(result.stalled ? { stalled: true } : {}),
      ...(result.wrappedUp ? { wrappedUp: true } : {}),
      ...(result.timeUp || expired ? { timeUp: true } : {}),
      ...(result.extendedMs ? { extendedMs: result.extendedMs } : {}),
      note: undefined,
      noteKind: undefined,
    };
    request.onUpdate?.(final);
    return final;
  } catch (error) {
    const final: AgentRun = { ...live.current(), status: expired ? "timeout" : signal.aborted ? "cancelled" : "failed", error: (error as Error).message, activeMs: (time.usedMs ?? 0) + elapsed(), edited: edits.list(), finishedAt: new Date().toISOString(), note: undefined, noteKind: undefined, ...(expired ? { timeUp: true } : {}) };
    request.onUpdate?.(final);
    return final;
  } finally {
    clearTimeout(deadline!);
    time.usedMs = (time.usedMs ?? 0) + elapsed();
    activeControllers.delete(controller);
  }
}

/** Name what the agent was doing when a stall or deadline hit. */
function describeError(error: string, current: AgentRun, stalled: boolean): string {
  if (!stalled && !/time limit/.test(error)) return error;
  const doing = current.activity ? ` while ${current.activity}${current.detail ? ` ${current.detail}` : ""}` : "";
  return `${error}${doing}`;
}

async function mapWithConcurrencyLimit<TIn, TOut>(items: TIn[], concurrency: number, fn: (item: TIn) => Promise<TOut>): Promise<TOut[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  // Every worker settles before a failure is raised, so no caller cleans up under a sibling still running.
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  if (failed) throw failed.reason;
  return results;
}

/** Run independent tasks concurrently, bounded by `limit`. */
export async function mapConcurrent<TIn, TOut>(items: TIn[], limit: number, fn: (item: TIn) => Promise<TOut>): Promise<TOut[]> {
  return mapWithConcurrencyLimit(items, limit, fn);
}

/** Run independent agents concurrently, bounded by `limit`. */
export async function runParallel(requests: AgentRequest[], limit: number, run: ProcessRunner = spawnPiProcess): Promise<AgentRun[]> {
  return mapWithConcurrencyLimit(requests, limit, (request) => runAgent(request, run));
}
