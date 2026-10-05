import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { activeTask } from "../state/persistence.ts";
import { detectProjectRoot, loadConfig, readDataRoots } from "../state/project.ts";
import { compilePrompt } from "../prompts/compiler.ts";
import { readAgentKnowledge } from "../knowledge/store.ts";
import { selectKnowledge } from "../knowledge/selector.ts";
import { cancelAllRuns } from "../execution/agent-runner.ts";
import { describeTask } from "../workflow/workflow.ts";
import { truncate } from "../text.ts";
import { applyStatus, clearStatus, isMinimized, setMinimized } from "./ui.ts";
import { startsOn } from "./switch.ts";
import { isSubagentProcess, webToolsFor } from "./quiet.ts";
import { registerQuietTools } from "./tool-renderers.ts";
import { taskRequest, type Task, type TaskState } from "../schemas/task.ts";
import { pendingComments, readPlanComments, type PlanComment } from "../state/comments.ts";
import { isAutoMode } from "../state/auto.ts";
import { triageContext } from "../classifier/triage.ts";
import { qaStillDue } from "../workflow/track.ts";
import { previousTaskNote } from "./fresh-context.ts";
import { budgetLine, budgetState, pauseClocks, readBudget, resumeClocks, startClock, stopClocks } from "../state/budget.ts";

/** Tools that wait on the user: the task's clock waits with them. */
const ASKING_TOOLS: ReadonlySet<string> = new Set(["ask_user_question"]);

/** States in which the triage still helps the Master shape the task; once it is planned, the hints are noise. */
const SHAPING_STATES: ReadonlySet<TaskState> = new Set(["created", "clarifying", "scouting", "synthesizing", "awaiting_approval"]);

/** The Master's workflow context: the task's state, where its time budget stands, and the classifier's triage while the task is being shaped. */
export function masterWorkflowContext(task: Task, time = ""): string {
  return [describeTask(task), time, SHAPING_STATES.has(task.state) ? triageContext(task.triage) : ""].filter(Boolean).join("\n\n");
}

/** The oracle's view of the task's time budget: where it stands and how to spend it; "" without one. */
export function budgetContext(root: string, configDir: string, task: Task): string {
  const budget = readBudget(root, configDir, task.id);
  if (!budget) return "";
  const state = budgetState(task.id, budget, !qaStillDue(task));
  const running = budget.allotments.filter((entry) => !entry.endedAt).map((entry) => `${entry.who} (${entry.minutes}m)`);
  return [
    budgetLine(budget, state),
    running.length > 0 ? `Running now: ${running.join(", ")}.` : "",
    "Divide what is left by scope: pass `minutes` on each implement (per assignment in a parallel batch), keeping the QA gate's reserve. Every agent is told its minutes; one that runs out reports where it left off and the user decides on more.",
  ].filter(Boolean).join(" ");
}

export function masterTaskContext(task: Task, comments: readonly PlanComment[] = [], auto = false): string {
  const open = pendingComments(comments);
  return [
    `Task ${task.id}: ${task.title}`,
    `Request: ${truncate(taskRequest(task), 2000)}`,
    task.proposal ? `Current proposal:\n${truncate(task.proposal, 2000)}` : "",
    task.plan ? `Approved plan:\n${truncate(task.plan, 3000)}` : "",
    task.amendments.length > 0 ? `User amendments:\n${task.amendments.map((entry) => `- ${entry}`).join("\n")}` : "",
    open.length > 0 ? `Open plan comments (from the lobby):\n${open.map((comment) => `- ${truncate(comment.text, 600)}`).join("\n")}` : "",
    task.approvedPlan ? `The user agreed this task's plan in the planning panel (${task.approvedPlan}): follow it, do not ask them to approve a proposal (propose is approved automatically), and answer open questions from the plan.` : "",
    auto ? "AUTO MODE is on: drive this task to completion without the user. Do not ask them anything (clarify and ask_user_question are not answered); decide yourself, record each decision, and keep calling the orchestrate tool until the task is complete or truly blocked." : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}

/**
 * While a bot-lobby task is active the main agent acts as the Master, so its
 * operating prompt is patched into the system prompt as one cache-stable
 * section rather than replacing the whole prompt.
 */
export function registerLifecycle(pi: ExtensionAPI, configDir: string): void {
  // Web tools the oracle put away for the task in hand, given back when it ends.
  let hiddenWeb: string[] = [];
  pi.on("session_start", (_event, ctx) => {
    // Master-only: subagents keep their own --tools allowlist (see quiet.ts).
    if (!isSubagentProcess()) registerQuietTools(pi);
    const root = detectProjectRoot(ctx.cwd, configDir);
    // A new session starts with bot-lobby off unless settings or its own task say otherwise (switch.ts).
    setMinimized(!isSubagentProcess() && !startsOn(ctx, configDir));
    applyStatus(ctx, root, configDir);
  });


  // A task's time budget counts while the oracle works on it, not while it waits on the user.
  const asking = new Set<string>();
  pi.on("agent_start", (_event, ctx) => {
    if (isSubagentProcess()) return;
    const root = detectProjectRoot(ctx.cwd, configDir);
    const task = activeTask(root, configDir, ctx.sessionManager.getSessionId());
    if (task) startClock(root, configDir, task.id);
  });
  pi.on("tool_execution_start", (event) => {
    if (isSubagentProcess()) return;
    if (ASKING_TOOLS.has(event.toolName) && !asking.has(event.toolCallId)) {
      asking.add(event.toolCallId);
      pauseClocks();
    }
  });
  pi.on("tool_execution_end", (event) => {
    if (isSubagentProcess()) return;
    if (asking.delete(event.toolCallId)) resumeClocks();
  });
  pi.on("agent_end", () => {
    if (isSubagentProcess()) return;
    for (const _call of asking) resumeClocks();
    asking.clear();
    stopClocks();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    cancelAllRuns();
    clearStatus(ctx);
  });

  pi.on("before_agent_start", (event, ctx) => {
    const root = detectProjectRoot(ctx.cwd, configDir);
    const sessionId = ctx.sessionManager.getSessionId();
    const hidden = isSubagentProcess() || isMinimized();
    const task = hidden ? undefined : activeTask(root, configDir, sessionId);
    if (!isSubagentProcess()) {
      // The researcher is the task's only web path; without a task pi keeps them.
      const tools = webToolsFor(pi.getActiveTools(), Boolean(task), hiddenWeb);
      if (tools) {
        hiddenWeb = tools.hidden;
        pi.setActiveTools(tools.active);
      }
    }
    if (!task) {
      // After a task ended and cleared the context, a line on where its record is, in case the user refers back to it.
      const previous = hidden ? undefined : previousTaskNote(ctx, configDir);
      if (previous) event.systemPromptOptions.sections["bot-lobby"] = previous;
      else delete event.systemPromptOptions.sections["bot-lobby"];
      return;
    }
    const slices = readAgentKnowledge(readDataRoots(root, configDir), "master");
    const selected = selectKnowledge(`${taskRequest(task)} ${task.proposal ?? ""}`, slices);
    event.systemPromptOptions.sections["bot-lobby"] = compilePrompt({
      domain: "master",
      task: masterTaskContext(task, readPlanComments(root, configDir, task.id), isAutoMode(root, configDir, task.id)),
      standards: selected.standards,
      knowledge: selected.knowledge,
      decisions: selected.decisions,
      workflowContext: masterWorkflowContext(task, budgetContext(root, configDir, task)),
      instructions: loadConfig().master.instructions,
    });
  });
}

