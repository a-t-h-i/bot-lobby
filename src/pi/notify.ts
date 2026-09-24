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

/** Emit one ping when an approval is first recorded; never from a subagent. */
export function pingApproval(domain: string, detail: string): void {
  if (isSubagentProcess()) return;
  process.stderr.write(formatApprovalNotice(domain, detail));
}
