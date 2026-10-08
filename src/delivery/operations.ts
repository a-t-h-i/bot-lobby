import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Task } from "../schemas/task.ts";
import type { Delivery, DeliveryAction, DeliveryOperation, DeliveryResult } from "./types.ts";
import { refreshReview, validateReview } from "./review.ts";
import { command, type DeliveryContext } from "./transport.ts";
import { readSource } from "./source.ts";
import { recoverDeliveryLock, type LockIdentity, type LockOwner } from "./lock.ts";
import { matchingPull, publishPull } from "./pr.ts";
import { publishMerge, reconcileMerge } from "./merge.ts";

export interface DeliveryRequest { reviewId: string; action: DeliveryAction; confirmMain?: boolean }
export interface DeliveryStore {
  load(): Task; save(task: Task): void;
  identity?: { projectRoot: string; configDir: string };
  recoveryStore?(identity: LockIdentity): DeliveryStore;
}
function approved(task: Task, request: DeliveryRequest): Delivery {
  if (task.state !== "completed") throw new Error("Only completed work can be delivered.");
  if (request.action === "merge_main" && request.confirmMain !== true) throw new Error("Explicit confirmation is required: direct merge updates and pushes main, then removes the task worktree.");
  return validateReview(task, request.reviewId);
}
function intent(delivery: Delivery, action: DeliveryAction): DeliveryOperation {
  if (!delivery.sourceCommit || !delivery.targetCommit || !delivery.repository || !delivery.remote || !delivery.fingerprint) throw new Error("Review lacks a complete source/main identity. Refresh before delivery.");
  return { id: randomUUID(), action, repository: delivery.repository, remote: delivery.remote, sourceBranch: delivery.sourceBranch,
    sourceCommit: delivery.sourceCommit, targetCommit: delivery.targetCommit, target: "main", fingerprint: delivery.fingerprint,
    reviewId: delivery.reviewId, stage: "intent", startedAt: new Date().toISOString() };
}
async function refreshed(task: Task, ctx: DeliveryContext): Promise<Delivery> {
  const copy = structuredClone(task);
  delete copy.delivery!.operation; delete copy.delivery!.result;
  copy.delivery!.status = "pending_approval";
  return refreshReview(copy, ctx);
}
async function verify(task: Task, op: DeliveryOperation, ctx: DeliveryContext): Promise<void> {
  const source = await readSource(task, ctx);
  if (source.commit !== op.sourceCommit || source.branch !== op.sourceBranch || source.remote !== op.remote || source.repository !== op.repository) throw new Error("Reviewed source or remote changed. Restore it or refresh review; no further publishing was attempted.");
}
async function verifySnapshot(task: Task, op: DeliveryOperation, ctx: DeliveryContext): Promise<void> {
  await verify(task, op, ctx);
  const next = await refreshed(task, ctx);
  if (next.fingerprint !== op.fingerprint || next.blocked[op.action]) throw new Error("Source, main, checks or repository rules changed during delivery. Refresh review and explicitly approve again.");
}
function success(task: Task, result: DeliveryResult, store: DeliveryStore): Delivery {
  const delivery = task.delivery!;
  delivery.status = "successful"; delivery.result = result; delete delivery.error;
  delivery.operation!.stage = "verified";
  delivery.operation!.pullNumber = result.pullNumber; delivery.operation!.pullUrl = result.pullUrl;
  store.save(task); return delivery;
}
async function reconcile(task: Task, ctx: DeliveryContext): Promise<DeliveryResult | undefined> {
  const op = task.delivery!.operation!;
  const common = realpathSync(resolve(ctx.cwd, await command(ctx, "git", ["rev-parse", "--git-common-dir"])));
  const remote = await command(ctx, "git", ["remote", "get-url", "origin"]);
  if (common !== op.repository || remote !== op.remote) throw new Error("Approved repository or remote changed; restore it before reconciliation.");
  return op.action === "create_pr" ? matchingPull(ctx, op) : reconcileMerge(ctx, op);
}
async function prepare(task: Task, request: DeliveryRequest, ctx: DeliveryContext, store: DeliveryStore, operationId: string): Promise<boolean> {
  const old = task.delivery!;
  const next = await refreshed(task, ctx);
  if (next.reviewId !== request.reviewId || next.fingerprint !== old.fingerprint) {
    next.operation = old.operation; next.error = "Review changed. Inspect refreshed source, main and verification and choose an action again. Recorded operations require reconciliation before replacement.";
    task.delivery = next; store.save(task); return false;
  }
  if (next.blocked[request.action]) throw new Error(next.blocked[request.action]);
  task.delivery = next; next.previousOperations = old.previousOperations;
  next.operation = reapprove(old, next, request.action, operationId);
  if (request.action === "merge_main" && task.git?.mode === "worktree") next.operation.worktreePath ??= task.git.path;
  task.delivery.status = "in_progress"; delete task.delivery.error;
  store.save(task); return true;
}
function reapprove(old: Delivery, next: Delivery, action: DeliveryAction, operationId: string): DeliveryOperation {
  const op = old.operation;
  if (op?.action === action && op.fingerprint === next.fingerprint) return { ...op, reviewId: next.reviewId };
  if (op) next.previousOperations = [...(old.previousOperations ?? []), { ...op, stage: "superseded_not_delivered" }].slice(-10);
  return { ...intent(next, action), id: operationId === op?.id ? randomUUID() : operationId };
}
async function trustedRecovery(owner: LockOwner, ctx: DeliveryContext, store: DeliveryStore): Promise<{ task: Task; recovery: DeliveryStore }> {
  if (!owner.identity || !store.recoveryStore) throw new Error("Interrupted owner lacks a trusted recovery identity; recovery is blocked.");
  const recovery = store.recoveryStore(owner.identity);
  const root = realpathSync(owner.identity.projectRoot);
  const recordedCommon = realpathSync(resolve(root, await command({ ...ctx, cwd: root }, "git", ["rev-parse", "--git-common-dir"])));
  const common = realpathSync(resolve(ctx.cwd, await command(ctx, "git", ["rev-parse", "--git-common-dir"])));
  if (recordedCommon !== common) throw new Error("Interrupted owner's canonical repository does not match this target.");
  const task = recovery.load();
  if (task.id !== owner.identity.taskId) throw new Error("Interrupted task identity mismatch.");
  const op = task.delivery?.operation;
  if (op && op.id !== owner.identity.operationId && !task.delivery!.previousOperations?.some((previous) => previous.id === owner.identity!.operationId && previous.stage === "superseded_not_delivered")) throw new Error("Interrupted operation identity changed; recovery is blocked.");
  return { task, recovery };
}
async function recoverOwner(owner: LockOwner, ctx: DeliveryContext, store: DeliveryStore): Promise<void> {
  const { task, recovery } = await trustedRecovery(owner, ctx, store);
  if (!task.delivery?.operation) return;
  try {
    const result = await reconcile(task, ctx);
    if (result) { success(task, result, recovery); return; }
    task.delivery!.status = "recoverable_failure";
    task.delivery!.error = "Interrupted operation reconciled without delivery; explicitly approve the current review to retry.";
    recovery.save(task);
  } catch (error) {
    task.delivery!.status = "recoverable_failure"; task.delivery!.error = (error as Error).message;
    recovery.save(task); throw error;
  }
}
async function execute(task: Task, request: DeliveryRequest, ctx: DeliveryContext, store: DeliveryStore, operationId: string): Promise<Delivery> {
  if (task.delivery?.status === "successful") return task.delivery;
  const delivery = approved(task, request);
  try {
    if (delivery.operation) { const result = await reconcile(task, ctx); if (result) return success(task, result, store); }
    if (!await prepare(task, request, ctx, store, operationId)) return task.delivery!;
    const op = task.delivery!.operation!;
    const save = () => store.save(task);
    const check = () => verifySnapshot(task, op, ctx);
    const result = op.action === "create_pr" ? await publishPull(ctx, op, save, check) : await publishMerge(ctx, op, save, check);
    return success(task, result, store);
  } catch (error) {
    task.delivery!.status = task.delivery!.operation ? "recoverable_failure" : "pending_approval";
    task.delivery!.error = (error as Error).message; store.save(task); return task.delivery!;
  }
}
async function cleanupWorktree(task: Task, ctx: DeliveryContext, store: DeliveryStore): Promise<Delivery> {
  const delivery = task.delivery!, op = delivery.operation;
  if (!op?.worktreePath || op.worktreeRemoved) return delivery;
  try {
    if (existsSync(op.worktreePath)) {
      if (task.git?.mode !== "worktree" || task.git.path !== op.worktreePath) throw new Error("Task worktree changed since approval; it was retained.");
      await verify(task, op, ctx);
      await command(ctx, "git", ["worktree", "remove", op.worktreePath]);
    }
    op.worktreeRemoved = true;
    delete delivery.cleanupError;
  } catch (error) {
    delivery.cleanupError = `Main was delivered, but the task worktree was retained: ${(error as Error).message}`;
  }
  store.save(task);
  return delivery;
}

/** Lock covers refresh, user approval, durable intent, reconciliation and cleanup. */
export async function deliver(request: DeliveryRequest, ctx: DeliveryContext, store: DeliveryStore): Promise<Delivery> {
  const common = realpathSync(resolve(ctx.cwd, await command(ctx, "git", ["rev-parse", "--git-common-dir"])));
  const task = store.load();
  const operationId = task.delivery?.operation?.id ?? randomUUID();
  const identity = store.identity && { ...store.identity, taskId: task.id, operationId };
  const release = await recoverDeliveryLock(common, identity, (owner) => recoverOwner(owner, ctx, store));
  const lockedStore = { ...store, save: (value: Task) => {
    store.save(value);
    if (value.delivery?.operation) release.setOperation(value.delivery.operation.id);
  } };
  try {
    const result = await execute(store.load(), request, ctx, lockedStore, operationId);
    if (result.status !== "successful" || result.result?.action !== "merge_main" || request.action !== "merge_main") return result;
    const latest = lockedStore.load();
    approved(latest, request);
    return await cleanupWorktree(latest, ctx, lockedStore);
  }
  finally { release(); }
}
