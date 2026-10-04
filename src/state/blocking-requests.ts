import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { loadTask, saveTask } from "./persistence.ts";
import { blockPhaseTiming, resolvePhaseTiming } from "./phase-timing.ts";

export interface TaskRequestIdentity { root: string; configDir: string; taskId: string; sessionId?: string }
export const blockingRequestContext = new AsyncLocalStorage<TaskRequestIdentity & { requestId: string }>();

/** Always mutate a fresh authoritative task, never the workflow's long-lived copy. */
export function updateBlockingRequest(identity: TaskRequestIdentity, id: string, pending: boolean): void {
  const task = loadTask(identity.root, identity.configDir, identity.taskId);
  if (!task || (identity.sessionId && task.ownerSessionId !== identity.sessionId)) return;
  if (pending) blockPhaseTiming(task, id);
  else resolvePhaseTiming(task, id);
  saveTask(identity.root, identity.configDir, task);
}

export async function withBlockingRequest<T>(identity: TaskRequestIdentity, run: () => Promise<T>): Promise<T> {
  const id = `request:${randomUUID()}`;
  updateBlockingRequest(identity, id, true);
  try { return await blockingRequestContext.run({ ...identity, requestId: id }, run); }
  finally { updateBlockingRequest(identity, id, false); }
}
