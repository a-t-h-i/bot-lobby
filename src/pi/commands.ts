import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { TERMINAL_STATES, type Task } from "../schemas/task.ts";
import { detectProjectRoot, globalConfigPath, loadConfig, readDataRoots, readRawConfig } from "../state/project.ts";
import { hasScoutThinking, SCOUT_THINKING } from "../schemas/configuration.ts";
import {
  activeTask,
  claimTask,
  ownedTask,
  ownerlessTask,
  saveTask,
  selectTask,
  taskHealth,
} from "../state/persistence.ts";
import { transition } from "../state/task-state.ts";
import { AGENT_DIR_NAMES, KNOWLEDGE_FILES, knowledgeDir, type KnowledgeAgent } from "../knowledge/paths.ts";
import { readFirstExisting } from "../knowledge/store.ts";
import { overThreshold } from "../knowledge/compactor.ts";
import { applyApprovalChoice, describeTask, describeOversizedKnowledge, lastQaAsks, waiveQa, type ApprovalChoice } from "../workflow/workflow.ts";
import { applyStatus, registerRevealShortcut, setMinimized } from "./ui.ts";
import { classifierSummary, openSettings } from "./settings-ui.ts";
import { keyStatus } from "../classifier/instance.ts";
import { kickoff, startPlannedTask, startTask } from "./start-task.ts";
import { setAuto, toggleOwnAuto } from "./owner.ts";
import { autoOpenLobby, showLobby } from "../lobby/runtime.ts";
import { modelRef, thinkingMismatches } from "./model-support.ts";
import { describeRun, runFromLog } from "./run-summary.ts";
import { modelLookup } from "./tools.ts";
import { budgetLine, budgetState, parseMinutes, readBudget, setBudget, startClock } from "../state/budget.ts";
import { qaStillDue } from "../workflow/track.ts";

const HELP = [
  "/bot-lobby                  Open the lobby: tasks, plan, quick fix, metrics (alt+l)",
  "/bot-lobby <request>        Start a task through the workflow",
  "/bot-lobby --task [--auto] <request>   Start a task even when the request begins with a subcommand word",
  "/bot-lobby --budget 90m <request>   Start a task with a time budget the oracle divides between its agents",
  "/bot-lobby --fast|--full <request>   Start a task on the fast track (straight to the agents it needs) or the full workflow, whatever it reads as",
  "/bot-lobby budget [90m|off]  Show or set this session's task time budget",
  "/bot-lobby status [taskId]  Show the active task",
  "/bot-lobby tasks            List tasks",
  "/bot-lobby pause|resume     Pause or resume the active task",
  "/bot-lobby cancel [taskId]  Abandon a task",
  "/bot-lobby approve|amend <text>|decline   Answer the current proposal",
  "/bot-lobby accept [taskId]  Accept a task's work as it is, without a QA pass; the oracle then completes it",
  "/bot-lobby knowledge        Show persistent knowledge files",
  "/bot-lobby runs [taskId]    Recent subagent runs: time, turns, tokens, cost, model",
  "/bot-lobby settings         Edit per-agent model/thinking/instructions",
  "/bot-lobby config           Show effective configuration",
  "/bot-lobby minimize|restore   Hide or restore bot-lobby for this session (ctrl+shift+m)",
  "/bot-lobby claim <taskId>    Take ownership of an orphaned task",
  "/bot-lobby auto [on|off]    Auto mode: the oracle drives this session's task without asking (alt+g)",
  "/bot-lobby start-plan PLAN-… [auto]   Start a planned task here; its agreed plan needs no approval",
  "/bot-lobby switch <session.jsonl>   Run a saved session in this window (the lobby's session browser uses it: alt+o, s)",
  "/bot-lobby help             This help",
].join("\n");

/** Subcommands only win when no free-form text follows (so tasks still start). */
const SUBCOMMANDS = new Set(["lobby", "help", "status", "runs", "tasks", "pause", "resume", "cancel", "approve", "amend", "decline", "accept", "budget", "knowledge", "config", "settings", "minimize", "restore", "claim", "auto", "start-plan", "switch"]);

function isTaskId(value: string | undefined): boolean {
  return Boolean(value && /^TASK-/.test(value));
}

/** A task start's leading flags: `--task` (always a task), `--auto`, `--fast`, `--full`, `--budget <time>` (or `--budget=<time>`). */
const START_FLAG = /^--(task|auto|fast|full)(?=\s|$)\s*|^--budget(?:=|\s+)(\S+)\s*/;

export interface ParsedCommand {
  sub: string | undefined;
  rest: string[];
  restText: string;
  auto?: boolean;
  /** Minutes from `--budget`. */
  budget?: number;
  /** `--budget` with something that is not a time. */
  budgetError?: string;
  /** `--fast` or `--full`: the task's path, whatever its request reads as. */
  track?: "fast" | "full";
}

export function parseCommand(args: string): ParsedCommand {
  let trimmed = args.trim();
  // Leading flags start a task: what follows is its request, even when it begins with a subcommand word
  // (a background session started from the lobby sends `--task [--auto] <request>`).
  let flagged = false;
  const extras: Pick<ParsedCommand, "auto" | "budget" | "budgetError" | "track"> = {};
  for (let match = START_FLAG.exec(trimmed); match; match = START_FLAG.exec(trimmed)) {
    flagged = true;
    if (match[1] === "auto") extras.auto = true;
    else if (match[1] === "fast" || match[1] === "full") extras.track = match[1];
    else if (match[2] !== undefined) {
      const minutes = parseMinutes(match[2]);
      if (minutes) extras.budget = minutes;
      else extras.budgetError = `"${match[2]}" is not a time budget (try 90m, 1h or 1h30m)`;
    }
    trimmed = trimmed.slice(match[0].length);
  }
  if (flagged) return { sub: undefined, rest: [], restText: trimmed.trim(), ...extras };
  const [sub, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  if (!sub || !SUBCOMMANDS.has(sub)) return { sub: undefined, rest: [], restText: trimmed };
  const takesArgs = sub === "amend" || sub === "claim"
    || (sub === "auto" && rest.length === 1 && /^(on|off)$/i.test(rest[0]!))
    || (sub === "budget" && rest.length >= 1 && rest.length <= 2 && (/^off$/i.test(rest[0]!) || parseMinutes(rest.join("")) !== undefined))
    || (sub === "start-plan" && rest.length >= 1 && rest.length <= 2 && /^PLAN-/.test(rest[0]!) && (rest.length === 1 || rest[1] === "auto"))
    || (sub === "switch" && rest.length >= 1 && /\.jsonl$/.test(rest.join(" ")));
  if (!takesArgs && rest.length > 0 && !(rest.length === 1 && isTaskId(rest[0]))) {
    return { sub: undefined, rest: [], restText: trimmed };
  }
  return { sub, rest, restText: trimmed.slice(sub.length).trim() };
}

export { kickoff };

function showStatus(ctx: ExtensionCommandContext, configDir: string, taskId?: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const sessionId = ctx.sessionManager.getSessionId();
  const task = selectTask(root, configDir, taskId, sessionId) ?? (taskId ? undefined : ownerlessTask(root, configDir));
  applyStatus(ctx, root, configDir);
  const oversized = describeOversizedKnowledge(readDataRoots(root, configDir), loadConfig().knowledge.compactionThreshold);
  const broken = taskHealth(root, configDir).corrupted;
  const knowledge = [
    oversized.length > 0 ? `Knowledge over threshold: ${oversized.join(", ")}` : "",
    broken.length > 0 ? `Unreadable task state: ${broken.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const footer = knowledge ? `\n${knowledge}` : "";
  const budget = task ? readBudget(root, configDir, task.id) : undefined;
  const time = task && budget ? `\n${budgetLine(budget, budgetState(task.id, budget, !qaStillDue(task)))}` : "";
  ctx.ui.notify(task ? `${describeTask(task)}${time}${footer}` : `No bot-lobby task found in ${root}.${footer}`, task ? "info" : "warning");
}

/** Recent runs of the active (or named) task, newest last, so slow models are easy to spot. */
export function runsReport(task: Task | undefined, limit = 20): string {
  if (!task) return "No bot-lobby task found.";
  const entries = (task.runLog ?? []).slice(-limit);
  if (entries.length === 0) return `${task.id}: no finished subagent runs yet.`;
  return [`${task.id} — last ${entries.length} run${entries.length === 1 ? "" : "s"}:`, ...entries.map((entry) => describeRun(runFromLog(entry, task.id)))].join("\n");
}

function showRuns(ctx: ExtensionCommandContext, configDir: string, taskId?: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = selectTask(root, configDir, taskId, ctx.sessionManager.getSessionId()) ?? (taskId ? undefined : ownerlessTask(root, configDir));
  ctx.ui.notify(runsReport(task), task ? "info" : "warning");
}

function showTasks(ctx: ExtensionCommandContext, configDir: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const { tasks, corrupted } = taskHealth(root, configDir);
  if (tasks.length === 0 && corrupted.length === 0) return ctx.ui.notify("No bot-lobby tasks yet.", "info");
  const lines = tasks.slice(0, 12).map((task) => `${task.id}  ${task.state.padEnd(17)} ${(task.ownerSessionId ? task.ownerSessionId.slice(0, 8) : "—").padEnd(9)} ${task.title.slice(0, 60)}`);
  if (corrupted.length > 0) lines.push("", `Unreadable task state: ${corrupted.join(", ")} (left untouched; inspect ${readDataRoots(root, configDir).join(" and ")}/tasks)`);
  ctx.ui.notify(lines.join("\n"), "info");
}

function setPaused(ctx: ExtensionCommandContext, configDir: string, paused: boolean, taskId?: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = selectTask(root, configDir, taskId, ctx.sessionManager.getSessionId());
  if (task?.ownerSessionId && task.ownerSessionId !== ctx.sessionManager.getSessionId()) {
    return ctx.ui.notify(`${task.id} is owned by another pi session; /bot-lobby claim ${task.id} to take it over.`, "warning");
  }
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
  const task = selectTask(root, configDir, taskId, ctx.sessionManager.getSessionId());
  if (task?.ownerSessionId && task.ownerSessionId !== ctx.sessionManager.getSessionId()) {
    return ctx.ui.notify(`${task.id} is owned by another pi session; /bot-lobby claim ${task.id} to take it over.`, "warning");
  }
  if (!task) return ctx.ui.notify("No task to cancel.", "warning");
  if (TERMINAL_STATES.includes(task.state)) return ctx.ui.notify(`${task.id} is already ${task.state}.`, "warning");
  transition(task, "abandoned");
  saveTask(root, configDir, task);
  applyStatus(ctx, root, configDir);
  ctx.ui.notify(`${task.id} abandoned.`, "info");
}

/** Explicit takeover of an orphaned task (ownerless, or owned by a dead session). */
function claimTaskCommand(ctx: ExtensionCommandContext, configDir: string, taskId?: string): void {
  if (!isTaskId(taskId)) return ctx.ui.notify("Usage: /bot-lobby claim <taskId>", "warning");
  const root = detectProjectRoot(ctx.cwd, configDir);
  const sessionId = ctx.sessionManager.getSessionId();
  const current = ownedTask(root, configDir, sessionId);
  if (current && current.id !== taskId) {
    return ctx.ui.notify(`bot-lobby ${current.id} is already active in this session; cancel it before claiming ${taskId}.`, "warning");
  }
  const claimed = claimTask(root, configDir, taskId!, sessionId);
  if (!claimed) return ctx.ui.notify(`No task ${taskId}.`, "warning");
  applyStatus(ctx, root, configDir);
  ctx.ui.notify(`bot-lobby now owns ${claimed.id}.`, "info");
}
function answerProposal(
  ctx: ExtensionCommandContext,
  configDir: string,
  choice: ApprovalChoice,
  amendment?: string,
): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = activeTask(root, configDir, ctx.sessionManager.getSessionId());
  if (!task) return ctx.ui.notify("No active task.", "warning");
  try {
    const message = applyApprovalChoice(task, choice, amendment);
    saveTask(root, configDir, task);
    applyStatus(ctx, root, configDir);
    ctx.ui.notify(message, "info");
  } catch (error) {
    ctx.ui.notify(`bot-lobby: ${(error as Error).message}`, "warning");
  }
}

/**
 * `/bot-lobby accept [taskId]`: the user accepts a task's work as it stands,
 * without a QA pass (QA keeps asking for more, and the user has seen enough).
 * The gate is waived and blockers cleared; the oracle is asked to complete it.
 */
function acceptWork(pi: ExtensionAPI, ctx: ExtensionCommandContext, configDir: string, taskId?: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const sessionId = ctx.sessionManager.getSessionId();
  const task = selectTask(root, configDir, taskId, sessionId);
  if (!task || TERMINAL_STATES.includes(task.state)) return ctx.ui.notify("bot-lobby: no active task to accept.", "warning");
  if (task.ownerSessionId && task.ownerSessionId !== sessionId) {
    return ctx.ui.notify(`${task.id} is owned by another pi session; accept it there, or /bot-lobby claim ${task.id} first.`, "warning");
  }
  if (!["implementing", "reviewing", "blocked"].includes(task.state)) {
    return ctx.ui.notify(`bot-lobby: ${task.id} is still ${task.state}; there is no work to accept yet.`, "warning");
  }
  if (task.qaVerdict !== "pass" && !task.qaWaiver) waiveQa(task, lastQaAsks(task), "with /bot-lobby accept");
  saveTask(root, configDir, task);
  applyStatus(ctx, root, configDir);
  ctx.ui.notify(`bot-lobby: ${task.id} accepted as it is; the oracle will complete it.`, "info");
  const message = `The user accepted ${task.id}'s work as it is (the QA gate is waived). Call orchestrate action=complete now with a short summary that names anything QA still asked for.`;
  pi.sendUserMessage(message, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
}

/**
 * `/bot-lobby budget [time|off]`: show, set or remove the time budget of this
 * session's task. Time already spent is kept; the oracle sees the change on
 * its next step.
 */
function budgetCommand(ctx: ExtensionCommandContext, configDir: string, value: string): void {
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = activeTask(root, configDir, ctx.sessionManager.getSessionId());
  if (!task) return ctx.ui.notify("bot-lobby: no active task in this session — a time budget applies to a task (start one with /bot-lobby --budget 90m <request>)", "warning");
  if (!value) {
    const budget = readBudget(root, configDir, task.id);
    return ctx.ui.notify(budget ? `${task.id} — ${budgetLine(budget, budgetState(task.id, budget, !qaStillDue(task)))}` : `${task.id} has no time budget. Set one with /bot-lobby budget 90m.`, "info");
  }
  const minutes = /^off$/i.test(value) ? 0 : parseMinutes(value);
  if (minutes === undefined) return ctx.ui.notify(`bot-lobby: "${value}" is not a time budget (try 90m, 1h or 1h30m)`, "warning");
  const budget = setBudget(root, configDir, task.id, minutes);
  // Set while the oracle works: its clock runs from now, not from its next turn.
  if (budget && !ctx.isIdle()) startClock(root, configDir, task.id);
  applyStatus(ctx, root, configDir);
  ctx.ui.notify(budget ? `bot-lobby: ${task.id} — ${budgetLine(budget, budgetState(task.id, budget, !qaStillDue(task)))}` : `bot-lobby: ${task.id} has no time budget now.`, "info");
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
  const config = loadConfig();
  const warnings = thinkingMismatches(config, modelLookup(ctx), ctx.model ? modelRef(ctx.model) : undefined);
  if (hasScoutThinking(readRawConfig())) warnings.push(`Scout: thinking is fixed at "${SCOUT_THINKING}"; the scout.thinking value in the file is ignored.`);
  const notes = warnings.length > 0 ? `\n\nWarnings:\n${warnings.map((line) => `- ${line}`).join("\n")}` : "";
  const jev = `Classifier: ${classifierSummary(config, keyStatus)}`;
  ctx.ui.notify(`${globalConfigPath()}\n${jev}\n${JSON.stringify(config, null, 2)}${notes}`, warnings.length > 0 ? "warning" : "info");
}

/**
 * `/bot-lobby switch <file>`: run a saved session in this window. Only a
 * command context may replace the session, so the lobby's browser asks for a
 * switch through this command. The context is stale once the switch starts.
 */
async function switchCommand(ctx: ExtensionCommandContext, path: string): Promise<void> {
  if (!existsSync(path)) return ctx.ui.notify(`bot-lobby: no session file at ${path}`, "warning");
  if (ctx.sessionManager.getSessionFile() === path) return ctx.ui.notify("bot-lobby: this window already runs that session", "info");
  if (!ctx.isIdle()) return ctx.ui.notify("bot-lobby: the oracle is working — esc stops it, then switch", "warning");
  const result = await ctx.switchSession(path);
  if (result.cancelled) ctx.ui.notify("bot-lobby: the switch was cancelled", "warning");
}

/** `/bot-lobby auto [on|off]`: switch (or set) auto mode for this session's task. */
function autoCommand(ctx: ExtensionCommandContext, configDir: string, value: string | undefined): void {
  if (!value) return ctx.ui.notify(`bot-lobby: ${toggleOwnAuto()}`, "info");
  const root = detectProjectRoot(ctx.cwd, configDir);
  const task = activeTask(root, configDir, ctx.sessionManager.getSessionId());
  if (!task) return ctx.ui.notify("bot-lobby: no active task in this session — auto mode applies to a task", "warning");
  const on = value.toLowerCase() === "on";
  setAuto(root, configDir, task.id, on, ctx.sessionManager.getSessionId());
  ctx.ui.notify(`bot-lobby: auto mode ${on ? "on" : "off"} for ${task.id}`, "info");
}

export function registerCommands(pi: ExtensionAPI, configDir: string): void {
  registerRevealShortcut(pi, configDir);
  pi.registerCommand("bot-lobby", {
    description: "Structured multi-agent engineering orchestrator",
    getArgumentCompletions: (prefix) => {
      const items = [...SUBCOMMANDS].map((value) => ({ value, label: value }));
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const { sub, rest, restText, auto, budget, budgetError, track } = parseCommand(args ?? "");
      if (budgetError) return ctx.ui.notify(`bot-lobby: ${budgetError}`, "warning");
      if (!sub) {
        if (!restText) {
          if (!showLobby()) ctx.ui.notify(HELP, "info");
          return;
        }
        if (await startTask(pi, ctx, configDir, restText, { ...(auto ? { auto } : {}), ...(budget ? { budget } : {}), ...(track ? { track } : {}) })) autoOpenLobby();
        return;
      }
      switch (sub) {
        case "lobby":
          if (!showLobby()) ctx.ui.notify("The lobby needs pi's interactive terminal UI.", "warning");
          return;
        case "help":
          return ctx.ui.notify(HELP, "info");
        case "status":
          return showStatus(ctx, configDir, rest[0]);
        case "tasks":
          return showTasks(ctx, configDir);
        case "runs":
          return showRuns(ctx, configDir, rest[0]);
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
        case "accept":
          return acceptWork(pi, ctx, configDir, rest[0]);
        case "budget":
          return budgetCommand(ctx, configDir, rest.join(""));
        case "knowledge":
          return showKnowledge(ctx, configDir);
        case "settings":
          return openSettings(pi, ctx);
        case "minimize":
          setMinimized(true);
          return applyStatus(ctx, detectProjectRoot(ctx.cwd, configDir), configDir);
        case "restore":
          setMinimized(false);
          return applyStatus(ctx, detectProjectRoot(ctx.cwd, configDir), configDir);
        case "claim":
          return claimTaskCommand(ctx, configDir, rest[0]);
        case "auto":
          return autoCommand(ctx, configDir, rest[0]);
        case "switch":
          return switchCommand(ctx, restText);
        case "start-plan": {
          const started = await startPlannedTask(pi, ctx, configDir, rest[0]!, { auto: rest[1] === "auto" });
          if (typeof started === "string") return ctx.ui.notify(`bot-lobby: ${started}`, "warning");
          return autoOpenLobby();
        }
        default:
          return showConfig(ctx);
      }
    },
  });

  pi.registerCommand("bot-lobby-settings", {
    description: "Edit per-agent model, thinking, and instructions",
    handler: async (_args, ctx) => openSettings(pi, ctx),
  });
}
