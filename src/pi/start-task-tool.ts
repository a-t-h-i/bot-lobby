/**
 * `start_task`: the Master's own way to turn a lobby request into a task.
 * In the lobby chat it judges each message: a question or a small change it
 * does itself; work that is large, risky or spans several areas it hands to
 * the team by starting a task here, the same as the user typing `/task`.
 * The task's track (fast or full) still comes from the effort and triage
 * reads, and the kickoff follows the current turn in this same conversation.
 * While it drives a task, a message that is separate work starts its task in
 * a new background session instead, and the current task carries on.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isSubagentProcess } from "./quiet.ts";
import { isMinimized } from "./ui.ts";
import { startTask } from "./start-task.ts";
import { activeTask } from "../state/persistence.ts";
import { detectProjectRoot } from "../state/project.ts";
import { lobbyFeed } from "../lobby/feed.ts";
import { lobbyTopics } from "../lobby/topics.ts";
import { startTaskInNewSession } from "../lobby/service.ts";
import type { TrackPath } from "../schemas/task.ts";

export const START_TASK_TOOL = "start_task";

const Params = Type.Object({
  request: Type.String({ minLength: 1, maxLength: 8000, description: "The work, written in full for the team: what the user wants, the files or areas you already know it touches, and any constraint they gave. The team's agents do not see this chat, so this must stand on its own." }),
  title: Type.Optional(Type.String({ maxLength: 80, description: "A short title (3-8 words); derived from the request when absent." })),
  track: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("full")], { description: "Only when you are sure: fast (small and clear, straight to the agents) or full (scouts, proposal, QA). Left out, the effort read picks." })),
  auto: Type.Optional(Type.Boolean({ description: "true only when the user asked for it to run without them (no proposal approval or questions)." })),
});

type StartTaskParams = { request: string; title?: string; track?: TrackPath; auto?: boolean };

const DESCRIPTION = [
  "Start a bot-lobby task from the lobby chat and hand the work to the team (scouts, DESIGN/DEV workers, QA), the same as the user typing /task.",
  "Use it when the request is too big to do well yourself in one reply: several files or areas, a new feature, a risky or architectural change, or work that needs tests and review.",
  "Do questions, explanations and small, clear edits yourself instead.",
  "While you drive a task, use it only for separate work that does not belong to that task: it starts in its own session and your task carries on. Work that changes or extends your task is a step of it (amend the plan), not a new task.",
  "After calling it, tell the user in one short line that you started a task and why. With no task running, end your turn: the task's kickoff follows.",
].join(" ");

export function registerStartTaskTool(pi: ExtensionAPI, configDir: string): void {
  if (isSubagentProcess()) return;
  pi.registerTool({
    name: START_TASK_TOOL,
    label: "Start task",
    description: DESCRIPTION,
    promptSnippet: "Turn a large lobby request into a bot-lobby task the team works on",
    promptGuidelines: [
      "In the lobby chat, judge each request: do small things yourself; call start_task for work that spans several areas, needs a plan, or needs tests and review.",
      "While driving a task, judge each user message: a change to this task becomes a step (amend the plan); separate, sizeable work goes to start_task; a question or tiny unrelated fix you handle yourself.",
    ],
    parameters: Params,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const call = params as StartTaskParams;
      if (isMinimized()) throw new Error("bot-lobby is off in this session; do the work yourself or ask the user to turn it on.");
      const root = detectProjectRoot(ctx.cwd, configDir);
      const current = activeTask(root, configDir, ctx.sessionManager.getSessionId());
      if (current) {
        const started = startTaskInNewSession(call.request.trim(), { ...(call.track ? { track: call.track } : {}), ...(call.auto ? { auto: true } : {}) });
        if (typeof started === "string") throw new Error(`${started}. Add it to ${current.id} as a step, or tell the user to start it with /task from another session.`);
        lobbyFeed.log("LOBBY", `the orchestrator started separate work in a new session: ${started.name}`, "info");
        return {
          content: [{ type: "text", text: `Started "${started.name}" in its own session; ${current.id} carries on here. Tell the user in one line and continue your task.` }],
          details: { session: started.name },
        };
      }
      lobbyFeed.log("LOBBY", "the orchestrator is starting a task for this request", "info");
      const task = await startTask(pi, ctx, configDir, call.request.trim(), {
        ...(call.title?.trim() ? { title: call.title.trim() } : {}),
        ...(call.track ? { track: call.track } : {}),
        ...(call.auto ? { auto: true } : {}),
      });
      if (!task) throw new Error("the task did not start: this session already drives one.");
      lobbyTopics.bump("tasks");
      const path = task.track?.path === "fast" ? "fast track: straight to the agents" : "full track: scouts, then a proposal for the user";
      return {
        content: [{ type: "text", text: `Started ${task.id} (${task.title}), ${path}. Tell the user in one line and end your turn; the kickoff follows.` }],
        details: { taskId: task.id, title: task.title, track: task.track?.path },
      };
    },
    renderCall(args, theme) {
      const call = args as Partial<StartTaskParams>;
      return new Text(`${theme.fg("toolTitle", theme.bold("start task"))}${call.title ? ` ${theme.fg("accent", call.title)}` : ""}`, 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as { taskId?: string; track?: string; session?: string } | undefined;
      if (details?.session) return new Text(`${theme.fg("success", "✓")} ${theme.fg("accent", details.session)} ${theme.fg("muted", "new session")}`, 0, 0);
      if (!details?.taskId) return new Container();
      return new Text(`${theme.fg("success", "✓")} ${theme.fg("accent", details.taskId)}${details.track ? ` ${theme.fg("muted", details.track)}` : ""}`, 0, 0);
    },
  });
}
