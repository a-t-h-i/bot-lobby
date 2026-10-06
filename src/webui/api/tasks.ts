/**
 * The Tasks tab over HTTP: rows, archived tasks, plan comments, and the row
 * actions (comment, archive, restore, delete, auto mode, message). The row
 * shape is `TaskRow` in `src/lobby/task-rows.ts`.
 */
import { TERMINAL_STATES, taskRequest, type Task } from "../../schemas/task.ts";
import type { PlanComment } from "../../state/comments.ts";
import type { PlannedTask } from "../../state/backlog.ts";
import { describeRun, runFromLog } from "../../pi/run-summary.ts";
import { pendingApprovals } from "../../workflow/approvals.ts";
import type { TaskRow } from "../../lobby/task-rows.ts";
import type { TaskDetail } from "../protocol.ts";
import type { ApiContext } from "./index.ts";
import { withAttachments } from "../uploads.ts";
import { fail } from "./index.ts";
import { stepViews } from "./plan-facts.ts";
import { planDetails } from "../../pi/plan-checklist.ts";
import type { WorkProjection } from "../../state/work-time.ts";
import type { TaskSection } from "../../lobby/task-rows.ts";
import { projectPhaseTiming } from "../../state/phase-timing.ts";
import { resumable, type Drivers } from "../../lobby/resume.ts";
import type { DeliveryRequest } from "../../delivery/operations.ts";

function deliveryTask(body: { taskId: string }, ctx: ApiContext): Task {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(body.taskId)) fail(400, "bad_request", "invalid task ID");
  const task = ctx.service.tasks().find((entry) => entry.id === body.taskId);
  if (!task) fail(404, "not_found", "task not found in this project");
  if (task.state !== "completed" || !task.delivery) fail(400, "bad_request", "this task has no completed-work delivery review");
  return task;
}
export async function tasksDeliveryReview(body: { taskId: string }, ctx: ApiContext) {
  deliveryTask(body, ctx);
  if (!ctx.service.deliveryReview) fail(400, "bad_request", "delivery review is unavailable");
  try { return { delivery: await ctx.service.deliveryReview(body.taskId) }; }
  catch (error) { return fail(400, "bad_request", (error as Error).message); }
}
export async function tasksDeliver(body: { taskId: string } & DeliveryRequest, ctx: ApiContext) {
  const task = deliveryTask(body, ctx);
  if (task.delivery!.reviewId !== body.reviewId) fail(409, "conflict", "review changed; refresh before delivery");
  if (body.action === "merge_main" && body.confirmMain !== true) fail(400, "bad_request", "confirm that direct merge updates and pushes main");
  if (!ctx.service.deliveryDeliver) fail(400, "bad_request", "delivery is unavailable");
  try { return { delivery: await ctx.service.deliveryDeliver(body.taskId, body) }; }
  catch (error) { return fail(409, "conflict", (error as Error).message); }
}
export function tasksDeliveryDefer(body: { taskId: string; reviewId: string }, ctx: ApiContext) {
  const task = deliveryTask(body, ctx);
  if (task.delivery!.reviewId !== body.reviewId) fail(409, "conflict", "review changed; refresh before deferring");
  if (!ctx.service.deliveryDefer) fail(400, "bad_request", "delivery review is unavailable");
  try { return { delivery: ctx.service.deliveryDefer(body.taskId, body.reviewId) }; }
  catch (error) { return fail(400, "bad_request", (error as Error).message); }
}

interface RowContext {
  names: ReadonlyMap<string, string>;
  auto: ReadonlySet<string>;
  live: ReadonlySet<string>;
  /** Names of the sessions in other terminals, when they have one. */
  liveNames: ReadonlyMap<string, string>;
  /** Who could be driving each task, for Resume. */
  drivers: Drivers;
  work: (taskId: string) => WorkProjection | undefined;
}

function checkOf(task: Task): TaskRow["check"] {
  if (task.state === "completed") return "done";
  if (task.state === "abandoned") return "dropped";
  return "open";
}

function progressOf(task: Task, work: WorkProjection | undefined, now: number): TaskRow["progress"] {
  const steps = stepViews(task, work, now);
  if (steps.length === 0) return undefined;
  return { done: steps.filter((step) => step.status === "done").length, total: steps.length };
}

/** The work clock as the page shows it; a finished task's no longer counts. */
function clockOf(task: Task, work: WorkProjection | undefined): TaskRow["work"] {
  if (!work) return undefined;
  return { workedMs: Math.round(work.workedMs), running: work.running && !TERMINAL_STATES.includes(task.state) };
}

/** How long ago, as `3h` (mirrors the lobby layout's `ago`). */
function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 5_000) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ownerOf(task: Task, sessionId: string | undefined, ctx: RowContext): string {
  const name = task.ownerSessionId ? ctx.names.get(task.ownerSessionId) : undefined;
  if (name) return name === task.title ? "background" : `background · ${name}`;
  // Resumed from the Tasks screen: its background session is starting.
  if (ctx.drivers.carrying.has(task.id)) return "background";
  if (!task.ownerSessionId) return "not running";
  if (task.ownerSessionId === sessionId) return "this session";
  if (!ctx.live.has(task.ownerSessionId)) return "not running";
  const other = ctx.liveNames.get(task.ownerSessionId);
  return other && other !== task.title ? `other terminal · ${other}` : "other terminal";
}

function rowOf(task: Task, section: TaskSection, ctx: RowContext, sessionId: string | undefined, now: number): TaskRow {
  const work = ctx.work(task.id);
  const progress = section === "recent" ? undefined : progressOf(task, work, now);
  const clock = clockOf(task, work);
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    section,
    status: task.state,
    timing: projectPhaseTiming(task, new Date(now).toISOString()),
    ...(task.delivery ? { delivery: { status: task.delivery.status, reviewId: task.delivery.reviewId } } : {}),
    ...(task.paused && section !== "recent" ? { paused: true } : {}),
    check: checkOf(task),
    ...(progress ? { progress } : {}),
    ...(clock ? { work: clock } : {}),
    ...(section === "others" ? { owner: ownerOf(task, sessionId, ctx) } : {}),
    ...(section === "recent" ? { age: ago(now - Date.parse(task.updatedAt)) } : {}),
    ...(section !== "recent" && ctx.auto.has(task.id) ? { auto: true } : {}),
    ...(section !== "recent" && resumable(task, ctx.drivers) ? { resumable: true } : {}),
  };
}

/** Rows in display order, mirroring the terminal's `taskRows` (without its search narrowing). */
function buildRows(tasks: readonly Task[], plans: readonly PlannedTask[], sessionId: string | undefined, ctx: RowContext, now: number, archived: readonly Task[]): TaskRow[] {
  const active = tasks.filter((task) => !TERMINAL_STATES.includes(task.state));
  return [
    ...active.filter((task) => sessionId && task.ownerSessionId === sessionId).map((task) => rowOf(task, "mine", ctx, sessionId, now)),
    ...active.filter((task) => !sessionId || task.ownerSessionId !== sessionId).map((task) => rowOf(task, "others", ctx, sessionId, now)),
    ...plans.filter((plan) => plan.status === "pending").map((plan): TaskRow => ({
      kind: "plan",
      id: plan.id,
      title: plan.split ? `${plan.title} (${plan.split.part}/${plan.split.of})` : plan.title,
      section: "pending",
      status: "pending",
      check: "open",
      ...(plan.createdAt ? { age: ago(now - Date.parse(plan.createdAt)) } : {}),
      ...(plan.issue ? { issue: plan.issue.number } : {}),
    })),
    ...tasks.filter((task) => TERMINAL_STATES.includes(task.state)).map((task) => rowOf(task, "recent", ctx, sessionId, now)),
    ...archived.map((task): TaskRow => ({
      kind: "archived",
      id: task.id,
      title: task.title,
      section: "archived",
      status: task.state,
      timing: projectPhaseTiming(task, new Date(now).toISOString()),
      ...(task.delivery ? { delivery: { status: task.delivery.status, reviewId: task.delivery.reviewId } } : {}),
      check: checkOf(task),
      age: ago(now - Date.parse(task.archivedAt ?? task.updatedAt)),
    })),
  ];
}

function contextOf(ctx: ApiContext, tasks: readonly Task[]): RowContext {
  const names = new Map<string, string>();
  const carrying = new Set<string>();
  for (const session of ctx.service.sessions()) {
    if (!session.alive) continue;
    if (session.sessionId) names.set(session.sessionId, session.name);
    if (session.taskId) carrying.add(session.taskId);
  }
  const auto = new Set(tasks.filter((task) => !TERMINAL_STATES.includes(task.state) && ctx.service.isAuto(task.id)).map((task) => task.id));
  const sessions = ctx.service.liveSessions();
  const live = new Set(sessions.map((session) => session.sessionId));
  const liveNames = new Map(sessions.flatMap((session) => (session.name ? [[session.sessionId, session.name] as const] : [])));
  const me = ctx.service.sessionId();
  const drivers: Drivers = { ...(me ? { me } : {}), background: new Set(names.keys()), carrying, live };
  return { names, auto, live, liveNames, drivers, work: (taskId) => ctx.service.work?.(taskId) };
}

/** Every task, plan and recent row, oldest groups first like the terminal. */
export function tasksList(ctx: ApiContext): { rows: TaskRow[] } {
  const tasks = ctx.service.tasks();
  const rows = buildRows(tasks, ctx.service.plans(), ctx.service.sessionId(), contextOf(ctx, tasks), Date.now(), []);
  return { rows };
}

/** Archived tasks as rows, most recently archived first. */
export function tasksArchived(ctx: ApiContext): { rows: TaskRow[] } {
  const archived = ctx.service.archivedTasks();
  const rows = archived.map((task): TaskRow => ({
    kind: "archived",
    id: task.id,
    title: task.title,
    section: "archived",
    status: task.state,
    timing: projectPhaseTiming(task),
    ...(task.delivery ? { delivery: { status: task.delivery.status, reviewId: task.delivery.reviewId } } : {}),
    check: checkOf(task),
    age: ago(Date.now() - Date.parse(task.archivedAt ?? task.updatedAt)),
  }));
  return { rows };
}

/** One task's plan comments, oldest first. */
export function tasksComments(body: { taskId: string }, ctx: ApiContext): { comments: unknown[] } {
  return { comments: ctx.service.comments(body.taskId) };
}

/** Comment on a task's plan; blank text is a no-op notice like the lobby's. */
export function tasksComment(body: { taskId: string; text: string; attachments?: string[] }, ctx: ApiContext): { notice?: string } {
  if (!body.text.trim() && !body.attachments?.length) return { notice: "type something first" };
  return { notice: ctx.service.comment(body.taskId, withAttachments(body.text, body.attachments, body.taskId, ctx.service.projectRoot?.())) };
}

/**
 * Correct a comment this session sent. Only the session that wrote it may edit:
 * an agent's comment, or one from a session that has since gone, is refused.
 */
export function tasksEditComment(body: { taskId: string; commentId: string; text: string }, ctx: ApiContext): { comment: PlanComment } {
  const comment = ctx.service.comments(body.taskId).find((entry) => entry.id === body.commentId);
  if (!comment) fail(404, "not_found", `no comment ${body.commentId} on ${body.taskId}`);
  const sessionId = ctx.service.sessionId();
  if (!comment.by || comment.by !== sessionId) fail(403, "forbidden", `only the session that wrote ${body.commentId} can edit it`);
  if (!body.text.trim()) fail(400, "bad_request", "an edited comment needs some text");
  try {
    return { comment: ctx.service.editComment(body.taskId, body.commentId, body.text) };
  } catch (error) {
    return fail(400, "bad_request", (error as Error).message);
  }
}

/** Archive, restore or delete a task; each answers the terminal's notice. */
export function tasksArchive(body: { taskId: string }, ctx: ApiContext): { notice: string } {
  return { notice: ctx.service.archiveTask(body.taskId) };
}

/** Bring an archived task back to the list. */
export function tasksRestore(body: { taskId: string }, ctx: ApiContext): { notice: string } {
  return { notice: ctx.service.restoreTask(body.taskId) };
}

/** Delete a task for good, from the list or the archive. */
export function tasksDelete(body: { taskId: string; where: "list" | "archive" }, ctx: ApiContext): { notice: string } {
  return { notice: ctx.service.deleteTask(body.taskId, body.where) };
}

/** Switch auto mode for a task; unknown or finished tasks are refused. */
export function tasksAuto(body: { taskId: string; on: boolean }, ctx: ApiContext): { notice: string; on: boolean } {
  const task = [...ctx.service.tasks(), ...ctx.service.archivedTasks()].find((entry) => entry.id === body.taskId);
  if (!task) fail(404, "not_found", `no task ${body.taskId}`);
  if (TERMINAL_STATES.includes((task as Task).state)) fail(400, "bad_request", `${body.taskId} is ${(task as Task).state}; auto mode applies to a task under way`);
  ctx.service.setAuto(body.taskId, body.on);
  const id = body.taskId;
  return { notice: body.on ? `auto mode on — the oracle drives ${id} to completion without asking` : `auto mode off — the oracle asks you again on ${id}`, on: body.on };
}

/** Leave a message for a task's oracle; blank text is a no-op notice. */
export function tasksMessage(body: { taskId: string; text: string; attachments?: string[] }, ctx: ApiContext): { notice: string } {
  if (!body.text.trim() && !body.attachments?.length) return { notice: "type something first" };
  return { notice: ctx.service.sendToTask(body.taskId, withAttachments(body.text, body.attachments, body.taskId, ctx.service.projectRoot?.())) };
}

/**
 * Resume a task without moving this window: unpaused where it runs, or
 * carried on in a background session (its key comes back to open it).
 */
export async function tasksResume(body: { taskId: string }, ctx: ApiContext): Promise<{ notice: string; key?: string }> {
  const task = ctx.service.tasks().find((entry) => entry.id === body.taskId);
  if (!task) fail(404, "not_found", `no task ${body.taskId} in this project`);
  if (TERMINAL_STATES.includes((task as Task).state)) fail(400, "bad_request", `${body.taskId} is ${(task as Task).state}; there is nothing to resume`);
  if (!ctx.service.resumeTask) fail(400, "bad_request", "resuming tasks is unavailable");
  return ctx.service.resumeTask!(body.taskId);
}

/** Select existing owner chat metadata only; never start, claim or switch a process. */
export function tasksOpen(body: { taskId: string }, ctx: ApiContext): { sessionId?: string; key?: string; notice?: string } {
  const task = ctx.service.tasks().find((entry) => entry.id === body.taskId);
  if (!task) fail(404, "not_found", `no task ${body.taskId} in this project`);
  const sessionId = task.ownerSessionId;
  if (!sessionId) return { notice: "This task has no owning session. No replacement session was created." };
  if (sessionId === ctx.service.sessionId()) return { sessionId };
  const background = ctx.service.sessions().find((entry) => entry.sessionId === sessionId && entry.alive);
  if (background) return { sessionId, key: background.key };
  if (ctx.service.liveSessions().some((entry) => entry.sessionId === sessionId)) return { sessionId };
  return { notice: "The task's owning session has ended or is unavailable. No replacement session was created." };
}

/** How many recent runs the detail lists (the terminal's count). */
const DETAIL_RUNS = 6;

/** The terminal's "Waiting on" approvals: `kind` plus `for <domain>: <detail>`. */
function waitingOf(task: Task): TaskDetail["waiting"] {
  return pendingApprovals(task).map((approval) => ({ kind: approval.kind, detail: `for ${approval.domain}: ${approval.detail}` }));
}

/** One task read whole: request, plan or proposal, step checklist, waits and recent runs. */
export function tasksGet(body: { taskId: string }, ctx: ApiContext): TaskDetail {
  const task = [...ctx.service.tasks(), ...ctx.service.archivedTasks()].find((entry) => entry.id === body.taskId);
  if (!task) fail(404, "not_found", `no task ${body.taskId}`);
  const found = task as Task;
  const request = taskRequest(found);
  const now = Date.now();
  const work = ctx.service.work?.(found.id);
  const clock = clockOf(found, work);
  const details = found.plan ? planDetails(found.plan) : undefined;
  return {
    timing: projectPhaseTiming(found, new Date(now).toISOString()),
    ...(clock ? { work: clock } : {}),
    ...(found.delivery ? { delivery: found.delivery } : {}),
    ...(request !== found.title ? { request } : {}),
    ...(!found.plan && found.proposal ? { proposal: found.proposal } : {}),
    ...(found.plan ? { plan: found.plan } : {}),
    ...(details ? { planDetails: details } : {}),
    steps: stepViews(found, work, now).map((step) => ({
      text: step.text,
      status: step.status === "pending" ? "open" : step.status,
      ...(step.active ? { active: true, workedMs: step.workedMs } : {}),
    })),
    amendments: [...found.amendments],
    waiting: waitingOf(found),
    blockers: found.blockers.map((blocker) => ({ reason: blocker.reason, need: blocker.need })),
    runs: (found.runLog ?? []).slice(-DETAIL_RUNS).map((entry) => describeRun(runFromLog(entry, found.id), now)),
    ...(found.qaRisk ? { qaRisk: found.qaRisk } : {}),
  };
}
