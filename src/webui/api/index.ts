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
import { plannerAnswer, plannerCommentLine, plannerGet, plannerNew, plannerRetry, plannerSend, plannerEditMessage, plannerToggleSeat, plannerSave, plannerPrevious, plannerPreviousArchive, plannerPreviousDelete, plannerPreviousGet, plannerPreviousOpen } from "./planner.ts";
import { tasksArchive, tasksArchived, tasksAuto, tasksComment, tasksComments, tasksDelete, tasksEditComment, tasksGet, tasksList, tasksMessage, tasksRestore, tasksOpen, tasksResume, tasksDeliveryReview, tasksDeliveryDefer, tasksDeliver, tasksAccept, tasksSkipStep, tasksForceClose, tasksResolveApproval } from "./tasks.ts";
import { knowledgeAdd, knowledgeAsk, knowledgeComment, knowledgeEdit, knowledgeFiles, knowledgeOpen, knowledgeRemove, knowledgeReplaceFile, knowledgeUnnote } from "./knowledge.ts";
import { plansDiscard, plansGet, plansStart } from "./plans.ts";
import { sessionsAnswer, sessionsArchive, sessionsChat, sessionsList, sessionsMessage, sessionsRename, sessionsStart, sessionsStop, sessionsSwitch } from "./sessions.ts";
import { settingsGet, settingsGrants, settingsHarnesses, settingsLinters, settingsSet } from "./settings.ts";
import { lobbyRetention, lobbySetRetention } from "./retention.ts";
import { terminalClose, terminalInput, terminalList, terminalOpen, terminalResize } from "./terminal.ts";
import { MAX_INPUT_CHARS } from "../terminal.ts";
import { themesChoose, themesGet, themesRemove, themesRename, themesSave } from "./themes.ts";
import { noticeText, pushNotice } from "../notices.ts";
import { codeChanges, codeRead, codeSave } from "../code.ts";

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
  routes["lobby.retention"] = { schema: Empty, run: (_body, ctx) => lobbyRetention(ctx) };
  routes["lobby.setRetention"] = {
    schema: Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }),
    run: (body, ctx) => lobbySetRetention(body as { enabled: boolean }, ctx),
  };
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
  routes["tasks.resume"] = {
    schema: Type.Object({ taskId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => tasksResume(body as { taskId: string }, ctx),
  };
  routes["tasks.accept"] = {
    schema: Type.Object({ taskId: TaskId }, { additionalProperties: false }),
    run: (body, ctx) => tasksAccept(body as { taskId: string }, ctx),
  };
  routes["tasks.skipStep"] = {
    schema: Type.Object({ taskId: TaskId, step: Type.Integer({ minimum: 0, maximum: 49 }), text: Type.String({ minLength: 1, maxLength: 20_000 }), reason: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
    run: (body, ctx) => tasksSkipStep(body as Parameters<typeof tasksSkipStep>[0], ctx),
  };
  routes["tasks.forceClose"] = {
    schema: Type.Object({ taskId: TaskId, title: Type.String({ maxLength: 20_000 }) }, { additionalProperties: false }),
    run: (body, ctx) => tasksForceClose(body as { taskId: string; title: string }, ctx),
  };
  routes["tasks.resolveApproval"] = {
    schema: Type.Object({ taskId: TaskId, approvalId: TaskId, decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]), note: Type.Optional(NoticeText) }, { additionalProperties: false }),
    run: (body, ctx) => tasksResolveApproval(body as Parameters<typeof tasksResolveApproval>[0], ctx),
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
  const TerminalId = Type.String({ minLength: 1, maxLength: 40 });
  const Cols = Type.Integer({ minimum: 2, maximum: 500 });
  const Rows = Type.Integer({ minimum: 2, maximum: 300 });
  routes["terminal.list"] = { schema: Empty, run: () => terminalList() };
  routes["terminal.open"] = {
    schema: Type.Object({ cols: Cols, rows: Rows }, { additionalProperties: false }),
    run: (body, ctx) => terminalOpen(body as { cols: number; rows: number }, ctx),
  };
  routes["terminal.input"] = {
    schema: Type.Object({ id: TerminalId, data: Type.String({ minLength: 1, maxLength: MAX_INPUT_CHARS }) }, { additionalProperties: false }),
    run: (body) => terminalInput(body as { id: string; data: string }),
  };
  routes["terminal.resize"] = {
    schema: Type.Object({ id: TerminalId, cols: Cols, rows: Rows }, { additionalProperties: false }),
    run: (body) => terminalResize(body as { id: string; cols: number; rows: number }),
  };
  routes["terminal.close"] = {
    schema: Type.Object({ id: TerminalId }, { additionalProperties: false }),
    run: (body) => terminalClose(body as { id: string }),
  };
  routes["sessions.rename"] = {
    schema: Type.Object({ key: Type.Optional(TaskId), name: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false }),
    run: (body, ctx) => sessionsRename(body as { key?: string; name: string }, ctx),
  };
  routes["sessions.archive"] = {
    schema: Type.Object({ key: TaskId, archived: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    run: (body, ctx) => sessionsArchive(body as { key: string; archived?: boolean }, ctx),
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
  const PlanId = Type.String({ minLength: 1, maxLength: 40 });
  routes["planner.previous"] = { schema: Type.Object({ archived: Type.Optional(Type.Boolean()) }, { additionalProperties: false }), run: (body, ctx) => plannerPrevious(body as { archived?: boolean }, ctx) };
  routes["planner.previousGet"] = { schema: Type.Object({ id: PlanId }, { additionalProperties: false }), run: (body, ctx) => plannerPreviousGet(body as { id: string }, ctx) };
  routes["planner.previousArchive"] = { schema: Type.Object({ id: PlanId, archived: Type.Boolean() }, { additionalProperties: false }), run: (body, ctx) => plannerPreviousArchive(body as { id: string; archived: boolean }, ctx) };
  routes["planner.previousDelete"] = { schema: Type.Object({ id: PlanId }, { additionalProperties: false }), run: (body, ctx) => plannerPreviousDelete(body as { id: string }, ctx) };
  routes["planner.previousOpen"] = { schema: Type.Object({ id: PlanId }, { additionalProperties: false }), run: (body, ctx) => plannerPreviousOpen(body as { id: string }, ctx) };
  routes["knowledge.files"] = { schema: Empty, run: (_body, ctx) => knowledgeFiles(ctx) };
  routes["knowledge.ask"] = {
    schema: Type.Object({ text: NoticeText, attachments: Attachments }, { additionalProperties: false }),
    run: (body, ctx) => knowledgeAsk(body as { text: string; attachments?: string[] }, ctx),
  };
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
  const codeRoot = (ctx: ApiContext) => ctx.service.projectRoot?.() ?? process.cwd();
  const CodePath = Type.String({ minLength: 1, maxLength: 4096 });
  routes["code.changes"] = { schema: Empty, run: (_body, ctx) => codeChanges(codeRoot(ctx)) };
  routes["code.read"] = {
    schema: Type.Object({ path: CodePath }, { additionalProperties: false }),
    run: (body, ctx) => codeRead(codeRoot(ctx), (body as { path: string }).path),
  };
  routes["code.save"] = {
    schema: Type.Object({ path: CodePath, contents: Type.String({ maxLength: 900_000 }), mtimeMs: Type.Optional(Type.Number()), force: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    run: (body, ctx) => codeSave(codeRoot(ctx), body as { path: string; contents: string; mtimeMs?: number; force?: boolean }),
  };
  routes["settings.get"] = { schema: Empty, run: (_body, ctx) => settingsGet(ctx) };
  routes["settings.set"] = {
    // The patch's shape is the normaliser's job (`resolveConfig`); only a plain object is required here.
    schema: Type.Object({ patch: Type.Object({}, { additionalProperties: true }) }, { additionalProperties: false }),
    run: (body, ctx) => settingsSet(body as { patch: Record<string, unknown> }, ctx),
  };
  routes["settings.linters"] = { schema: Empty, run: (_body, ctx) => settingsLinters(ctx) };
  routes["settings.grants"] = { schema: Empty, run: (_body, ctx) => settingsGrants(ctx) };
  routes["settings.harnesses"] = { schema: Empty, run: (_body, ctx) => settingsHarnesses(ctx) };
  const ThemeId = Type.String({ minLength: 1, maxLength: 40 });
  const ThemeName = Type.String({ minLength: 1, maxLength: 200 });
  const ThemeVars = Type.Optional(Type.Record(Type.String({ maxLength: 60 }), Type.String({ maxLength: 400 })));
  routes["themes.get"] = { schema: Empty, run: () => themesGet() };
  routes["themes.save"] = {
    schema: Type.Object({ name: ThemeName, light: ThemeVars, dark: ThemeVars }, { additionalProperties: false }),
    run: (body) => themesSave(body as { name: string; light?: Record<string, string>; dark?: Record<string, string> }),
  };
  routes["themes.rename"] = { schema: Type.Object({ id: ThemeId, name: ThemeName }, { additionalProperties: false }), run: (body) => themesRename(body as { id: string; name: string }) };
  routes["themes.remove"] = { schema: Type.Object({ id: ThemeId }, { additionalProperties: false }), run: (body) => themesRemove(body as { id: string }) };
  routes["themes.choose"] = { schema: Type.Object({ id: ThemeId }, { additionalProperties: false }), run: (body) => themesChoose(body as { id: string }) };
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
