import { createHash, randomUUID } from "node:crypto";
import type { Task } from "../schemas/task.ts";
import { completionBlockers } from "../master/decisions.ts";
import { pendingApprovals } from "../workflow/approvals.ts";
import { qaRequired } from "../workflow/track.ts";
import type { Delivery } from "./types.ts";
import { readSource, refreshMain, type Source } from "./source.ts";
import { readChecks, type Checks } from "./checks.ts";
import { readRules, type Rules } from "./rules.ts";
import type { DeliveryContext } from "./transport.ts";

export function localVerified(task: Task): boolean {
  return task.state === "completed" && !task.qaWaiver && !task.lintWaiver && completionBlockers(task, pendingApprovals(task).length).length === 0
    && (!qaRequired(task) || task.qaVerdict === "pass");
}
export function newDelivery(task: Task, project: string): Delivery {
  return { status: "pending_approval", reviewId: randomUUID(), project, sourceBranch: task.git?.branch ?? "unavailable",
    target: "main", reviewedAt: new Date().toISOString(), blocked: { create_pr: "Refresh review to verify the task source.", merge_main: "Refresh review to verify source, main, checks and repository rules." } };
}
export async function completionReview(task: Task, project: string, ctx: DeliveryContext): Promise<Delivery> {
  const delivery = newDelivery(task, project);
  try { const source = await readSource(task, ctx); applySource(delivery, source); delete delivery.blocked.create_pr; }
  catch (error) { delivery.error = (error as Error).message; delivery.blocked = { create_pr: delivery.error, merge_main: delivery.error }; }
  return delivery;
}
function applySource(delivery: Delivery, source: Source): void {
  delivery.repository = source.repository;
  delivery.remote = source.remote;
  delivery.sourceBranch = source.branch;
  delivery.sourceCommit = source.commit;
}
function mergeReason(checks: Checks, rules: Rules, verified: boolean): string | undefined {
  if (!rules.known || rules.blocked) return rules.blocked;
  if (["unavailable", "stale", "pending", "failing"].includes(checks.state)) return checks.reason ?? `Checks are ${checks.state}. Resolve them and refresh review, then choose Merge again.`;
  const missing = rules.required.filter((name) => !checks.entries.some((entry) => entry.name === name && entry.state === "passing"));
  if (missing.length) return `Required checks missing or not passing: ${missing.join(", ")}. Run them and refresh review.`;
  if (!verified) return "Local completion/QA verification is not passing. Obtain a QA pass; a waiver is not delivery verification.";
  if (checks.state === "absent" && rules.required.length) return "Required repository checks are absent. Run them before merging.";
}
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:_at|url|^id$|node_id)$/.test(key))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, semantic(item)]));
}
function fingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(semantic(value))).digest("hex"); }
async function preflight(task: Task, delivery: Delivery, ctx: DeliveryContext): Promise<unknown> {
  const source = await readSource(task, ctx);
  applySource(delivery, source);
  delete delivery.blocked.create_pr;
  const sourceCtx = { ...ctx, cwd: source.cwd };
  try { delivery.targetCommit = await refreshMain(sourceCtx); }
  catch (error) { delivery.blocked.create_pr = "Target main is unavailable. Restore remote access and main, then refresh review."; throw error; }
  const checks = await readChecks(sourceCtx, source.github, source.commit);
  const rules = await readRules(sourceCtx, source.github);
  const verified = localVerified(task);
  delivery.verification = { checks: checks.state, summary: checks.reason ?? `Remote checks: ${checks.state}. Local completion/QA: ${verified ? "passing" : "not verified"}.`, localVerified: verified, requiredChecks: rules.required, rulesKnown: rules.known };
  const reason = mergeReason(checks, rules, verified);
  delivery.blocked.merge_main = reason;
  if (!reason) delete delivery.blocked.merge_main;
  return { source, main: delivery.targetCommit, checks, rules, verified };
}
/** Read-only preflight apart from fetching the remote tracking ref; never publishes. */
export async function refreshReview(task: Task, ctx: DeliveryContext): Promise<Delivery> {
  if (!task.delivery) throw new Error("This historical task has no delivery review; no retroactive approval was created.");
  if (["successful", "in_progress"].includes(task.delivery.status)) return task.delivery;
  const delivery = structuredClone(task.delivery);
  delete delivery.error;
  delivery.blocked.create_pr = "Task source could not be verified. Restore its clean branch and refresh review.";
  delete delivery.verification;
  delete delivery.targetCommit;
  let snapshot: unknown;
  try { snapshot = await preflight(task, delivery, ctx); }
  catch (error) { delivery.error = (error as Error).message; delivery.blocked.merge_main = delivery.error; snapshot = { source: delivery.sourceCommit, main: delivery.targetCommit, error: delivery.error }; }
  const next = fingerprint(snapshot);
  if (delivery.fingerprint !== next) { delivery.reviewId = randomUUID(); delivery.status = "pending_approval"; delivery.reviewedAt = new Date().toISOString(); }
  delivery.fingerprint = next;
  task.delivery = delivery;
  return delivery;
}
export function deferReview(task: Task, reviewId: string): Delivery {
  const delivery = validateReview(task, reviewId);
  if (delivery.operation || ["successful", "in_progress"].includes(delivery.status)) throw new Error("Delivery already started or succeeded; reconcile it before deferring.");
  delivery.status = "deferred";
  return delivery;
}
export function validateReview(task: Task, reviewId: string): Delivery {
  if (!task.delivery || task.delivery.reviewId !== reviewId) throw new Error("Review changed. Refresh and review the new source, main and verification before choosing an action.");
  return task.delivery;
}
