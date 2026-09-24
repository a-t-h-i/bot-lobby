import type { Approval, ApprovalKind, Task } from "../schemas/task.ts";
import type { Domain } from "../schemas/agent.ts";

/** Record a Worker-requested exception so it blocks further work until resolved. */
export function requestApproval(
  task: Task,
  kind: ApprovalKind,
  domain: Domain,
  detail: string,
  now = new Date().toISOString(),
): Approval {
  const approval: Approval = { id: `APR-${task.approvals.length + 1}`, kind, domain, detail, status: "pending", createdAt: now };
  task.approvals.push(approval);
  return approval;
}

export function pendingApprovals(task: Task, domain?: Domain): Approval[] {
  return task.approvals.filter(
    (approval) => approval.status === "pending" && (domain === undefined || approval.domain === domain),
  );
}

export function resolveApproval(
  task: Task,
  id: string,
  status: "approved" | "rejected",
  note?: string,
): Approval | undefined {
  const approval = task.approvals.find((entry) => entry.id === id && entry.status === "pending");
  if (!approval) return undefined;
  approval.status = status;
  approval.note = note;
  return approval;
}

/**
 * Engine gate: a domain cannot keep implementing while it has an unresolved
 * dependency or architecture request.
 */
export function assertNoPendingApprovals(task: Task, domain: Domain): void {
  const pending = pendingApprovals(task, domain);
  if (pending.length === 0) return;
  const list = pending.map((approval) => `${approval.id} (${approval.kind}): ${approval.detail}`).join("; ");
  throw new Error(`${domain} has unresolved approvals — resolve them first: ${list}`);
}
