/**
 * The router: `POST /api/<group>.<action>` with a JSON object body, answered
 * `{ok:true,result}` or `{ok:false,error,code}`. One TypeBox schema per
 * request; groups and actions live in a null-prototype map so inherited
 * names (`__proto__`, `constructor`) are never callable. Shared response
 * helpers live here too, so static/stream failures answer the same shape.
 */
import type { ServerResponse } from "node:http";
import { Type, type TObject } from "typebox";
import { Compile } from "typebox/compile";
import { statusFor, type ApiName, type ErrorCode } from "../protocol.ts";
import type { LobbyService } from "../../lobby/host.ts";
import { statusGet } from "./status.ts";
import { lobbyAbort, lobbyHistory, lobbySend, lobbySnapshot } from "./lobby.ts";
import { promptsAnswer, promptsDismiss, promptsList } from "./prompts.ts";
import { plannerAnswer, plannerCommentLine, plannerGet, plannerNew, plannerRetry, plannerSend, plannerEditMessage, plannerToggleSeat, plannerSave } from "./planner.ts";
import { quickfixCancel, quickfixList, quickfixMovedToTask, quickfixRunAnyway, quickfixSubmit } from "./quickfix.ts";
import { tasksArchive, tasksArchived, tasksAuto, tasksComment, tasksComments, tasksDelete, tasksEditComment, tasksGet, tasksList, tasksMessage, tasksRestore, tasksOpen, tasksDeliveryReview, tasksDeliveryDefer, tasksDeliver } from "./tasks.ts";
import { metricsGet } from "./metrics.ts";
import { knowledgeAdd, knowledgeComment, knowledgeEdit, knowledgeFiles, knowledgeOpen, knowledgeRemove, knowledgeReplaceFile, knowledgeUnnote } from "./knowledge.ts";
import { excalidrawAdd, excalidrawCheck, excalidrawCreate, excalidrawList, excalidrawRemove, excalidrawRename, excalidrawReveal, excalidrawToggleAgent, excalidrawToggleAll, excalidrawToggleContribute } from "./excalidraw.ts";
import { plansDiscard, plansGet, plansStart } from "./plans.ts";
import { gitCancelReview, gitJev, gitPull, gitPulls, gitReview } from "./git.ts";
import { issuesCreate, issuesGet, issuesList } from "./issues.ts";
import { sessionsAnswer, sessionsChat, sessionsList, sessionsMessage, sessionsStart, sessionsStop, sessionsSwitch } from "./sessions.ts";
import { settingsGet, settingsLinters, settingsSet } from "./settings.ts";
import { noticeText, pushNotice } from "../notices.ts";

/** What a handler reads besides the request body. */
export interface ApiContext {
  service: LobbyService;
  port: number;
}

/** A request the router refused: an HTTP status, a machine code, a message. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Refuse a request with a status, a machine code and a message. */
export function fail(status: number, code: ErrorCode, message: string): never {
  throw new HttpError(status, code, message);
}

/** Security headers on every response (the page loads nothing from anywhere else). */
export function applyBaseHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
}

/** Answer JSON, never cached. */
export function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  applyBaseHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

/** Answer `{ok:false,error,code}` with the code's status. */
export function sendError(res: ServerResponse, code: ErrorCode, error: string, status = statusFor(code)): void {
  sendJson(res, status, { ok: false, error, code });
}

type Handler = (body: Record<string, unknown>, ctx: ApiContext) => unknown | Promise<unknown>;

interface Route {
  schema: TObject;
  run: Handler;
}

const Empty = Type.Object({}, { additionalProperties: false });
const TaskId = Type.String({ minLength: 1, maxLength: 200 });
const GhNumber = Type.Integer({ minimum: 1, maximum: 1_000_000_000 });
const NoticeText = Type.String({ maxLength: 20_000 });
/** Ids of files uploaded through `files.upload`; the message names them by path. */
const Attachments = Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 8 }));
const CommentText = Type.String({ maxLength: 10_000 });
const DialogAnswer = Type.Union([
  Type.Object({ value: Type.String() }, { additionalProperties: false }),
  Type.Object({ confirmed: Type.Boolean() }, { additionalProperties: false }),
  Type.Object({ cancelled: Type.Literal(true) }, { additionalProperties: false }),
]);

const Member = Type.Union([Type.Literal("backend"), Type.Literal("designer"), Type.Literal("qa"), Type.Literal("researcher")]);
const KnowledgeAgent = Type.Union([Type.Literal("master"), Type.Literal("designer"), Type.Literal("backend"), Type.Literal("qa")]);
const KnowledgeFile = Type.String({ minLength: 1, maxLength: 200 });
const KnowledgeText = Type.String({ minLength: 1, maxLength: 100_000 });
const EntryRef = Type.Object({ text: Type.String({ minLength: 1, maxLength: 100_000 }), occurrence: Type.Integer({ minimum: 0, maximum: 100000 }) }, { additionalProperties: false });
const ExcalidrawAgent = Type.Union([Type.Literal("master"), Type.Literal("designer"), Type.Literal("backend"), Type.Literal("qa"), Type.Literal("scout"), Type.Literal("researcher"), Type.Literal("quickfix"), Type.Literal("planner")]);
const PlannerSeed = Type.Object({
  issue: Type.Object({ number: Type.Integer({ minimum: 1 }), title: Type.String({ minLength: 1, maxLength: 500 }), url: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false }),
  body: Type.String({ maxLength: 20_000 }),
}, { additionalProperties: false });

function firstError(schema: TObject, body: unknown): string {
  const check = Compile(schema);
  const [first] = [...check.Errors(body ?? {})];
  return first?.message ?? "the request does not match its schema";
}

/** Every call the server answers, by `group.action` name. */
function buildRoutes(): Record<string, Route> {
  const routes: Record<string, Route> = Object.create(null);
  routes["status.get"] = { schema: Empty, run: (_body, ctx) => statusGet(ctx) };
  routes["lobby.snapshot"] = { schema: Empty, run: (_body, ctx) => lobbySnapshot(ctx) };
  routes["lobby.history"] = {
    schema: Type.Object({ before: Type.Optional(Type.Number()) }, { additionalProperties: false }),
    run: (body, ctx) => lobbyHistory(body as { before?: number }, ctx),
  };
  routes["lobby.send"] = {
    schema: Type.Object({ text: Type.String({ maxLength: 20_000 }), attachments: Attachments }, { additionalProperties: false }),
    run: (body, ctx) => lobbySend(body as { text: string; attachments?: string[] }, ctx),
  };
  routes["lobby.abort"] = { schema: Empty, run: (_body, ctx) => lobbyAbort(ctx) };
  routes["tasks.list"] = { schema: Empty, run: (_body, ctx) => tasksList(ctx) };
  routes["tasks.archived"] = { schema: Empty, run: (_body, ctx) => tasksArchived(ctx) };
  routes["tasks.get"] = {
    schema: Type.Object({ taskId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => tasksGet(body as { taskId: string }, ctx),
  };
  routes["tasks.open"] = {
    schema: Type.Object({ taskId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => tasksOpen(body as { taskId: string }, ctx),
  };
  routes["tasks.deliveryReview"] = {
    schema: Type.Object({ taskId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => tasksDeliveryReview(body as { taskId: string }, ctx),
  };
  routes["tasks.deliver"] = {
    schema: Type.Object({ taskId: TaskId, reviewId: Type.String({ minLength: 1, maxLength: 200 }), action: Type.Union([Type.Literal("create_pr"), Type.Literal("merge_main")]), confirmMain: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    run: (body, ctx) => tasksDeliver(body as unknown as Parameters<typeof tasksDeliver>[0], ctx),
  };
  routes["tasks.deliveryDefer"] = {
    schema: Type.Object({ taskId: TaskId, reviewId: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false }),
    run: (body, ctx) => tasksDeliveryDefer(body as { taskId: string; reviewId: string }, ctx),
  };
  routes["tasks.comments"] = {
    schema: Type.Object({ taskId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => tasksComments(body as { taskId: string }, ctx),
  };
  routes["tasks.comment"] = {
    schema: Type.Object({ taskId: TaskId, text: CommentText, attachments: Attachments }, { additionalProperties: false }),
    run: (body, ctx) => tasksComment(body as { taskId: string; text: string; attachments?: string[] }, ctx),
  };
  routes["tasks.editComment"] = {
    schema: Type.Object({ taskId: TaskId, commentId: Type.String({ minLength: 1, maxLength: 200 }), text: CommentText }, { additionalProperties: false }),
    run: (body, ctx) => tasksEditComment(body as { taskId: string; commentId: string; text: string }, ctx),
  };
  routes["tasks.archive"] = {
    schema: Type.Object({ taskId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => tasksArchive(body as { taskId: string }, ctx),
  };
  routes["tasks.restore"] = {
    schema: Type.Object({ taskId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => tasksRestore(body as { taskId: string }, ctx),
  };
  routes["tasks.delete"] = {
    schema: Type.Object({ taskId: TaskId, where: Type.Union([Type.Literal("list"), Type.Literal("archive")]) }, { additionalProperties: false }),
    run: (body, ctx) => tasksDelete(body as { taskId: string; where: "list" | "archive" }, ctx),
  };
  routes["tasks.auto"] = {
    schema: Type.Object({ taskId: TaskId, on: Type.Boolean() }, { additionalProperties: false }),
    run: (body, ctx) => tasksAuto(body as { taskId: string; on: boolean }, ctx),
  };
  routes["tasks.message"] = {
    schema: Type.Object({ taskId: TaskId, text: NoticeText, attachments: Attachments }, { additionalProperties: false }),
    run: (body, ctx) => tasksMessage(body as { taskId: string; text: string; attachments?: string[] }, ctx),
  };
  routes["plans.get"] = {
    schema: Type.Object({ planId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => plansGet(body as { planId: string }, ctx),
  };
  routes["plans.start"] = {
    schema: Type.Object({ planId: TaskId, where: Type.Union([Type.Literal("here"), Type.Literal("session")]), auto: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    run: (body, ctx) => plansStart(body as { planId: string; where: "here" | "session"; auto?: boolean }, ctx),
  };
  routes["plans.discard"] = {
    schema: Type.Object({ planId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => plansDiscard(body as { planId: string }, ctx),
  };
  routes["sessions.list"] = { schema: Empty, run: (_body, ctx) => sessionsList(ctx) };
  routes["sessions.chat"] = {
    schema: Type.Object({ key: Type.Optional(TaskId), sessionId: Type.Optional(TaskId), before: Type.Optional(Type.Number()) }, { additionalProperties: false }),
    run: (body, ctx) => sessionsChat(body as { key?: string; sessionId?: string; before?: number }, ctx),
  };
  routes["sessions.start"] = {
    schema: Type.Object({ request: Type.Optional(NoticeText), planId: Type.Optional(TaskId), auto: Type.Optional(Type.Boolean()), attachments: Attachments }, { additionalProperties: false }),
    run: (body, ctx) => sessionsStart(body as { request?: string; planId?: string; auto?: boolean; attachments?: string[] }, ctx),
  };
  routes["sessions.stop"] = {
    schema: Type.Object({ key: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => sessionsStop(body as { key: string }, ctx),
  };
  routes["sessions.message"] = {
    schema: Type.Object({ key: Type.Optional(TaskId), sessionId: Type.Optional(TaskId), text: NoticeText, attachments: Attachments }, { additionalProperties: false }),
    run: (body, ctx) => sessionsMessage(body as { key?: string; sessionId?: string; text: string; attachments?: string[] }, ctx),
  };
  routes["sessions.switch"] = {
    schema: Type.Object({ key: Type.Optional(TaskId), sessionId: Type.Optional(TaskId), claimTaskId: Type.Optional(TaskId) }, { additionalProperties: false }),
    run: (body, ctx) => sessionsSwitch(body as { key?: string; sessionId?: string; claimTaskId?: string }, ctx),
  };
  routes["sessions.answer"] = {
    schema: Type.Object({ key: TaskId, dialogId: TaskId, answer: DialogAnswer }, { additionalProperties: false }),
    run: (body, ctx) => sessionsAnswer(body as { key: string; dialogId: string; answer: { value: string } | { confirmed: boolean } | { cancelled: true } }, ctx),
  };
  routes["prompts.list"] = { schema: Empty, run: (_body, ctx) => promptsList(ctx) };
  routes["prompts.answer"] = {
    schema: Type.Object({ id: Type.String(), answer: Type.Any() }, { additionalProperties: false }),
    run: (body, ctx) => promptsAnswer(body as { id: string; answer: unknown }, ctx),
  };
  routes["prompts.dismiss"] = {
    schema: Type.Object({ id: Type.String() }, { additionalProperties: false }),
    run: (body, ctx) => promptsDismiss(body as { id: string }, ctx),
  };
  routes["planner.get"] = { schema: Empty, run: (_body, ctx) => plannerGet(ctx) };
  routes["planner.new"] = {
    schema: Type.Object({ seed: Type.Optional(PlannerSeed), seats: Type.Optional(Type.Array(Member, { maxItems: 4 })) }, { additionalProperties: false }),
    run: (body, ctx) => plannerNew(body as { seed?: { issue: { number: number; title: string; url?: string }; body: string }; seats?: ("backend" | "designer" | "qa" | "researcher")[] }, ctx),
  };
  routes["planner.send"] = {
    schema: Type.Object({ text: NoticeText, attachments: Attachments }, { additionalProperties: false }),
    run: (body, ctx) => plannerSend(body as { text: string; attachments?: string[] }, ctx),
  };
  routes["planner.editMessage"] = {
    schema: Type.Object({ messageIndex: Type.Integer({ minimum: 0 }), at: Type.Number(), text: NoticeText }, { additionalProperties: false }),
    run: (body, ctx) => plannerEditMessage(body as { messageIndex: number; at: number; text: string }, ctx),
  };
  routes["planner.toggleSeat"] = {
    schema: Type.Object({ member: Member }, { additionalProperties: false }),
    run: (body, ctx) => plannerToggleSeat(body as { member: "backend" | "designer" | "qa" | "researcher" }, ctx),
  };
  routes["planner.retry"] = { schema: Empty, run: (_body, ctx) => plannerRetry(ctx) };
  routes["planner.commentLine"] = {
    schema: Type.Object({ line: Type.String({ minLength: 1, maxLength: 5000 }), text: CommentText }, { additionalProperties: false }),
    run: (body, ctx) => plannerCommentLine(body as { line: string; text: string }, ctx),
  };
  routes["planner.answer"] = { schema: Empty, run: (_body, ctx) => plannerAnswer(ctx) };
  routes["planner.save"] = { schema: Empty, run: (_body, ctx) => plannerSave(ctx) };
  routes["quickfix.list"] = { schema: Empty, run: (_body, ctx) => quickfixList(ctx) };
  routes["quickfix.submit"] = {
    schema: Type.Object({ text: NoticeText, attachments: Attachments }, { additionalProperties: false }),
    run: (body, ctx) => quickfixSubmit(body as { text: string; attachments?: string[] }, ctx),
  };
  routes["quickfix.cancel"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => quickfixCancel(body as { id: string }, ctx),
  };
  routes["quickfix.runAnyway"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => quickfixRunAnyway(body as { id: string }, ctx),
  };
  routes["quickfix.movedToTask"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => quickfixMovedToTask(body as { id: string }, ctx),
  };
  routes["metrics.get"] = {
    schema: Type.Object({ groupBy: Type.Union([Type.Literal("model"), Type.Literal("model-kind")]), query: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false }),
    run: (body, ctx) => metricsGet(body as { groupBy: "model" | "model-kind"; query?: string }, ctx),
  };
  routes["knowledge.files"] = { schema: Empty, run: (_body, ctx) => knowledgeFiles(ctx) };
  routes["knowledge.open"] = {
    schema: Type.Object({ agent: KnowledgeAgent, file: KnowledgeFile }, { additionalProperties: false }),
    run: (body, ctx) => knowledgeOpen(body as { agent: "master" | "designer" | "backend" | "qa"; file: string }, ctx),
  };
  routes["knowledge.edit"] = {
    schema: Type.Object({ agent: KnowledgeAgent, file: KnowledgeFile, ref: EntryRef, text: KnowledgeText }, { additionalProperties: false }),
    run: (body, ctx) => knowledgeEdit(body as { agent: "master" | "designer" | "backend" | "qa"; file: string; ref: { text: string; occurrence: number }; text: string }, ctx),
  };
  routes["knowledge.add"] = {
    schema: Type.Object({ agent: KnowledgeAgent, file: KnowledgeFile, ref: Type.Optional(EntryRef), text: KnowledgeText }, { additionalProperties: false }),
    run: (body, ctx) => knowledgeAdd(body as { agent: "master" | "designer" | "backend" | "qa"; file: string; ref?: { text: string; occurrence: number }; text: string }, ctx),
  };
  routes["knowledge.remove"] = {
    schema: Type.Object({ agent: KnowledgeAgent, file: KnowledgeFile, ref: EntryRef }, { additionalProperties: false }),
    run: (body, ctx) => knowledgeRemove(body as { agent: "master" | "designer" | "backend" | "qa"; file: string; ref: { text: string; occurrence: number } }, ctx),
  };
  routes["knowledge.replaceFile"] = {
    schema: Type.Object({ agent: KnowledgeAgent, file: KnowledgeFile, text: Type.String({ maxLength: 100_000 }) }, { additionalProperties: false }),
    run: (body, ctx) => knowledgeReplaceFile(body as { agent: "master" | "designer" | "backend" | "qa"; file: string; text: string }, ctx),
  };
  routes["knowledge.comment"] = {
    schema: Type.Object({ agent: KnowledgeAgent, file: KnowledgeFile, ref: EntryRef, text: Type.String({ minLength: 1, maxLength: 2000 }) }, { additionalProperties: false }),
    run: (body, ctx) => knowledgeComment(body as { agent: "master" | "designer" | "backend" | "qa"; file: string; ref: { text: string; occurrence: number }; text: string }, ctx),
  };
  routes["knowledge.unnote"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => knowledgeUnnote(body as { id: string }, ctx),
  };
  routes["excalidraw.list"] = { schema: Empty, run: (_body, ctx) => excalidrawList(ctx) };
  routes["excalidraw.add"] = {
    schema: Type.Object({ link: Type.String({ minLength: 1, maxLength: 2000 }), name: Type.Optional(Type.String({ maxLength: 40 })) }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawAdd(body as { link: string; name?: string }, ctx),
  };
  routes["excalidraw.create"] = {
    schema: Type.Object({ name: Type.Optional(Type.String({ maxLength: 40 })) }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawCreate(body as { name?: string }, ctx),
  };
  routes["excalidraw.remove"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawRemove(body as { id: string }, ctx),
  };
  routes["excalidraw.rename"] = {
    schema: Type.Object({ id: TaskId, name: Type.String({ maxLength: 40 }) }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawRename(body as { id: string; name: string }, ctx),
  };
  routes["excalidraw.toggleAgent"] = {
    schema: Type.Object({ id: TaskId, agent: ExcalidrawAgent }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawToggleAgent(body as { id: string; agent: "master" | "designer" | "backend" | "qa" | "scout" | "researcher" | "quickfix" | "planner" }, ctx),
  };
  routes["excalidraw.toggleAll"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawToggleAll(body as { id: string }, ctx),
  };
  routes["excalidraw.toggleContribute"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawToggleContribute(body as { id: string }, ctx),
  };
  routes["excalidraw.check"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawCheck(body as { id: string }, ctx),
  };
  routes["excalidraw.reveal"] = {
    schema: Type.Object({ id: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => excalidrawReveal(body as { id: string }, ctx),
  };
  routes["git.pulls"] = {
    schema: Type.Object({ refresh: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    run: (body, ctx) => gitPulls(body as { refresh?: boolean }, ctx),
  };
  routes["git.pull"] = {
    schema: Type.Object({ number: GhNumber }, { additionalProperties: false }),
    run: (body, ctx) => gitPull(body as { number: number }, ctx),
  };
  routes["git.review"] = {
    schema: Type.Object({ number: GhNumber, focus: Type.Optional(Type.String({ maxLength: 2000 })) }, { additionalProperties: false }),
    run: (body, ctx) => gitReview(body as { number: number; focus?: string }, ctx),
  };
  routes["git.cancelReview"] = {
    schema: Type.Object({ number: GhNumber }, { additionalProperties: false }),
    run: (body, ctx) => gitCancelReview(body as { number: number }, ctx),
  };
  routes["git.jev"] = {
    schema: Type.Object({ number: GhNumber }, { additionalProperties: false }),
    run: (body, ctx) => gitJev(body as { number: number }, ctx),
  };
  routes["issues.list"] = {
    schema: Type.Object({ refresh: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    run: (body, ctx) => issuesList(body as { refresh?: boolean }, ctx),
  };
  routes["issues.get"] = {
    schema: Type.Object({ number: GhNumber }, { additionalProperties: false }),
    run: (body, ctx) => issuesGet(body as { number: number }, ctx),
  };
  routes["issues.create"] = {
    schema: Type.Object({ text: Type.String({ maxLength: 20_000 }) }, { additionalProperties: false }),
    run: (body, ctx) => issuesCreate(body as { text: string }, ctx),
  };
  routes["settings.get"] = { schema: Empty, run: (_body, ctx) => settingsGet(ctx) };
  routes["settings.set"] = {
    // The patch's shape is the normaliser's job (`resolveConfig`); only a plain object is required here.
    schema: Type.Object({ patch: Type.Object({}, { additionalProperties: true }) }, { additionalProperties: false }),
    run: (body, ctx) => settingsSet(body as { patch: Record<string, unknown> }, ctx),
  };
  routes["settings.linters"] = { schema: Empty, run: (_body, ctx) => settingsLinters(ctx) };
  return routes;
}

const ROUTES = buildRoutes();

/**
 * Run `POST /api/<name>` with an already-parsed body. Throws `HttpError` for
 * refusals (unknown call, a body that is no object, a schema mismatch, or a
 * handler's own refusal); anything else is a 500.
 */
export async function routeApiCall(name: string, body: unknown, ctx: ApiContext): Promise<unknown> {
  const route = Object.hasOwn(ROUTES, name) ? ROUTES[name] : undefined;
  if (!route) fail(404, "not_found", `no call ${name}`);
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "bad_request", "the body must be a JSON object");
  const checked = route as Route;
  if (!Compile(checked.schema).Check(body)) fail(400, "bad_request", firstError(checked.schema, body));
  const result = await checked.run(body as Record<string, unknown>, ctx);
  const notice = noticeText(result);
  if (notice) pushNotice(notice);
  return result;
}

/** Read the call name from `POST /api/<group>.<action>` (undefined for anything else). */
export function callName(url: URL): string | undefined {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return undefined;
  const name = path.slice("/api/".length);
  return /^[a-z]+\.[a-zA-Z]+$/.test(name) ? name : undefined;
}

export type { ApiName };
