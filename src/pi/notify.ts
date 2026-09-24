import type { TaskState } from "../schemas/task.ts";
import { isSubagentProcess } from "./quiet.ts";

/** States worth an attention ping; every other transition stays silent. */
const PING_LABELS: Partial<Record<TaskState, string>> = {
  completed: "done",
  blocked: "blocked",
  awaiting_approval: "needs approval",
};

/**
 * Terminal payload for one attention ping (BEL + OSC-9 desktop notification),
 * or undefined when the state is not ping-worthy. Pure.
 */
export function formatNotice(state: TaskState, title: string): string | undefined {
  const label = PING_LABELS[state];
  if (!label) return undefined;
  return `\x07\x1b]9;${title || "task"} ${label}\x07`;
}

/** Emit a ping outside the TUI frame; never from a subagent process. */
export function ping(state: TaskState, title: string): void {
  if (isSubagentProcess()) return;
  const notice = formatNotice(state, title);
  if (notice) process.stderr.write(notice);
}
