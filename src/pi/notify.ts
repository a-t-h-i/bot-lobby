import type { TaskState } from "../schemas/task.ts";
import { isSubagentProcess } from "./quiet.ts";

/** States worth an attention ping; every other transition stays silent. */
const PING_LABELS: Partial<Record<TaskState, string>> = {
  completed: "done",
  blocked: "blocked",
  awaiting_approval: "needs approval",
};

/** Strip control characters so a title can never break out of the OSC payload. */
function sanitize(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
}

function notice(text: string): string {
  return `\x07\x1b]9;${sanitize(text)}\x07`;
}

/** Terminal payload for one attention ping, or undefined when the state is not ping-worthy. Pure. */
export function formatNotice(state: TaskState, title: string): string | undefined {
  const label = PING_LABELS[state];
  return label ? notice(`${title || "task"} ${label}`) : undefined;
}

/** Terminal payload for a worker-requested dependency or architecture approval. Pure. */
export function formatApprovalNotice(domain: string, detail: string): string {
  return notice(`${domain} approval needed: ${detail}`);
}

/** Emit a ping outside the TUI frame; never from a subagent process. */
export function ping(state: TaskState, title: string): void {
  if (isSubagentProcess()) return;
  const payload = formatNotice(state, title);
  if (payload) process.stderr.write(payload);
}

const waiting = new Set<string>();

/**
 * Ping for a task's new state. A proposal approved without asking (auto mode,
 * a plan agreed in the planning panel, or approvals switched off) passes
 * through awaiting_approval within one step, so that ping waits a tick and
 * fires once, only if the task still waits for the user.
 */
export function pingTransition(task: { id: string; state: TaskState; title: string }, later: (fn: () => void) => void = queueMicrotask): void {
  if (task.state !== "awaiting_approval") return ping(task.state, task.title);
  if (waiting.has(task.id)) return;
  waiting.add(task.id);
  later(() => {
    waiting.delete(task.id);
    if (task.state === "awaiting_approval") ping(task.state, task.title);
  });
}

/** Emit one ping when an approval is first recorded; never from a subagent. */
export function pingApproval(domain: string, detail: string): void {
  if (isSubagentProcess()) return;
  process.stderr.write(formatApprovalNotice(domain, detail));
}
