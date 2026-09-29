/**
 * Starting a bot-lobby task in the current session, shared by
 * `/bot-lobby <request>`, the lobby's prompt and pending tasks saved from the
 * planner.
 */
import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTask, taskRequest, type Task, type TaskTrack, type TaskTriage, type TrackPath } from "../schemas/task.ts";
import type { Domain } from "../schemas/agent.ts";
import { chooseTrack, trackLine, trackSummary } from "../workflow/track.ts";
import { lobbyFeed } from "../lobby/feed.ts";
import { createTaskDir, ensureProjectStructure, nextTaskId, ownedTask, saveTask, taskDirFor } from "../state/persistence.ts";
import { detectProjectRoot, loadConfig } from "../state/project.ts";
import { transition } from "../state/task-state.ts";
import { shortTitle } from "../text.ts";
import { applyStatus } from "./ui.ts";
import { applyMasterModel } from "./settings-ui.ts";
import { setAutoMode } from "../state/auto.ts";
import { loadPlannedTask, markPlannedTaskStarted, plannedTaskRequest } from "../state/backlog.ts";
import { triageFor } from "../classifier/instance.ts";
import { freshContextOn, markContext } from "./fresh-context.ts";
import { setBudget } from "../state/budget.ts";
import { createWorkspace, gitLine } from "../execution/workspace.ts";
import type { GitIsolation } from "../schemas/configuration.ts";

function uniqueTaskId(root: string, configDir: string, request: string): string {
  const base = nextTaskId(request);
  let id = base;
  let suffix = 2;
  while (existsSync(taskDirFor(root, configDir, id))) id = `${base}-${suffix++}`;
  return id;
}

/** In a kickoff after the oracle routed the request to the team (the lobby then shows the request once). */
export const ROUTED_LINE = "Routed: you sent this request to the team.";

/** The fast track's steps: straight to the agents the request needs, QA only for tests, then complete. */
function fastSteps(track: TaskTrack): string[] {
  const building = track.roster.filter((member): member is Domain => member === "designer" || member === "backend");
  const builders = building.length > 1
    ? `one call with assignments for ${building.join(" and ")}, each task stating the contract between them`
    : building.length === 1 ? `domain ${building[0]}` : track.roster.includes("qa") ? "domain qa (the change is its tests)" : "the one domain that owns the files";
  const steps = [
    ...(track.roster.includes("researcher") ? ["First summon the researcher for the outside facts it needs: orchestrate action=research with a domain and the question."] : []),
    `Delegate now with orchestrate action=implement: ${builders}; open each task with "Step 1:" (the engine keeps the plan).`,
    ...(track.roster.includes("qa") && building.length > 0 ? ["QA takes part (tests): once the change is in, give qa the tests as the last step (action=implement domain=qa), or run action=qa."] : []),
    "Check `git diff --stat` and the report, then orchestrate action=complete with a one-line summary.",
  ];
  return [
    "Fast track: the request reads small and clear, so skip the ceremony: no scouts, no proposal, no plan document.",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    track.roster.includes("qa") ? "" : "No QA gate on this track: nothing here needs tests.",
    "If the request is bigger, riskier or less clear than it reads, switch before delegating: orchestrate action=track track=full with a reason. Otherwise do not deliberate over the track.",
  ].filter(Boolean);
}

export function kickoff(task: Task, budgetMinutes = 0, options: { fastTrack?: boolean; routed?: boolean } = {}): string {
  const track = task.track;
  const head = [
    `A bot-lobby task is active: ${task.id}`,
    `Title: ${task.title}`,
    `Request: ${taskRequest(task)}`,
    `State: ${task.state}`,
    ...(options.routed ? [ROUTED_LINE] : []),
    ...(track ? [trackSummary(track)] : []),
    ...(budgetMinutes > 0 ? [`Time budget: ${budgetMinutes} minutes of work, for you and every agent. Size the plan to fit it and divide it by scope (see Time budget in your prompt).`] : []),
    ...(task.git ? [gitLine(task.git)] : []),
    "",
  ];
  if (track?.path === "fast") return [...head, ...fastSteps(track)].join("\n");
  const fastAllowed = Boolean(track) && options.fastTrack !== false && track?.userChoice !== "full" && track?.source !== "plan";
  return [
    ...head,
    "Drive it with the orchestrate tool:",
    "1. clarify if the request is genuinely ambiguous,",
    "2. scout the domains the request touches,",
    "3. synthesize the findings and propose a short `- ` bullet list for approval.",
    "Do not implement anything before the user approves the proposal.",
    ...(fastAllowed ? ["If it is in fact a small, clear, low-risk change, take the fast track instead: orchestrate action=track track=fast with a reason."] : []),
  ].join("\n");
}

/**
 * Give the task its git branch or worktree, named after it. Any failure (no
 * repository, no commits, a refused checkout) is said once and the task runs
 * without: git must never stop a task from starting.
 */
async function giveWorkspace(ctx: ExtensionContext, root: string, configDir: string, task: Task, isolation: GitIsolation): Promise<void> {
  if (isolation === "off") return;
  const made = await createWorkspace({ cwd: ctx.cwd, root, configDir, name: task.id, mode: isolation });
  if (typeof made === "string") {
    lobbyFeed.log("LOBBY", `${task.id} runs without its own ${isolation} — ${made}`, "warning");
    ctx.ui.notify(`bot-lobby: ${task.id} runs without its own ${isolation} — ${made}`, "warning");
    return;
  }
  task.git = made;
  lobbyFeed.log("LOBBY", made.mode === "worktree" ? `${task.id}: worktree ${made.path} on branch ${made.branch}` : `${task.id}: on branch ${made.branch}${made.from ? ` (from ${made.from})` : ""}`, "success");
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
  /** Minutes of work time the task gets; `workflow.taskBudgetMinutes` when absent. */
  budget?: number;
  /** The user's `--fast` or `--full`: the path the task takes, whatever its request reads as. */
  track?: TrackPath;
  /** The classifier already read the request (routing did): `triage` is its read, or absent when it was off. */
  triaged?: boolean;
  triage?: TaskTriage;
  /** The oracle sent this request to the team after the classifier read it as a quick fix. */
  routed?: boolean;
  /** `--branch`, `--worktree` or `--no-branch`: whether this task gets a git branch or worktree of its own; `workflow.gitIsolation` when absent. */
  isolation?: GitIsolation;
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
  // The classifier's read of the request (when it is on) reaches the Master's very first turn.
  const triage = options.triaged ? options.triage : await triageFor({ cwd: ctx.cwd, root, configDir }, request);
  if (triage) task.triage = triage;
  // How serious the request reads: who takes part, and whether it takes the fast track or the full workflow.
  const config = loadConfig();
  task.track = chooseTrack(request, triage, { fastTrack: config.workflow.fastTrack, ...(options.track ? { forced: options.track } : {}), ...(options.approvedPlan ? { approvedPlan: true } : {}) });
  lobbyFeed.log("LOBBY", trackLine(task.track), "info");
  await giveWorkspace(ctx, root, configDir, task, options.isolation ?? config.workflow.gitIsolation);
  saveTask(root, configDir, task);
  const budgetMinutes = options.budget ?? config.workflow.taskBudgetMinutes;
  if (budgetMinutes > 0) setBudget(root, configDir, task.id, budgetMinutes);
  if (options.auto) setAutoMode(root, configDir, task.id, true, sessionId);
  // A session that starts a task is named after it (its friendly name), so /resume and the lobby list it by name.
  if (!pi.getSessionName()) pi.setSessionName(task.id);
  applyStatus(ctx, root, configDir);
  await applyMasterModel(pi, ctx, loadConfig());
  ctx.ui.notify(`bot-lobby ${task.id} started`, "info");
  // The oracle takes the task on with a clean context: nothing said before the kickoff is sent to its model.
  if (freshContextOn()) markContext(pi, { kind: "start", taskId: task.id, at: Date.now() });
  // A kickoff while pi is still busy (another turn) queues behind it instead of throwing.
  pi.sendUserMessage(kickoff(task, budgetMinutes, { fastTrack: config.workflow.fastTrack, ...(options.routed ? { routed: true } : {}) }), ctx.isIdle() ? undefined : { deliverAs: "followUp" });
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
