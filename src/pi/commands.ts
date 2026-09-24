import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { TERMINAL_STATES, createTask, taskRequest, type Task } from "../schemas/task.ts";
import { detectProjectRoot, globalConfigPath, loadConfig, readDataRoots } from "../state/project.ts";
import {
  activeTask,
  createTaskDir,
  ensureProjectStructure,
  nextTaskId,
  saveTask,
  selectTask,
  taskDirFor,
  taskHealth,
} from "../state/persistence.ts";
import { transition } from "../state/task-state.ts";
import { AGENT_DIR_NAMES, KNOWLEDGE_FILES, knowledgeDir, type KnowledgeAgent } from "../knowledge/paths.ts";
import { readFirstExisting } from "../knowledge/store.ts";
import { overThreshold } from "../knowledge/compactor.ts";
import { applyApprovalChoice, describeTask, describeOversizedKnowledge, type ApprovalChoice } from "../workflow/workflow.ts";
import { shortTitle } from "../text.ts";
import { applyStatus, registerRevealShortcut } from "./ui.ts";
import { applyMasterModel, openSettings } from "./settings-ui.ts";

const HELP = [
  "/dev-lobby <request>        Start a task through the workflow",
  "/dev-lobby status [taskId]  Show the active task",
  "/dev-lobby tasks            List tasks",
  "/dev-lobby pause|resume     Pause or resume the active task",
  "/dev-lobby cancel [taskId]  Abandon a task",
  "/dev-lobby approve|amend <text>|decline   Answer the current proposal",
  "/dev-lobby knowledge        Show persistent knowledge files",
  "/dev-lobby settings         Edit per-agent model/thinking/instructions",
  "/dev-lobby config           Show effective configuration",
].join("\n");

/** Subcommands only win when no free-form text follows (so tasks still start). */
const SUBCOMMANDS = new Set(["status", "tasks", "pause", "resume", "cancel", "approve", "amend", "decline", "knowledge", "config", "settings"]);

function isTaskId(value: string | undefined): boolean {
  return Boolean(value && /^TASK-/.test(value));
}

function parseCommand(args: string): { sub: string | undefined; rest: string[]; restText: string } {
  const trimmed = args.trim();
  const [sub, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  if (!sub || !SUBCOMMANDS.has(sub)) return { sub: undefined, rest: [], restText: trimmed };
  if (sub !== "amend" && rest.length > 0 && !(rest.length === 1 && isTaskId(rest[0]))) {
    return { sub: undefined, rest: [], restText: trimmed };
  }
  return { sub, rest, restText: trimmed.slice(sub.length).trim() };
}

function uniqueTaskId(root: string, configDir: string, request: string): string {
  const base = nextTaskId(request);
  let id = base;
  let suffix = 2;
  while (existsSync(taskDirFor(root, configDir, id))) id = `${base}-${suffix++}`;
  return id;
}

export function kickoff(task: Task): string {
  return [
    `A dev-lobby task is active: ${task.id}`,
    `Title: ${task.title}`,
    `Request: ${taskRequest(task)}`,
    `State: ${task.state}`,
    "",
    "Drive it with the orchestrate tool:",
    "1. clarify if the request is genuinely ambiguous,",
    "2. scout the domains the request touches,",
    "3. synthesize the findings and propose a one-paragraph plan for approval.",
    "Do not implement anything before the user approves the proposal.",
  ].join("\n");
}

async function startTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  configDir: string,
  request: string,
): Promise<void> {
  const root = detectProjectRoot(ctx.cwd, configDir);
  ensureProjectStructure(root, configDir);
  const task = createTask(uniqueTaskId(root, configDir, request), shortTitle(request), new Date().toISOString(), request);
  createTaskDir(root, configDir, task);
  transition(task, "clarifying");
  saveTask(root, configDir, task);
  applyStatus(ctx, root, configDir);
  await applyMasterModel(pi, ctx, loadConfig());
  ctx.ui.notify(`dev-lobby ${task.id} started`, "info");
  pi.sendUserMessage(kickoff(task));
}

function showStatus(ctx: ExtensionCommandContext, configDir: string, taskId?: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = selectTask(root, configDir, taskId);
  applyStatus(ctx, root, configDir);
  const oversized = describeOversizedKnowledge(readDataRoots(root, configDir), loadConfig().knowledge.compactionThreshold);
  const broken = taskHealth(root, configDir).corrupted;
  const knowledge = [
    oversized.length > 0 ? `Knowledge over threshold: ${oversized.join(", ")}` : "",
    broken.length > 0 ? `Unreadable task state: ${broken.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const footer = knowledge ? `\n${knowledge}` : "";
  ctx.ui.notify(task ? `${describeTask(task)}${footer}` : `No dev-lobby task found in ${root}.${footer}`, task ? "info" : "warning");
}

function showTasks(ctx: ExtensionCommandContext, configDir: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const { tasks, corrupted } = taskHealth(root, configDir);
  if (tasks.length === 0 && corrupted.length === 0) return ctx.ui.notify("No dev-lobby tasks yet.", "info");
  const lines = tasks.slice(0, 12).map((task) => `${task.id}  ${task.state.padEnd(17)} ${task.title.slice(0, 60)}`);
  if (corrupted.length > 0) lines.push("", `Unreadable task state: ${corrupted.join(", ")} (left untouched; inspect ${readDataRoots(root, configDir).join(" and ")}/tasks)`);
  ctx.ui.notify(lines.join("\n"), "info");
}

function setPaused(ctx: ExtensionCommandContext, configDir: string, paused: boolean, taskId?: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = selectTask(root, configDir, taskId);
  if (!task || TERMINAL_STATES.includes(task.state)) {
    return ctx.ui.notify("No active task to pause or resume.", "warning");
  }
  task.paused = paused;
  saveTask(root, configDir, task);
  applyStatus(ctx, root, configDir);
  ctx.ui.notify(`${task.id} ${paused ? "paused" : "resumed"}.`, "info");
}

function cancelTask(ctx: ExtensionCommandContext, configDir: string, taskId?: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = selectTask(root, configDir, taskId);
  if (!task) return ctx.ui.notify("No task to cancel.", "warning");
  if (TERMINAL_STATES.includes(task.state)) return ctx.ui.notify(`${task.id} is already ${task.state}.`, "warning");
  transition(task, "abandoned");
  saveTask(root, configDir, task);
  applyStatus(ctx, root, configDir);
  ctx.ui.notify(`${task.id} abandoned.`, "info");
}

function answerProposal(
  ctx: ExtensionCommandContext,
  configDir: string,
  choice: ApprovalChoice,
  amendment?: string,
): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = activeTask(root, configDir);
  if (!task) return ctx.ui.notify("No active task.", "warning");
  try {
    const message = applyApprovalChoice(task, choice, amendment);
    saveTask(root, configDir, task);
    applyStatus(ctx, root, configDir);
    ctx.ui.notify(message, "info");
  } catch (error) {
    ctx.ui.notify(`dev-lobby: ${(error as Error).message}`, "warning");
  }
}

function showKnowledge(ctx: ExtensionCommandContext, configDir: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const cfg = loadConfig();
  const roots = readDataRoots(root, configDir);
  const threshold = cfg.knowledge.compactionThreshold;
  const lines: string[] = [`Threshold: ${threshold} chars`];
  for (const agent of Object.keys(AGENT_DIR_NAMES) as KnowledgeAgent[]) {
    const sizes = KNOWLEDGE_FILES[agent].map((file) => {
      const chars = readFirstExisting(roots.map((dr) => join(knowledgeDir(dr, agent), file))).length;
      return `${file}=${chars}${chars > threshold ? " OVER" : ""}`;
    });
    lines.push(`${AGENT_DIR_NAMES[agent]}: ${sizes.join(" ")}`);
  }
  const oversized = overThreshold(roots, threshold);
  if (oversized.length > 0) lines.push("", "Ask the Master to compact the files marked OVER.");
  ctx.ui.notify(lines.join("\n"), "info");
}

function showConfig(ctx: ExtensionCommandContext): void {
  ctx.ui.notify(`${globalConfigPath()}\n${JSON.stringify(loadConfig(), null, 2)}`, "info");
}

export function registerCommands(pi: ExtensionAPI, configDir: string): void {
  registerRevealShortcut(pi, configDir);
  pi.registerCommand("dev-lobby", {
    description: "Structured multi-agent engineering orchestrator",
    getArgumentCompletions: (prefix) => {
      const items = [...SUBCOMMANDS].map((value) => ({ value, label: value }));
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const { sub, rest, restText } = parseCommand(args ?? "");
      if (!sub) {
        if (!restText) return ctx.ui.notify(HELP, "info");
        return startTask(pi, ctx, configDir, restText);
      }
      switch (sub) {
        case "status":
          return showStatus(ctx, configDir, rest[0]);
        case "tasks":
          return showTasks(ctx, configDir);
        case "pause":
          return setPaused(ctx, configDir, true, rest[0]);
        case "resume":
          return setPaused(ctx, configDir, false, rest[0]);
        case "cancel":
          return cancelTask(ctx, configDir, rest[0]);
        case "approve":
          return answerProposal(ctx, configDir, "approve");
        case "amend":
          return answerProposal(ctx, configDir, "amend", restText);
        case "decline":
          return answerProposal(ctx, configDir, "decline");
        case "knowledge":
          return showKnowledge(ctx, configDir);
        case "settings":
          return openSettings(pi, ctx);
        default:
          return showConfig(ctx);
      }
    },
  });

  pi.registerCommand("dev-lobby-settings", {
    description: "Edit per-agent model, thinking, and instructions",
    handler: async (_args, ctx) => openSettings(pi, ctx),
  });
}
