import type { Domain, Role } from "../schemas/agent.ts";
import type { AgentRun } from "../schemas/findings.ts";
import { roleSpec } from "../roles/registry.ts";
import { compilePrompt } from "../prompts/compiler.ts";
import { activityDetail, activityWord, describeToolCall } from "../pi/activity.ts";
import { shortDuration, truncate } from "../text.ts";
import { EditLog } from "../state/changes.ts";
import { formatMinutes, REPORT_GRACE_MS } from "../state/budget.ts";
import { runPiAgent, spawnPiProcess, type PiStreamEvent, type ProcessRunner, type RelayAsk } from "./pi-runner.ts";
import { ASK_ENV } from "../ask/relay.ts";
import { ASK_TOOL } from "../ask/types.ts";
import { agentOfRun, grantOption } from "../excalidraw/sessions.ts";

export interface AgentContext {
  task: string;
  standards?: string;
  knowledge?: string;
  decisions?: string;
  /** Per-agent custom instructions from the global config. */
  instructions?: string;
  workflowContext?: string;
}

/** Live fields a caller (the file desk) may set on a running agent. */
export type LivePatch = Pick<AgentRun, "note" | "noteKind" | "waitingFor">;

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
  /** Concrete instruction sent as the subagent's task message. */
  instruction: string;
  /** Prompt layers selected for this run. */
  context: AgentContext;
  model?: string;
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
  const startedAt = new Date().toISOString();
  const attempts = Math.max(1, (request.retries ?? 0) + 1);
  // A failed attempt may have edited files before the retry: the run owns every edit.
  const edits = new EditLog(request.cwd);
  let last: AgentRun | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await runAgentOnce(request, run, attempt, startedAt, edits);
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
async function runAgentOnce(request: AgentRequest, run: ProcessRunner, attempt: number, startedAt: string, edits: EditLog): Promise<AgentRun> {
  const base = baseRun(request, `${request.taskId}:${request.domain}:${request.role}:${Date.now().toString(36)}`, startedAt, attempt);
  request.onUpdate?.(base);
  const live = createLiveRun(base, request, edits);

  const controller = new AbortController();
  activeControllers.add(controller);
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  try {
    const systemPrompt = compilePrompt({ domain: request.domain, role: request.role, ...request.context });
    const time = request.time;
    const left = time ? Math.max(MIN_ATTEMPT_MS, time.endsAt - Date.now()) : 0;
    const wrapUp = time ? 0 : request.wrapUpAt && request.wrapUpAt > 0 && request.wrapUpAt < 1 ? Math.floor(request.timeoutMs * request.wrapUpAt) : 0;
    const onTimeUp = time?.onTimeUp;
    const result = await runPiAgent({
      cwd: request.cwd,
      task: request.instruction,
      systemPrompt,
      tools: toolsFor(request),
      model: request.model,
      thinking: request.thinking,
      timeoutMs: time ? left + REPORT_GRACE_MS : request.timeoutMs,
      ...(time ? {
        time: {
          upAtMs: left,
          headsUpAtMs: left >= 4 * 60_000 ? Math.floor(left * 0.75) : 0,
          headsUpMessage: headsUpMessage(left - Math.floor(left * 0.75), time.allotMs),
          upMessage: timeUpMessage(time.allotMs, Boolean(onTimeUp)),
          graceMs: REPORT_GRACE_MS,
          ...(onTimeUp ? {
            onTimeUp: async (report: string) => {
              const extraMs = await onTimeUp(live.current(), report);
              if (extraMs > 0) {
                time.endsAt = Date.now() + extraMs;
                live.annotate({ note: `given ${formatMinutes(extraMs)} more`, noteKind: "info" });
              }
              return { extraMs, message: carryOnMessage(extraMs) };
            },
          } : {}),
        },
      } : {}),
      signal,
      ...(request.onAsk ? { onAsk: request.onAsk } : {}),
      ...grantOption(agentOfRun(request.domain, request.role)),
      env: request.onAsk ? { ...request.env, [ASK_ENV]: "1" } : request.env,
      stallTimeoutMs: request.stallTimeoutMs,
      toolStallTimeoutMs: request.toolStallTimeoutMs,
      wrapUpAtMs: wrapUp,
      onEvent: live.onEvent,
      onStart: (handle) => request.onStart?.({ runId: base.runId, steer: handle.steer, annotate: live.annotate }),
    }, run);
    const current = live.current();
    const final: AgentRun = {
      ...base,
      status: result.status,
      output: result.output,
      error: result.error ? describeError(result.error, current, result.stalled === true) : undefined,
      usage: result.usage,
      finishedAt: new Date().toISOString(),
      turns: current.turns ?? (result.usage.turns || undefined),
      tools: current.tools,
      model: result.model ?? current.model,
      ...(result.stalled ? { stalled: true } : {}),
      ...(result.wrappedUp ? { wrappedUp: true } : {}),
      ...(result.timeUp ? { timeUp: true } : {}),
      ...(result.extendedMs ? { extendedMs: result.extendedMs } : {}),
      note: undefined,
      noteKind: undefined,
    };
    request.onUpdate?.(final);
    return final;
  } finally {
    activeControllers.delete(controller);
  }
}

/** Name what the agent was doing when a stall or deadline hit. */
function describeError(error: string, current: AgentRun, stalled: boolean): string {
  if (!stalled && !/time limit/.test(error)) return error;
  const doing = current.activity ? ` while ${current.activity}${current.detail ? ` ${current.detail}` : ""}` : "";
  return `${error}${doing}`;
}

const THROTTLE_MS = 2000;

/**
 * Tracks one attempt's live state from its stream and reports it through
 * `onUpdate`: activity changes, retries and notes immediately, counters and
 * heartbeats at most every couple of seconds.
 */
function createLiveRun(base: AgentRun, request: AgentRequest, edits: EditLog) {
  let state: AgentRun = base;
  let lastEmit = 0;
  const emit = (patch: Partial<AgentRun>, force: boolean) => {
    state = { ...state, ...patch, lastEventAt: Date.now() };
    const now = Date.now();
    if (!force && now - lastEmit < THROTTLE_MS) return;
    lastEmit = now;
    request.onUpdate?.(state);
  };
  const changed = (activity: string, detail: string | undefined) => activity !== state.activity || detail !== state.detail;
  const onEvent = (event: PiStreamEvent) => {
    switch (event.type) {
      case "tool_execution_start": {
        edits.note(event.toolName, event.args);
        const activity = activityWord(event.toolName);
        const detail = activityDetail(event.toolName, event.args);
        const step = describeToolCall(event.toolName, event.args);
        emit({ activity, detail, step, tools: (state.tools ?? 0) + 1 }, changed(activity, detail) || step !== state.step);
        return;
      }
      case "thought":
        emit({ thought: event.text }, true);
        return;
      case "thinking":
      case "writing":
        emit({ activity: event.type, detail: undefined }, changed(event.type, undefined));
        return;
      case "turn_start":
        emit({ turns: (state.turns ?? 0) + 1 }, false);
        return;
      case "retry":
        emit({ note: `provider retry ${event.attempt}/${event.maxAttempts}: ${truncateLine(event.error)}`, noteKind: "warning" }, true);
        return;
      case "retry_end":
        emit({ note: undefined, noteKind: undefined }, true);
        return;
      case "compaction":
        emit({ note: "compacting context", noteKind: "info" }, true);
        return;
      case "wrap_up":
        emit({ note: `asked to wrap up (${shortDuration(request.timeoutMs)} limit)`, noteKind: "warning", wrappedUp: true }, true);
        return;
      case "time_up":
        emit({ note: request.time?.onTimeUp ? "out of time: reporting where it left off" : "out of time: reporting", noteKind: "warning" }, true);
        return;
      case "extended":
        emit({ endsAt: request.time?.endsAt, extendedMs: (state.extendedMs ?? 0) + event.ms }, true);
        return;
      case "asking":
        emit({ note: `waiting on you: ${event.questions} question${event.questions === 1 ? "" : "s"}`, noteKind: "info" }, true);
        return;
      case "answered":
        // Its time waited with it.
        if (request.time) request.time.endsAt += event.waitedMs;
        emit({ note: "you answered; carrying on", noteKind: "info", ...(request.time ? { endsAt: request.time.endsAt } : {}) }, true);
        return;
      case "usage": {
        const usage = state.usage ?? { input: 0, output: 0, cost: 0, turns: 0 };
        const next = { input: usage.input + event.input, output: usage.output + event.output, cost: usage.cost + event.cost, turns: usage.turns + 1 };
        emit({ usage: next, model: event.model ?? state.model }, false);
        return;
      }
      default:
        emit({}, false);
    }
  };
  return {
    onEvent,
    annotate: (patch: LivePatch) => emit(patch, true),
    current: () => state,
  };
}

function truncateLine(text: string): string {
  const first = text.split("\n")[0] ?? "";
  return truncate(first, 48).split("\n")[0]!;
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
  await Promise.all(workers);
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
