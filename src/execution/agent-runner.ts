import { randomUUID } from "node:crypto";
import { createLiveRun } from "./live-run.ts";
import type { Domain, Role } from "../schemas/agent.ts";
import type { AgentRun } from "../schemas/findings.ts";
import { roleSpec } from "../roles/registry.ts";
import { compilePrompt } from "../prompts/compiler.ts";
import { EditLog } from "../state/changes.ts";
import { runPiAgent, spawnPiProcess, type ProcessRunner, type RelayAsk } from "./pi-runner.ts";
import { KNOWLEDGE_TOOLS, TASK_ID_ENV } from "../knowledge/catalog-tools.ts";
import { ASK_ENV } from "../ask/relay.ts";
import type { EffortRouter, RunProfileLike } from "../classifier/effort.ts";
import { ASK_TOOL } from "../ask/types.ts";
import type { HarnessRun } from "../schemas/harness.ts";

export interface AgentContext {
  task: string;
  standards?: string;
  knowledge?: string;
  decisions?: string;
  /** Assignment bookmarks: bounded reference metadata pointing into the knowledge catalogue. */
  bookmarks?: string;
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
  /** Tokens at which this agent compacts, when its settings set it. */
  compactAt?: number;
  delegationQuota?: { used: number; consults?: number };
  /** See PiRunOptions.expert. */
  expert?: { model?: string; thinking: string };
  thinking?: string;
  /** Skill files this agent may load; absent keeps pi's own discovery. */
  skills?: string[];
  cwd: string;
  signal?: AbortSignal;
  onUpdate?: (run: AgentRun) => void;
  /** Bounded retries for transient failures (crash/stall). */
  retries?: number;
  /** Kill after this long without output; 0 or absent disables. */
  stallTimeoutMs?: number;
  /** Silence allowed while one tool call runs. */
  toolStallTimeoutMs?: number;
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
  /** Lets the agent ask the user (ask_user_question, relayed through the master). */
  onAsk?: RelayAsk;
  /** Run on this third-party harness instead of pi. */
  harness?: HarnessRun;
}

/** The watchdog fields of an AgentRequest, taken from the workflow config. */
export function watchdogOptions(workflow: {
  maxAgentRetries: number;
  stallTimeoutMs: number;
  toolStallTimeoutMs: number;
}): Pick<AgentRequest, "retries" | "stallTimeoutMs" | "toolStallTimeoutMs"> {
  return {
    retries: workflow.maxAgentRetries,
    stallTimeoutMs: workflow.stallTimeoutMs,
    toolStallTimeoutMs: workflow.toolStallTimeoutMs,
  };
}

const activeControllers = new Set<AbortController>();

/** A stall or crash is worth one more try; a cancel is not. */
function retryable(run: AgentRun): boolean {
  if (run.status === "failed") return true;
  return run.status === "timeout" && run.stalled === true;
}

/**
 * Run one domain/role agent, retrying transient failures a bounded number of
 * times. Cancellation never retries, so Esc stays responsive. There is no
 * time limit: an agent works until it reports, is cancelled, or stalls.
 */
export async function runAgent(request: AgentRequest, run: ProcessRunner = spawnPiProcess): Promise<AgentRun> {
  const startedAt = new Date().toISOString();
  const attempts = Math.max(1, (request.retries ?? 0) + 1);
  // A failed attempt may have edited files before the retry: the run owns every edit.
  const edits = new EditLog(request.cwd);
  let last: AgentRun | undefined;
  const quota = request.delegationQuota ??= { used: 0 };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await runAgentOnce(request, run, attempt, startedAt, edits, quota);
    request.onAttemptEnd?.(last);
    if (!retryable(last)) break;
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
    ...(attempts > 1 ? { note: `retry ${attempts - 1} of ${(request.retries ?? 0)}`, noteKind: "warning" as const } : {}),
  };
}

/** Compiled repository roles may read knowledge; prompt contents never confer access. */
function hasKnowledgeAccess(request: AgentRequest): boolean {
  return request.systemPrompt === undefined && ["scout", "worker", "reviewer"].includes(request.role);
}

function toolsFor(request: AgentRequest): readonly string[] | undefined {
  const tools = roleSpec(request.role).tools;
  const extra = [...(request.extraTools ?? []), ...(hasKnowledgeAccess(request) ? KNOWLEDGE_TOOLS : []), ...(request.onAsk ? [ASK_TOOL] : [])];
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
  const attemptStart = Date.now();
  let pausedMs = 0;
  let asking = 0;
  let askStarted = 0;
  const elapsed = () => Math.max(0, Date.now() - attemptStart - pausedMs - (asking ? Date.now() - askStarted : 0));
  const live = createLiveRun(base, { onUpdate: (update) => request.onUpdate?.({ ...update, activeMs: elapsed() }) }, edits);

  const controller = new AbortController();
  activeControllers.add(controller);
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  try {
    const systemPrompt = request.systemPrompt ?? compilePrompt({ domain: request.domain, role: request.role, ...request.context });
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
      ...(request.skills ? { skills: request.skills } : {}),
      ...(request.autoCompact === false ? { autoCompact: false } : {}),
      ...(request.compactAt ? { compactAt: request.compactAt } : {}),
      task: request.instruction,
      systemPrompt,
      tools: toolsFor(request),
      model: request.model,
      thinking: request.thinking,
      signal,
      ...(request.onAsk ? { onAsk: request.onAsk } : {}),
      ...(request.harness ? { harness: request.harness } : {}),
      env: { ...request.env, [TASK_ID_ENV]: request.taskId, ...(request.onAsk ? { [ASK_ENV]: "1" } : {}) },
      stallTimeoutMs: request.stallTimeoutMs,
      toolStallTimeoutMs: request.toolStallTimeoutMs,
      onEvent: (event) => {
        if (event.type === "asking") { if (!asking) askStarted = Date.now(); asking += 1; }
        if (event.type === "answered") { asking = 0; pausedMs += event.waitedMs; }
        live.onEvent(event);
      },
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
      activeMs: elapsed(),
      turns: current.turns ?? (result.usage.turns || undefined),
      tools: current.tools,
      model: result.model ?? current.model,
      ...(result.stalled ? { stalled: true } : {}),
      note: undefined,
      noteKind: undefined,
    };
    request.onUpdate?.(final);
    return final;
  } catch (error) {
    const final: AgentRun = { ...live.current(), status: signal.aborted ? "cancelled" : "failed", error: (error as Error).message, activeMs: elapsed(), edited: edits.list(), finishedAt: new Date().toISOString(), note: undefined, noteKind: undefined };
    request.onUpdate?.(final);
    return final;
  } finally {
    activeControllers.delete(controller);
  }
}

/** Name what the agent was doing when a stall hit. */
function describeError(error: string, current: AgentRun, stalled: boolean): string {
  if (!stalled) return error;
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
