import { appendMetrics, metricFromRun } from "../state/metrics.ts";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { AgentRun } from "../schemas/findings.ts";
import type { Domain, Role } from "../schemas/agent.ts";
import { effortFor } from "../classifier/instance.ts";
import { fellShort, profileLabel, routeLabel } from "../classifier/effort.ts";
import { agentProfile } from "../schemas/configuration.ts";
import { dataRoot, detectProjectRoot, loadConfig } from "../state/project.ts";
import { EditLog } from "../state/changes.ts";
import { createLiveRun } from "./live-run.ts";
import { runPiAgent, type PiRunOptions, type ProcessRunner } from "./pi-runner.ts";
import { openOutputArtifact, type OutputArtifactAccess } from "./output-artifacts.ts";
import { artifactIdentity, startDeskServer, type DeskRequest, type DeskResponse } from "../desk/ipc.ts";
import { assignmentRecord, issueAssignment, loadTask, recordArtifactRef, taskDirFor } from "../state/persistence.ts";
import { persistedRunMarks } from "../state/checkpoint.ts";
import { TERMINAL_STATES, type AssignmentGrant, type AssignmentRecord, type TaskState } from "../schemas/task.ts";
import { DESK_ENV, DeskSession, deskSessionAt } from "../desk/session.ts";
import { BOARD_ENV } from "../desk/board.ts";
import { mcpGrant } from "../pi/grants.ts";

export const MAX_CHILDREN = 5;
export const DELEGATE_TOOL = "delegate_subtasks";
export const DURABLE_OUTPUT_TOOL = "read_durable_output_artifacts";
export const AGENT_ENV = "BOT_LOBBY_AGENT_POLICY";
export const DELEGATION_ENV = "BOT_LOBBY_DELEGATION";

/** Only DESIGN/DEV workers and the QA gate may spawn children. */
export function canDelegate(agent: { role: Role; domain: Domain; depth?: number }, quotaUsed: number): boolean {
  if ((agent.depth ?? 1) !== 1 || quotaUsed >= MAX_CHILDREN) return false;
  if (agent.role === "worker") return agent.domain === "designer" || agent.domain === "backend";
  return agent.role === "reviewer" && agent.domain === "qa";
}

/** One shared child pool per task; parents waiting on children never hold its slots. */
/** A child host: no delegation of its own, but durable reads under its own assignment when issued one. */
async function childHost(options: PiRunOptions, policy: AgentPolicy, tools: string[], mcpTools: string[], artifactTool: string | undefined) {
  const note = "You are a child agent. Finish only your assigned brief and report evidence to your parent; you cannot delegate further.";
  const access = artifactTool ? options.runtimeAccess : undefined;
  if (!access) return { tools, mcpTools, env: { ...options.env, [AGENT_ENV]: JSON.stringify(policy), [DELEGATION_ENV]: "" }, note, close: async () => {}, onStart: options.onStart, children: [] as AgentRun[] };
  const token = randomUUID();
  const server = await startDeskServer(async (request) => {
    if (request.worker !== token) return { ok: false, text: "Unknown parent agent." };
    return artifactPage(access, request);
  }, () => {});
  return { tools, mcpTools, env: { ...options.env, [AGENT_ENV]: JSON.stringify(policy), [DELEGATION_ENV]: JSON.stringify({ address: server.address, token, assignment: access.assignmentId }) }, note, close: async () => { await server.close(); }, onStart: options.onStart, children: [] as AgentRun[] };
}

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

const ARTIFACT_REF_PATTERN = /^O-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** What RuntimeAccess.checkpoint() exposes: task state and run marks, nothing else. */
export interface RuntimeCheckpointView {
  taskState: TaskState;
  runMarks: string[];
}

/** The parent-side scope a child assignment is issued within. */
export interface AssignmentScope {
  taskId: string;
  ownerSessionId: string;
  runId: string;
  worktree: string;
}

/** A child run's identity: a new assignment is minted for it, never credentials reuse. */
export interface ChildIdentity {
  runId: string;
  worktree: string;
  domain: Domain;
  role: Role;
}

/** Assignment-scoped durable authorization: reads only, revalidated live against the task registry. */
export interface RuntimeAccess {
  readonly assignmentId: string;
  readonly ownerSessionId: string;
  authorize(grant: string, kind?: string, ref?: string): boolean;
  readonly artifactAccess: OutputArtifactAccess;
  checkpoint(): RuntimeCheckpointView | undefined;
  issueChild(parentScope: AssignmentScope, child: ChildIdentity): RuntimeAccess | undefined;
  recordArtifact(ref: string): void;
}

export interface RuntimeAccessOptions {
  root: string;
  configDir: string;
  taskId: string;
  ownerSessionId: string;
  runId: string;
  worktree: string;
  domain: Domain;
  role: Role;
  grants?: readonly AssignmentGrant[];
  parentAssignmentId?: string;
  signal?: AbortSignal;
}

/** Issues one assignment identity and returns its live-validated access; the registry is the sole authority. */
export function createRuntimeAccess(options: RuntimeAccessOptions): RuntimeAccess | undefined {
  const issued = issueAssignment(options.root, options.configDir, options.taskId, {
    ownerSessionId: options.ownerSessionId,
    runId: options.runId,
    worktree: options.worktree,
    domain: options.domain,
    role: options.role,
    ...(options.grants ? { grants: options.grants } : {}),
    ...(options.parentAssignmentId ? { parentAssignmentId: options.parentAssignmentId } : {}),
  });
  if (!issued) return undefined;
  const childKeys: string[] = [];
  const view = runtimeView(options, issued, childKeys);
  return {
    assignmentId: issued.id,
    ownerSessionId: issued.ownerSessionId,
    authorize: view.authorize,
    artifactAccess: view.artifactAccess,
    checkpoint: view.checkpoint,
    issueChild: (parentScope, child) => issueChildAccess(options, issued, parentScope, child, childKeys),
    recordArtifact: (ref) => { recordArtifactRef(options.root, options.configDir, options.taskId, ref); },
  };
}

/** Every check re-reads the registry: revoked, cancelled, unowned or terminal always deny. */
function runtimeView(options: RuntimeAccessOptions, issued: AssignmentRecord, childKeys: string[]) {
  const authorize = (grant: string, kind?: string, ref?: string): boolean => {
    if (options.signal?.aborted) return false;
    const record = assignmentRecord(options.root, options.configDir, options.taskId, issued.id);
    if (!record || record.state !== "active" || !record.grants.includes(grant as AssignmentGrant)) return false;
    if (kind === "artifact" && ref !== undefined && !ARTIFACT_REF_PATTERN.test(ref)) return false;
    const task = loadTask(options.root, options.configDir, options.taskId);
    return !!task && task.ownerSessionId === record.ownerSessionId && !TERMINAL_STATES.includes(task.state);
  };
  const artifactAccess: OutputArtifactAccess = {
    repository: options.root,
    worktree: options.worktree,
    taskDir: taskDirFor(options.root, options.configDir, options.taskId),
    taskId: options.taskId,
    callerKey: issued.id,
    allowedCallerKeys: childKeys,
    onRead: (ref) => { recordArtifactRef(options.root, options.configDir, options.taskId, ref); },
    authorize: () => authorize("artifact.read"),
  };
  return { authorize, artifactAccess, checkpoint: () => checkpointView(options, issued, authorize) };
}

/** Run marks pass through an access callback, so an unauthorized caller reads none of them. */
function checkpointView(options: RuntimeAccessOptions, issued: AssignmentRecord, authorize: RuntimeAccess["authorize"]): RuntimeCheckpointView | undefined {
  if (!authorize("checkpoint.read")) return undefined;
  const task = loadTask(options.root, options.configDir, options.taskId);
  if (!task || task.ownerSessionId !== issued.ownerSessionId) return undefined;
  return { taskState: task.state, runMarks: persistedRunMarks(task.checkpoint, () => true) };
}

/** Children get fresh identities within the parent's own scope, with the parent's grants. */
function issueChildAccess(options: RuntimeAccessOptions, issued: AssignmentRecord, parentScope: AssignmentScope, child: ChildIdentity, childKeys: string[]): RuntimeAccess | undefined {
  if (issued.state !== "active") return undefined;
  if (parentScope.taskId !== options.taskId || parentScope.ownerSessionId !== issued.ownerSessionId || parentScope.worktree !== options.worktree) return undefined;
  const access = createRuntimeAccess({ root: options.root, configDir: options.configDir, taskId: options.taskId, ownerSessionId: parentScope.ownerSessionId, runId: child.runId, domain: child.domain, role: child.role, worktree: child.worktree, grants: issued.grants, parentAssignmentId: issued.id, ...(options.signal ? { signal: options.signal } : {}) });
  if (access) childKeys.push(access.assignmentId);
  return access;
}

/** Durable reads under assignment scope: identity, grant and scope revalidate on every page. */
function artifactPage(access: RuntimeAccess | undefined, request: DeskRequest): Omit<DeskResponse, "id"> {
  const ref = request.ref ?? "";
  if (!access || !artifactIdentity(request, access.assignmentId)) return { ok: false, text: "Permission denied: no durable artifact access for this identity." };
  if (!access.authorize("artifact.read", "artifact", ref)) return { ok: false, text: "Permission denied: artifact access was revoked or never granted." };
  try {
    return { ok: true, text: JSON.stringify(openOutputArtifact(access.artifactAccess, ref, request.offset ?? 0)) };
  } catch {
    return { ok: false, text: "Output artifact unavailable or unauthorized" };
  }
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
  // Durable artifact reads appear only when the caller handed the host a live assignment access.
  const artifactTool = options.runtimeAccess?.authorize("artifact.read") === true ? DURABLE_OUTPUT_TOOL : undefined;
  const tools = [...new Set([...baseTools, "codemode", "tool_search", ...(artifactTool ? [artifactTool] : []), ...(canDelegate(agent, quota.used) ? [DELEGATE_TOOL] : [])])];
  // A caller that passes its profile's grant (even an absent one, meaning every connected tool) wins over the role's.
  const mcpTools = mcpGrant("mcpTools" in options ? options.mcpTools : agentProfile(config, agent.domain, agent.role).mcpTools, !editable);
  const policy: AgentPolicy = { tools, mcpTools, readOnly: !editable, depth };
  if (depth > 1) return childHost(options, policy, tools, mcpTools, artifactTool);

  const address = options.env?.[DESK_ENV.address];
  let desk = address ? deskSessionAt(address) : undefined;
  if (address && !desk) throw new Error("The inherited file desk is unavailable.");
  const board = options.env?.[BOARD_ENV];
  // A worker without a batch desk still needs claims among its children.
  const ownedDesk = editable && !desk ? new DeskSession({ cwd: options.cwd, ...(board ? { boardPath: board } : {}) }) : undefined;
  if (ownedDesk) await ownedDesk.open();
  // Children claim files among themselves; the parent keeps the batch desk when it has one.
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
    // The child's board and desk identity carries its parent's role, so a post addressed to the role reaches every worker of it while the child keeps its own cursors.
    const childWorker = `${agent.domain}:${childId}`;
    // Each child runs under its own assignment identity, issued within the parent's live scope.
    const childAccess = options.runtimeAccess?.issueChild({ taskId: agent.taskId, ownerSessionId: options.runtimeAccess.ownerSessionId, runId: id, worktree: options.cwd }, { runId: childId, domain: agent.domain, role: agent.role, worktree: options.cwd });
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
        tools: [...new Set([...tools.filter((tool) => tool !== DELEGATE_TOOL && (tool !== DURABLE_OUTPUT_TOOL || !!childAccess)), ...(childDesk ? childDesk.tools() : [])])],
        mcpTools,
        ...(childAccess ? { runtimeAccess: childAccess } : {}),
        signal,
        delegationQuota: undefined,
        onChildRun: undefined,
        onEvent: live.onEvent,
        // A child keeps the board but under its own identity, so its reads, pushes and acknowledgements never collide with its parent's or a same-role sibling's.
        env: { ...options.env, ...(board ? { BOT_LOBBY_BOARD_FROM: childWorker } : {}), ...(childDesk ? childDesk.env(childWorker) : {}) },
        onStart: (handle) => childDesk?.attach(childWorker, { runId: childId, steer: handle.steer, annotate: live.annotate }),
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

  const token = randomUUID();
  const server = await startDeskServer(async (request) => {
    if (request.worker !== token) return { ok: false, text: "Unknown parent agent." };
    if (request.op === "cancel_delegate") { controller.abort(); return { ok: true, text: "Children cancelled." }; }
    if (request.op === "artifact") return artifactPage(options.runtimeAccess, request);
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
    env: { ...options.env, ...(desk ? desk.env(parentDeskId) : {}), [AGENT_ENV]: JSON.stringify({ ...policy, tools: desk ? [...new Set([...tools, ...desk.tools()])] : tools }), [DELEGATION_ENV]: JSON.stringify({ address: server.address, token, ...(options.runtimeAccess ? { assignment: options.runtimeAccess.assignmentId } : {}) }) },
    note: `${canDelegate(agent, quota.used) ? `Work directly when you can finish the brief yourself. Use ${DELEGATE_TOOL} only for useful, separable work with disjoint files, at most five children total; children cannot delegate further. Integrate and verify their work yourself. ` : ""}Use codemode for concise parallel calls, inspect failures, and return only useful evidence.${desk ? " Before edit/write, claim_file; handover_file when finished. Release files before delegating or waiting." : ""}`,
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
