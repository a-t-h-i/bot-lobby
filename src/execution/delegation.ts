import { toolsOf } from "../excalidraw/sessions.ts";
import { appendMetrics, metricFromRun } from "../state/metrics.ts";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { AgentRun } from "../schemas/findings.ts";
import { agentProfile } from "../schemas/configuration.ts";
import { dataRoot, detectProjectRoot, loadConfig } from "../state/project.ts";
import { EditLog } from "../state/changes.ts";
import { createLiveRun } from "./live-run.ts";
import { runPiAgent, type PiRunOptions, type ProcessRunner } from "./pi-runner.ts";
import { startDeskServer } from "../desk/ipc.ts";
import { DESK_ENV, DESK_TOOLS, DeskSession, deskSessionAt } from "../desk/session.ts";

export const MAX_CHILDREN = 5;
export const DELEGATE_TOOL = "delegate_subtasks";
export const AGENT_ENV = "BOT_LOBBY_AGENT_POLICY";
export const DELEGATION_ENV = "BOT_LOBBY_DELEGATION";

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

/** The host owns quotas, deadlines, file identities and child lifetimes, outside model context. */
export async function delegationHost(options: PiRunOptions, run: ProcessRunner) {
  const config = loadConfig();
  const id = options.agent?.runId ?? randomUUID();
  const baseTools = options.tools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"];
  const editable = baseTools.includes("edit") || baseTools.includes("write");
  const agent = options.agent ?? { runId: id, taskId: id, domain: "backend" as const, role: editable ? "worker" as const : "reviewer" as const };
  const depth = agent.depth ?? 1;
  const quota = options.delegationQuota ?? { used: 0 };
  const tools = [...new Set([...baseTools, ...(options.excalidraw ? toolsOf(options.excalidraw) : []), "codemode", "tool_search", ...(depth === 1 ? [DELEGATE_TOOL] : [])])];
  const mcpTools = options.mcpTools ?? agentProfile(config, agent.domain, agent.role).mcpTools ?? [];
  const policy: AgentPolicy = { tools, mcpTools, readOnly: !editable, depth };
  if (depth > 1) return { tools, env: { ...options.env, [AGENT_ENV]: JSON.stringify(policy), [DELEGATION_ENV]: "" }, note: "You are a child agent. Finish only your assigned brief and report evidence to your parent; you cannot delegate further.", close: async () => {}, onStart: options.onStart, children: [] as AgentRun[] };

  const address = options.env?.[DESK_ENV.address];
  let desk = address ? deskSessionAt(address) : undefined;
  if (address && !desk) throw new Error("The inherited file desk is unavailable.");
  const ownedDesk = editable && !desk ? new DeskSession({ cwd: options.cwd }) : undefined;
  if (ownedDesk) { await ownedDesk.open(); desk = ownedDesk; }
  const controller = new AbortController();
  const lifetime = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let timeController = new AbortController();
  const childSignal = () => AbortSignal.any([lifetime, timeController.signal]);
  const key = `${options.cwd}:${agent.taskId}`;
  const pool = pools.get(key) ?? { active: 0, users: 0, waiters: [] };
  pool.users += 1;
  pools.set(key, pool);
  let deadlineAt = Date.now() + (options.time?.upAtMs ?? options.timeoutMs);
  let deadline = setTimeout(() => timeController.abort(), Math.max(1, deadlineAt - Date.now()));
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
    const live = createLiveRun(base, { onUpdate: update, timeoutMs: options.timeoutMs }, edits);
    update(base);
    try {
      const left = deadlineAt - Date.now();
      if (left <= 0) throw new Error("The parent's time is up.");
      const result = await runPiAgent({
        ...options,
        agent: { ...agent, runId: childId, depth: 2 },
        task: brief,
        tools: [...new Set([...tools.filter((tool) => tool !== DELEGATE_TOOL), ...(desk ? DESK_TOOLS : [])])],
        mcpTools,
        timeoutMs: left,
        signal,
        time: undefined,
        wrapUpAtMs: Math.floor(left * 0.85),
        delegationQuota: undefined,
        onChildRun: undefined,
        onEvent: live.onEvent,
        env: { ...options.env, ...(desk ? desk.env(childId) : {}) },
        onStart: (handle) => desk?.attach(childId, { runId: childId, steer: handle.steer, annotate: live.annotate }),
      }, run);
      const final: AgentRun = { ...live.current(), ...result, edited: edits.list(), finishedAt: new Date().toISOString(), note: undefined, noteKind: undefined };
      update(final);
      return final;
    } catch (error) {
      const final: AgentRun = { ...live.current(), edited: edits.list(), status: signal.aborted ? "cancelled" : "failed", error: (error as Error).message, finishedAt: new Date().toISOString() };
      update(final);
      return final;
    } finally {
      desk?.release(childId, () => "Child finished; re-read the file and check its report before continuing.");
    }
  };

  const token = randomUUID();
  const server = await startDeskServer(async (request) => {
    if (request.worker !== token) return { ok: false, text: "Unknown parent agent." };
    if (request.op === "cancel_delegate") { controller.abort(); return { ok: true, text: "Children cancelled." }; }
    if (request.op !== "delegate") return { ok: false, text: "Unknown delegation operation." };
    const signal = childSignal();
    signal.throwIfAborted();
    const briefs = reserveChildren(quota, request.briefs);
    // A coordinating parent must release claims before waiting for children that may need them.
    desk?.releaseFiles(parentDeskId, () => "Delegating this work; re-read before editing.");
    const runs = briefs.map((brief) => {
      const promise = inPool(key, Math.max(1, config.workflow.maxParallelWorkers), signal, () => childRun(brief, signal));
      pending.add(promise);
      void promise.finally(() => pending.delete(promise)).catch(() => {});
      return promise;
    });
    const results = await Promise.all(runs);
    return { ok: true, text: JSON.stringify(results.map((child) => ({ runId: child.runId, status: child.status, report: child.output.slice(0, 12_000), reportPath: join(dataRoot(detectProjectRoot(options.cwd, CONFIG_DIR_NAME), CONFIG_DIR_NAME), "delegations", `${child.runId}.json`), error: child.error, usage: child.usage }))) };
  }, () => controller.abort()).catch(async (error) => {
    clearTimeout(deadline);
    if (ownedDesk) await ownedDesk.close();
    pool.users -= 1;
    if (pool.users === 0) pools.delete(key);
    throw error;
  });

  let closed = false;
  return {
    tools: desk ? [...new Set([...tools, ...DESK_TOOLS])] : tools,
    env: { ...options.env, ...(desk ? desk.env(parentDeskId) : {}), [AGENT_ENV]: JSON.stringify({ ...policy, tools: desk ? [...new Set([...tools, ...DESK_TOOLS])] : tools }), [DELEGATION_ENV]: JSON.stringify({ address: server.address, token, timeoutMs: options.timeoutMs }) },
    note: `For substantial, separable work, use ${DELEGATE_TOOL} with complete briefs (goal, files, contracts, constraints, done criteria). You have at most five children total; children cannot delegate. Integrate and verify their work yourself. Use codemode for concise parallel calls, inspect failures, and return only useful evidence.${desk ? " Before edit/write, claim_file; handover_file when finished. Release files before delegating or waiting." : ""}`,
    onStart: (handle: Parameters<NonNullable<PiRunOptions["onStart"]>>[0]) => {
      desk?.attach(parentDeskId, { runId: id, steer: handle.steer, annotate: () => {} });
      options.onStart?.(handle);
    },
    get children() { return [...children.values()]; },
    pause() { clearTimeout(deadline); },
    extend(ms: number, reset = false) {
      deadlineAt = reset ? Date.now() + ms : deadlineAt + ms;
      clearTimeout(deadline);
      if (timeController.signal.aborted) timeController = new AbortController();
      deadline = setTimeout(() => timeController.abort(), Math.max(1, deadlineAt - Date.now()));
    },
    async close() {
      if (closed) return;
      closed = true;
      controller.abort();
      clearTimeout(deadline);
      await Promise.allSettled([...pending]);
      await server.close();
      if (ownedDesk) { desk?.release(parentDeskId, () => "Parent finished; re-read before editing."); await ownedDesk.close(); }
      pool.users -= 1;
      if (pool.users === 0) pools.delete(key);
    },
  };
}
