import type { Domain, Role } from "../schemas/agent.ts";
import type { AgentRun } from "../schemas/findings.ts";
import { roleSpec } from "../roles/registry.ts";
import { compilePrompt } from "../prompts/compiler.ts";
import { runPiAgent, spawnPiProcess, type ProcessRunner } from "./pi-runner.ts";

export interface AgentContext {
  task: string;
  standards?: string;
  knowledge?: string;
  decisions?: string;
  /** Per-agent custom instructions from the global config. */
  instructions?: string;
  workflowContext?: string;
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
  /** Bounded retries for transient failures (crash/timeout). */
  retries?: number;
}

const activeControllers = new Set<AbortController>();

/**
 * Run one domain/role agent, retrying transient failures a bounded number of
 * times. Cancellation never retries, so Esc/quit stays responsive.
 */
export async function runAgent(request: AgentRequest, run: ProcessRunner = spawnPiProcess): Promise<AgentRun> {
  const startedAt = new Date().toISOString();
  const attempts = Math.max(1, (request.retries ?? 0) + 1);
  let last: AgentRun | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await runAgentOnce(request, run, attempt, startedAt);
    if (last.status === "success" || last.status === "cancelled") break;
  }
  return last!;
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
    status: "running",
    output: "",
    attempts,
    startedAt,
  };
}

/**
 * Run one domain/role agent in an isolated pi process. The role's tool
 * allowlist comes from its spec, so read-only roles cannot modify anything.
 */
async function runAgentOnce(request: AgentRequest, run: ProcessRunner, attempt: number, startedAt: string): Promise<AgentRun> {
  const base = baseRun(request, `${request.taskId}:${request.domain}:${request.role}:${Date.now().toString(36)}`, startedAt, attempt);
  request.onUpdate?.(base);

  const controller = new AbortController();
  activeControllers.add(controller);
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  try {
    const systemPrompt = compilePrompt({ domain: request.domain, role: request.role, ...request.context });
    const result = await runPiAgent({
      cwd: request.cwd,
      task: request.instruction,
      systemPrompt,
      tools: roleSpec(request.role).tools,
      model: request.model,
      thinking: request.thinking,
      timeoutMs: request.timeoutMs,
      signal,
    }, run);
    const final: AgentRun = { ...base, status: result.status, output: result.output, error: result.error, usage: result.usage, finishedAt: new Date().toISOString() };
    request.onUpdate?.(final);
    return final;
  } finally {
    activeControllers.delete(controller);
  }
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

/** Run independent agents concurrently, bounded by `limit`. */
export async function runParallel(requests: AgentRequest[], limit: number, run: ProcessRunner = spawnPiProcess): Promise<AgentRun[]> {
  return mapWithConcurrencyLimit(requests, limit, (request) => runAgent(request, run));
}

function lastOutput(results: AgentRun[]): string {
  return results.length > 0 ? results[results.length - 1]!.output : "";
}

/** Run agents in order, substituting `{previous}` with the prior output. */
export async function runSequential(requests: AgentRequest[], run: ProcessRunner = spawnPiProcess): Promise<AgentRun[]> {
  const results: AgentRun[] = [];
  for (const request of requests) {
    const instruction = request.instruction.includes("{previous}")
      ? request.instruction.replaceAll("{previous}", lastOutput(results))
      : request.instruction;
    const result = await runAgent({ ...request, instruction }, run);
    results.push(result);
    if (result.status !== "success") break;
  }
  return results;
}
