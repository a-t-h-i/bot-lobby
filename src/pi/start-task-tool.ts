/**
 * `start_task`: the Master's own way to turn a lobby request into a task.
 * In the lobby chat it judges each message: a question or a small change it
 * does itself; work that is large, risky or spans several areas it hands to
 * the team by starting a task here, the same as the user typing `/task`.
 * The task's track (fast or full) still comes from the effort and triage
 * reads, and the kickoff follows the current turn, in a fresh context.
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
import type { TrackPath } from "../schemas/task.ts";

export const START_TASK_TOOL = "start_task";

const Params = Type.Object({
  request: Type.String({ minLength: 1, maxLength: 8000, description: "The work, written in full for the team: what the user wants, the files or areas you already know it touches, and any constraint they gave. The task starts in a fresh context, so this must stand on its own." }),
  title: Type.Optional(Type.String({ maxLength: 80, description: "A short title (3-8 words); derived from the request when absent." })),
  track: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("full")], { description: "Only when you are sure: fast (small and clear, straight to the agents) or full (scouts, proposal, QA). Left out, the effort read picks." })),
  auto: Type.Optional(Type.Boolean({ description: "true only when the user asked for it to run without them (no proposal approval or questions)." })),
});

type StartTaskParams = { request: string; title?: string; track?: TrackPath; auto?: boolean };

const DESCRIPTION = [
  "Start a bot-lobby task from the lobby chat and hand the work to the team (scouts, DESIGN/DEV workers, QA), the same as the user typing /task.",
  "Use it when the request is too big to do well yourself in one reply: several files or areas, a new feature, a risky or architectural change, or work that needs tests and review.",
  "Do questions, explanations and small, clear edits yourself instead.",
  "After calling it, tell the user in one short line that you started a task and why, then end your turn: the task's kickoff follows.",
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
    ],
    parameters: Params,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const call = params as StartTaskParams;
      if (isMinimized()) throw new Error("bot-lobby is off in this session; do the work yourself or ask the user to turn it on.");
      const root = detectProjectRoot(ctx.cwd, configDir);
      const current = activeTask(root, configDir, ctx.sessionManager.getSessionId());
      if (current) throw new Error(`this session already drives ${current.id}; use the orchestrate tool for it.`);
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
      const details = result.details as { taskId?: string; track?: string } | undefined;
      if (!details?.taskId) return new Container();
      return new Text(`${theme.fg("success", "✓")} ${theme.fg("accent", details.taskId)}${details.track ? ` ${theme.fg("muted", details.track)}` : ""}`, 0, 0);
    },
  });
}
