/**
 * Starting a bot-lobby task in the current session, shared by
 * `/bot-lobby <request>`, the lobby's prompt and pending tasks saved from the
 * planner.
 */
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTask, taskRequest, type Task } from "../schemas/task.ts";
import { createTaskDir, ensureProjectStructure, nextTaskId, ownedTask, saveTask, taskDirFor } from "../state/persistence.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { transition } from "../state/task-state.ts";
import { shortTitle } from "../text.ts";
import { applyStatus } from "./ui.ts";
import { applyMasterModel } from "./settings-ui.ts";
import { setAutoMode } from "../state/auto.ts";
import { loadPlannedTask, markPlannedTaskStarted, plannedTaskRequest } from "../state/backlog.ts";

function uniqueTaskId(root: string, configDir: string, request: string): string {
  const base = nextTaskId(request);
  let id = base;
  let suffix = 2;
  while (existsSync(taskDirFor(root, configDir, id))) id = `${base}-${suffix++}`;
  return id;
}

export function kickoff(task: Task): string {
  return [
    `A bot-lobby task is active: ${task.id}`,
    `Title: ${task.title}`,
    `Request: ${taskRequest(task)}`,
    `State: ${task.state}`,
    "",
    "Drive it with the orchestrate tool:",
    "1. clarify if the request is genuinely ambiguous,",
    "2. scout the domains the request touches,",
    "3. synthesize the findings and propose a short `- ` bullet list for approval.",
    "Do not implement anything before the user approves the proposal.",
  ].join("\n");
}

/**
 * Create the task, hand it to this session's Master and send the kickoff.
 * Returns the task, or undefined (with a warning) when this session already
 * owns an active one.
 */
export interface StartOptions {
  /** The planned task (PLAN-…) this task starts from: the user agreed its plan, so its proposal needs no approval. */
  approvedPlan?: string;
  /** Start in auto mode: the oracle drives it to completion without asking. */
  auto?: boolean;
  /** The task's short title (a planned task's own title); derived from the request otherwise. */
  title?: string;
}

export async function startTask(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string, request: string, options: StartOptions = {}): Promise<Task | undefined> {
  const root = detectProjectRoot(ctx.cwd, configDir);
  ensureProjectStructure(root, configDir);
  const sessionId = ctx.sessionManager.getSessionId();
  const existing = ownedTask(root, configDir, sessionId);
  if (existing) {
    ctx.ui.notify(`bot-lobby ${existing.id} is already active in this session. Finish it or run /bot-lobby cancel ${existing.id} first.`, "warning");
    return undefined;
  }
  const task = createTask(uniqueTaskId(root, configDir, options.title ?? request), options.title ?? shortTitle(request), new Date().toISOString(), request, sessionId);
  if (options.approvedPlan) task.approvedPlan = options.approvedPlan;
  createTaskDir(root, configDir, task);
  transition(task, "clarifying");
  saveTask(root, configDir, task);
  if (options.auto) setAutoMode(root, configDir, task.id, true, sessionId);
  // A session that starts a task is named after it, so /resume and the lobby list it by name.
  if (!pi.getSessionName()) pi.setSessionName(task.title);
  applyStatus(ctx, root, configDir);
  await applyMasterModel(pi, ctx, loadConfig());
  ctx.ui.notify(`bot-lobby ${task.id} started`, "info");
  // A kickoff while pi is still busy (another turn) queues behind it instead of throwing.
  pi.sendUserMessage(kickoff(task), ctx.isIdle() ? undefined : { deliverAs: "followUp" });
  return task;
}

/**
 * Start a task saved from the planning panel in this session. The user
 * already agreed its plan, so the task carries it as approved and its
 * proposal goes through without asking. Returns the task, or a reason.
 */
export async function startPlannedTask(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string, planId: string, options: { auto?: boolean } = {}): Promise<Task | string> {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const plan = loadPlannedTask(root, configDir, planId);
  if (!plan) return `no planned task ${planId}`;
  if (plan.status !== "pending") return `${planId} was already started${plan.startedTaskId ? ` as ${plan.startedTaskId}` : ""}`;
  const task = await startTask(pi, ctx, configDir, plannedTaskRequest(plan), { approvedPlan: plan.id, title: plan.title, ...(options.auto ? { auto: true } : {}) });
  if (!task) return `this session already drives a task; finish or cancel it first`;
  markPlannedTaskStarted(root, configDir, plan.id, task.id);
  return task;
}
