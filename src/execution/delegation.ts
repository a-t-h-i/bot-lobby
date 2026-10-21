import { appendMetrics, metricFromRun } from "../state/metrics.ts";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { AgentRun } from "../schemas/findings.ts";
import type { Domain, Role } from "../schemas/agent.ts";
import { effortFor } from "../classifier/instance.ts";
import { fellShort, profileLabel, routeLabel } from "../classifier/effort.ts";
import { agentProfile, expertProfile } from "../schemas/configuration.ts";
import { loadPrompt } from "../prompts/loader.ts";
import { dataRoot, detectProjectRoot, loadConfig } from "../state/project.ts";
import { EditLog } from "../state/changes.ts";
import { createLiveRun } from "./live-run.ts";
import { runPiAgent, type PiRunOptions, type ProcessRunner } from "./pi-runner.ts";
import { startDeskServer } from "../desk/ipc.ts";
import { DESK_ENV, DeskSession, deskSessionAt, PEER_TOOLS } from "../desk/session.ts";
import { BOARD_ENV } from "../desk/board.ts";
import { mcpGrant } from "../pi/grants.ts";

export const MAX_CHILDREN = 5;
export const DELEGATE_TOOL = "delegate_subtasks";
export const EXPERT_TOOL = "ask_expert";
/** Consults one step may make: advice on the hard part, not a second worker. */
export const MAX_CONSULTS = 2;
/** Longest an expert may take to answer. */
/** Marks an expert's run, so its host gives it an adviser's note rather than a child's. */
export const EXPERT_ENV = "BOT_LOBBY_EXPERT";

/** The worker's env without its desk and board: an expert only reads and answers. */
function withoutTeamEnv(env: Record<string, string> | undefined): Record<string, string> {
  const { [DESK_ENV.address]: _address, [DESK_ENV.worker]: _worker, [BOARD_ENV]: _board, BOT_LOBBY_BOARD_FROM: _from, ...rest } = env ?? {};
  return rest;
}
const EXPERT_TOOLS = ["read", "grep", "find", "ls"];
export const AGENT_ENV = "BOT_LOBBY_AGENT_POLICY";
export const DELEGATION_ENV = "BOT_LOBBY_DELEGATION";

/** Only DESIGN/DEV workers and the QA gate may spawn children. */
export function canDelegate(agent: { role: Role; domain: Domain; depth?: number }, quotaUsed: number): boolean {
  if ((agent.depth ?? 1) !== 1 || quotaUsed >= MAX_CHILDREN) return false;
  if (agent.role === "worker") return agent.domain === "designer" || agent.domain === "backend";
  return agent.role === "reviewer" && agent.domain === "qa";
}

/** A task's DESIGN/DEV workers (not their children, nor quick fixes) may consult a stronger model, when the setting is on. */
export function canConsult(agent: { runId: string; taskId: string; role: Role; domain: Domain; depth?: number }, enabled: boolean): boolean {
  // A lobby job (a quick fix) runs as its own task: it is one agent on a small change, not a task's worker.
  return enabled && agent.taskId !== agent.runId && (agent.depth ?? 1) === 1 && agent.role === "worker" && (agent.domain === "designer" || agent.domain === "backend");
}

/** One shared child pool per task; parents waiting on children never hold its slots. */
const pools = new Map<string, { active: number; users: number; waiters: Array<() => void> }>();

async function inPool<T>(key: string, limit: number, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const pool = pools.get(key)!;
  while (pool.active >= limit) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const wake = () => { signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => { pool.waiters = pool.waiters.filter((entry) => entry !== wake); reject(signal.reason); };
      pool.waiters.push(wake);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  signal.throwIfAborted();
  pool.active += 1;
  try { return await work(); }
  finally { pool.active -= 1; pool.waiters.shift()?.(); }
}

export function reserveChildren(quota: { used: number }, briefs: unknown): string[] {
  if (!Array.isArray(briefs) || briefs.length === 0 || briefs.some((brief) => typeof brief !== "string" || !brief.trim() || brief.length > 32_000)) {
    throw new Error("Provide non-empty self-contained briefs, each at most 32,000 characters.");
  }
  if (briefs.length > MAX_CHILDREN - quota.used) throw new Error(`Only ${MAX_CHILDREN - quota.used} of your five child slots remain.`);
  quota.used += briefs.length;
  return briefs.map((brief: string) => brief.trim());
}

export interface AgentPolicy {
  tools: string[];
  mcpTools: string[];
  readOnly: boolean;
  depth: number;
}

/** The host owns quotas, file identities and child lifetimes, outside model context. */
export async function delegationHost(options: PiRunOptions, run: ProcessRunner) {
  const config = loadConfig();
  const id = options.agent?.runId ?? randomUUID();
  const baseTools = options.tools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"];
  const editable = baseTools.includes("edit") || baseTools.includes("write");
  const agent = options.agent ?? { runId: id, taskId: id, domain: "backend" as const, role: editable ? "worker" as const : "reviewer" as const };
  const depth = agent.depth ?? 1;
  const quota = options.delegationQuota ?? { used: 0 };
  const consults = canConsult(agent, config.workflow.consultExpert);
  const tools = [...new Set([...baseTools, "codemode", "tool_search", ...(canDelegate(agent, quota.used) ? [DELEGATE_TOOL] : []), ...(consults ? [EXPERT_TOOL] : [])])];
  // A caller that passes its profile's grant (even an absent one, meaning every connected tool) wins over the role's.
  const mcpTools = mcpGrant("mcpTools" in options ? options.mcpTools : agentProfile(config, agent.domain, agent.role).mcpTools, !editable);
  const policy: AgentPolicy = { tools, mcpTools, readOnly: !editable, depth };
  if (depth > 1) return { tools, mcpTools, env: { ...options.env, [AGENT_ENV]: JSON.stringify(policy), [DELEGATION_ENV]: "" }, note: options.env?.[EXPERT_ENV] ? "You are advising a worker: read what you need, answer its question, and change nothing." : "You are a child agent. Finish only your assigned brief and report evidence to your parent; you cannot delegate further.", close: async () => {}, onStart: options.onStart, children: [] as AgentRun[] };

  const address = options.env?.[DESK_ENV.address];
  let desk = address ? deskSessionAt(address) : undefined;
  if (address && !desk) throw new Error("The inherited file desk is unavailable.");
  const board = options.env?.[BOARD_ENV];
  // A worker with a checkout of its own (no claims on the batch desk) still needs claims among its children.
  const ownedDesk = editable && (!desk || !desk.usesClaims) ? new DeskSession({ cwd: options.cwd, ...(board ? { boardPath: board } : {}) }) : undefined;
  if (ownedDesk) await ownedDesk.open();
  // Children claim files among themselves; the parent keeps the batch desk (and its peers) when it has one.
  const childDesk = ownedDesk ?? desk;
  desk ??= ownedDesk;
  const controller = new AbortController();
  const lifetime = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const childSignal = () => lifetime;
  const key = `${options.cwd}:${agent.taskId}`;
  const pool = pools.get(key) ?? { active: 0, users: 0, waiters: [] };
  pool.users += 1;
  pools.set(key, pool);
  const children = new Map<string, AgentRun>();
  const pending = new Set<Promise<AgentRun>>();
  const parentDeskId = options.env?.[DESK_ENV.worker] ?? id;
  const update = (child: AgentRun) => {
    children.set(child.runId, child);
    options.onChildRun?.(child);
    if (child.status === "running") return;
    // Keep full child reports outside the parent's bounded tool result, including lobby jobs.
    const root = detectProjectRoot(options.cwd, CONFIG_DIR_NAME);
    const folder = join(dataRoot(root, CONFIG_DIR_NAME), "delegations");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${child.runId}.json`), `${JSON.stringify(child)}\n`);
    if (!options.agent || options.agent.taskId === options.agent.runId) appendMetrics(root, CONFIG_DIR_NAME, [metricFromRun(child)]);
  };

  const childRun = async (brief: string, signal: AbortSignal): Promise<AgentRun> => {
    const childId = randomUUID();
    const base: AgentRun = { runId: childId, parentRunId: id, depth: 2, taskId: agent.taskId, domain: agent.domain, role: agent.role, instruction: brief, stepInstruction: options.task, status: "running", output: "", attempts: 1, startedAt: new Date().toISOString(), ...(options.thinking ? { thinking: options.thinking } : {}) };
    const edits = new EditLog(options.cwd);
    const live = createLiveRun(base, { onUpdate: update }, edits);
    update(base);
    try {
      const configured = options.effortProfile ?? { model: options.model, thinking: options.thinking ?? "medium" };
      const effort = options.effort ?? effortFor();
      const route = await effort.childRoute?.(brief, configured, { context: options.task, signal }).catch(() => undefined);
      const attempt = async (model: string | undefined, thinking: string) => {
        signal.throwIfAborted();
        const routed = route && model === route.model && thinking === route.thinking;
        live.annotate({ model, thinking, route: routed ? routeLabel(route) : undefined, routedFrom: routed ? profileLabel(route.from) : undefined, note: routed ? routeLabel(route) : undefined, noteKind: "info" });
        return runPiAgent({
        ...options,
        agent: { ...agent, runId: childId, depth: 2 },
        task: brief,
        model,
        thinking,
        tools: [...new Set([...tools.filter((tool) => tool !== DELEGATE_TOOL && tool !== EXPERT_TOOL), ...(childDesk ? childDesk.tools().filter((tool) => !PEER_TOOLS.includes(tool)) : [])])],
        mcpTools,
        signal,
        delegationQuota: undefined,
        onChildRun: undefined,
        onEvent: live.onEvent,
        env: { ...options.env, ...(childDesk ? childDesk.env(childId) : {}) },
        onStart: (handle) => childDesk?.attach(childId, { runId: childId, steer: handle.steer, annotate: live.annotate }),
      }, run);
      };
      let result = await attempt(route?.model ?? configured.model, route?.thinking ?? configured.thinking);
      let retried = false;
      if (route && (route.level === "simple" || route.level === "trivial") && fellShort(result) && !signal.aborted) {
        retried = true;
        result = await attempt(configured.model, configured.thinking);
      }
      const final: AgentRun = { ...live.current(), ...result, thinking: retried ? configured.thinking : route?.thinking ?? configured.thinking, attempts: retried ? 2 : 1, ...(route && !retried ? { route: routeLabel(route), routedFrom: profileLabel(route.from) } : {}), edited: edits.list(), finishedAt: new Date().toISOString(), note: undefined, noteKind: undefined };
      update(final);
      return final;
    } catch (error) {
      const final: AgentRun = { ...live.current(), edited: edits.list(), status: signal.aborted ? "cancelled" : "failed", error: (error as Error).message, finishedAt: new Date().toISOString(), note: undefined, noteKind: undefined };
      update(final);
      return final;
    } finally {
      childDesk?.release(childId, () => "Child finished; re-read the file and check its report before continuing.");
    }
  };

  // Kept on the quota, which a step's retries share, so a retry does not grant fresh consults.
  quota.consults ??= 0;
  const consultations = new Map<string, AbortController>();
  const consult = async (question: string, signal: AbortSignal): Promise<{ ok: boolean; text: string }> => {
    // The oracle resolves the expert (its session model when settings name none); settings alone, then the worker's own, without it.
    const settled = options.expert ?? expertProfile(config);
    const expert = { model: settled.model ?? options.model, thinking: settled.thinking };
    const expertId = randomUUID();
    const base: AgentRun = { runId: expertId, parentRunId: id, depth: 2, taskId: agent.taskId, domain: agent.domain, role: "reviewer", instruction: question, stepInstruction: options.task, status: "running", output: "", attempts: 1, startedAt: new Date().toISOString(), thinking: expert.thinking, ...(expert.model ? { model: expert.model } : {}), note: "expert consult", noteKind: "info" };
    const live = createLiveRun(base, { onUpdate: update }, new EditLog(options.cwd));
    update(base);
    let final: AgentRun;
    try {
      const result = await runPiAgent({
        cwd: options.cwd,
        agent: { ...agent, runId: expertId, role: "reviewer", depth: 2 },
        task: [`A worker asks: ${question}`, `The worker's brief, for context:\n${options.task.slice(0, 8000)}`].join("\n\n"),
        systemPrompt: loadPrompt("expert.md"),
        tools: EXPERT_TOOLS,
        mcpTools: [],
        ...(expert.model ? { model: expert.model } : {}),
        thinking: expert.thinking,
        ...(options.stallTimeoutMs !== undefined ? { stallTimeoutMs: options.stallTimeoutMs } : {}),
        ...(options.toolStallTimeoutMs !== undefined ? { toolStallTimeoutMs: options.toolStallTimeoutMs } : {}),
        signal,
        onEvent: live.onEvent,
        // Its own env: the expert is not one of the worker's children, nor on its desk or board.
        env: { ...withoutTeamEnv(options.env), [EXPERT_ENV]: "1" },
      }, run);
      final = { ...live.current(), ...result, finishedAt: new Date().toISOString(), note: undefined, noteKind: undefined };
    } catch (error) {
      final = { ...live.current(), status: signal.aborted ? "cancelled" : "failed", error: (error as Error).message, finishedAt: new Date().toISOString(), note: undefined, noteKind: undefined };
    }
    update(final);
    if (final.status === "success" && final.output.trim()) return { ok: true, text: final.output.trim().slice(0, 8000) };
    // An expert that never answered does not use up a consult.
    quota.consults = Math.max(0, (quota.consults ?? 1) - 1);
    return { ok: false, text: `The expert did not answer (${final.status}${final.error ? `: ${final.error}` : ""}); carry on with your best reading.` };
  };

  const token = randomUUID();
  const server = await startDeskServer(async (request) => {
    if (request.worker !== token) return { ok: false, text: "Unknown parent agent." };
    if (request.op === "cancel_delegate") { controller.abort(); return { ok: true, text: "Children cancelled." }; }
    if (request.op === "cancel_consult") {
      consultations.get(request.consultId ?? "")?.abort();
      return { ok: true, text: "Consult cancelled." };
    }
    if (request.op === "consult") {
      if (!consults) return { ok: false, text: "Consulting is off for this agent." };
      if ((quota.consults ?? 0) >= MAX_CONSULTS) return { ok: false, text: `You have used your ${MAX_CONSULTS} consults for this step; decide with what you have, or report the open question.` };
      const question = (request.text ?? "").trim();
      if (!question) return { ok: false, text: "ask_expert needs a question." };
      quota.consults = (quota.consults ?? 0) + 1;
      // Its own controller, so the worker abandoning its tool call stops this expert and nothing else.
      const own = new AbortController();
      const parent = childSignal();
      const stop = () => own.abort();
      parent.addEventListener("abort", stop, { once: true });
      const consultId = request.consultId ?? randomUUID();
      consultations.set(consultId, own);
      try {
        return await consult(question.slice(0, 6000), own.signal);
      } finally {
        consultations.delete(consultId);
        parent.removeEventListener("abort", stop);
      }
    }
    if (request.op !== "delegate") return { ok: false, text: "Unknown delegation operation." };
    const signal = childSignal();
    signal.throwIfAborted();
    const briefs = reserveChildren(quota, request.briefs);
    // A coordinating parent must release claims before waiting for children that may need them.
    for (const held of new Set([desk, childDesk])) held?.releaseFiles(parentDeskId, () => "Delegating this work; re-read before editing.");
    const runs = briefs.map((brief) => {
      const promise = inPool(key, Math.max(1, config.workflow.maxParallelWorkers), signal, () => childRun(brief, signal));
      pending.add(promise);
      void promise.finally(() => pending.delete(promise)).catch(() => {});
      return promise;
    });
    const results = await Promise.all(runs);
    return { ok: true, text: JSON.stringify(results.map((child) => ({ runId: child.runId, status: child.status, report: child.output.slice(0, 12_000), reportPath: join(dataRoot(detectProjectRoot(options.cwd, CONFIG_DIR_NAME), CONFIG_DIR_NAME), "delegations", `${child.runId}.json`), error: child.error, usage: child.usage }))) };
  }, () => controller.abort()).catch(async (error) => {
    if (ownedDesk) await ownedDesk.close();
    pool.users -= 1;
    if (pool.users === 0) pools.delete(key);
    throw error;
  });

  let closed = false;
  return {
    tools: desk ? [...new Set([...tools, ...desk.tools()])] : tools,
    mcpTools,
    env: { ...options.env, ...(desk ? desk.env(parentDeskId) : {}), [AGENT_ENV]: JSON.stringify({ ...policy, tools: desk ? [...new Set([...tools, ...desk.tools()])] : tools }), [DELEGATION_ENV]: JSON.stringify({ address: server.address, token }) },
    note: `${consults ? `When you are stuck on a hard step after a real attempt, or about to make a choice you are unsure of (a tricky algorithm, a subtle bug, an unfamiliar API), ${EXPERT_TOOL} asks a stronger model for advice, at most ${MAX_CONSULTS} times; it reads the repository and answers, you still do the work. ` : ""}${canDelegate(agent, quota.used) ? `Work directly when you can finish the brief yourself. Use ${DELEGATE_TOOL} only for useful, separable work with disjoint files, at most five children total; children cannot delegate further. Integrate and verify their work yourself. ` : ""}Use codemode for concise parallel calls, inspect failures, and return only useful evidence.${desk?.usesClaims ? " Before edit/write, claim_file; handover_file when finished. Release files before delegating or waiting." : ""}`,
    onStart: (handle: Parameters<NonNullable<PiRunOptions["onStart"]>>[0]) => {
      desk?.attach(parentDeskId, { runId: id, steer: handle.steer, annotate: () => {} });
      options.onStart?.(handle);
    },
    get children() { return [...children.values()]; },
    async close() {
      if (closed) return;
      closed = true;
      controller.abort();
      await Promise.allSettled([...pending]);
      await server.close();
      if (ownedDesk) { ownedDesk.release(parentDeskId, () => "Parent finished; re-read before editing."); await ownedDesk.close(); }
      pool.users -= 1;
      if (pool.users === 0) pools.delete(key);
    },
  };
}
