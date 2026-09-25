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
import { isSubagentProcess, visibleTools } from "./quiet.ts";
import { registerQuietTools } from "./tool-renderers.ts";
import { taskRequest, type Task } from "../schemas/task.ts";

function masterTaskContext(task: Task): string {
  return [
    `Task ${task.id}: ${task.title}`,
    `Request: ${truncate(taskRequest(task), 2000)}`,
    task.proposal ? `Current proposal:\n${truncate(task.proposal, 2000)}` : "",
    task.plan ? `Approved plan:\n${truncate(task.plan, 3000)}` : "",
    task.amendments.length > 0 ? `User amendments:\n${task.amendments.map((entry) => `- ${entry}`).join("\n")}` : "",
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
  pi.on("session_start", (_event, ctx) => {
    // Master-only: subagents keep their own --tools allowlist (see quiet.ts).
    if (!isSubagentProcess()) {
      registerQuietTools(pi);
      pi.setActiveTools(visibleTools(pi.getActiveTools()));
    }
    const root = detectProjectRoot(ctx.cwd, configDir);
    setMinimized(false);
    applyStatus(ctx, root, configDir);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    cancelAllRuns();
    clearStatus(ctx);
  });

  pi.on("before_agent_start", (event, ctx) => {
    const root = detectProjectRoot(ctx.cwd, configDir);
    const sessionId = ctx.sessionManager.getSessionId();
    const task = isSubagentProcess() || isMinimized() ? undefined : activeTask(root, configDir, sessionId);
    if (!task) {
      delete event.systemPromptOptions.sections["bot-lobby"];
      return;
    }
    const slices = readAgentKnowledge(readDataRoots(root, configDir), "master");
    const selected = selectKnowledge(`${taskRequest(task)} ${task.proposal ?? ""}`, slices);
    event.systemPromptOptions.sections["bot-lobby"] = compilePrompt({
      domain: "master",
      task: masterTaskContext(task),
      standards: selected.standards,
      knowledge: selected.knowledge,
      decisions: selected.decisions,
      workflowContext: describeTask(task),
      instructions: loadConfig().master.instructions,
    });
  });
}

