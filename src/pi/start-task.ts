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
export async function startTask(pi: ExtensionAPI, ctx: ExtensionContext, configDir: string, request: string): Promise<Task | undefined> {
  const root = detectProjectRoot(ctx.cwd, configDir);
  ensureProjectStructure(root, configDir);
  const sessionId = ctx.sessionManager.getSessionId();
  const existing = ownedTask(root, configDir, sessionId);
  if (existing) {
    ctx.ui.notify(`bot-lobby ${existing.id} is already active in this session. Finish it or run /bot-lobby cancel ${existing.id} first.`, "warning");
    return undefined;
  }
  const task = createTask(uniqueTaskId(root, configDir, request), shortTitle(request), new Date().toISOString(), request, sessionId);
  createTaskDir(root, configDir, task);
  transition(task, "clarifying");
  saveTask(root, configDir, task);
  applyStatus(ctx, root, configDir);
  await applyMasterModel(pi, ctx, loadConfig());
  ctx.ui.notify(`bot-lobby ${task.id} started`, "info");
  // A kickoff while pi is still busy (another turn) queues behind it instead of throwing.
  pi.sendUserMessage(kickoff(task), ctx.isIdle() ? undefined : { deliverAs: "followUp" });
  return task;
}
