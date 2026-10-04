/**
 * Background sessions over HTTP: listing what this window started (with
 * status and waiting dialogs) plus live sessions in other terminals, reading
 * a session's conversation, starting, stopping, messaging, switching to, and
 * answering a session's question. Session keys are the TUI's (`S1`, `S2`, …);
 * a session running in another terminal stays there and can only be messaged.
 */
import type { BackgroundSession, DialogAnswer } from "../../lobby/sessions.ts";
import type { ApiContext } from "./index.ts";
import { withAttachments } from "../uploads.ts";
import { fail } from "./index.ts";
import type { BackgroundSessionInfo } from "../protocol.ts";

function infoOf(session: BackgroundSession): BackgroundSessionInfo {
  return {
    key: session.key,
    name: session.name,
    status: session.status,
    busy: session.busy,
    alive: session.alive,
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    ...(session.planId ? { planId: session.planId } : {}),
    waiting: session.dialogs.length,
    dialogs: session.dialogs.map((dialog) => ({ ...dialog })),
  };
}

/** Background sessions this window started, plus live sessions elsewhere. */
export function sessionsList(ctx: ApiContext): { background: BackgroundSessionInfo[]; live: unknown[] } {
  return { background: ctx.service.sessions().map(infoOf), live: [...ctx.service.liveSessions()] };
}

/** Find a background session by its key or its pi session id. */
function backgroundOf(ctx: ApiContext, key?: string, sessionId?: string): BackgroundSession | undefined {
  if (!key && !sessionId) return undefined;
  return ctx.service.sessions().find((session) => (key && session.key === key) || (sessionId && session.sessionId === sessionId));
}

/** One session's conversation, newest 50 before `before`, oldest first. */
export function sessionsChat(body: { key?: string; sessionId?: string; before?: number }, ctx: ApiContext): { entries: unknown[]; hasOlder: boolean } {
  const background = backgroundOf(ctx, body.key, body.sessionId);
  if (background) return pageChat([...background.feed.chat], background.feed.chatOlder && Boolean(background.sessionId), body.before);
  if (!body.sessionId) fail(404, "not_found", "no session with that key");
  return pageChat([...ctx.service.sessionChat(body.sessionId!)], ctx.service.hasOlderChat(body.sessionId!), body.before);
}

function pageChat(all: unknown[], older: boolean, before?: number): { entries: unknown[]; hasOlder: boolean } {
  const rest = before === undefined ? all : all.filter((entry) => (entry as { id: number }).id < before);
  const entries = rest.slice(-50);
  return { entries, hasOlder: rest.length > entries.length || (before === undefined && older) };
}

/** Start a task in a new background session, from a request or a saved plan. */
export function sessionsStart(body: { request?: string; planId?: string; auto?: boolean; attachments?: string[] }, ctx: ApiContext): { notice: string; key?: string } {
  if (body.request?.trim() && body.planId) fail(400, "bad_request", "start from a request or a plan, not both");
  if (body.planId) {
    const plan = ctx.service.plans().find((entry) => entry.id === body.planId);
    if (!plan) fail(404, "not_found", `no plan ${body.planId}`);
    const session = ctx.service.startSession({ plan: plan!, ...(body.auto ? { auto: true } : {}) });
    if (typeof session === "string") return { notice: session };
    return { notice: `started ${session.name} in a new session`, key: session.key };
  }
  if (!body.request?.trim() && !body.attachments?.length) fail(400, "bad_request", "describe the task first");
  const session = ctx.service.startSession({ request: withAttachments((body.request ?? "").trim(), body.attachments, undefined, ctx.service.projectRoot?.()), ...(body.auto ? { auto: true } : {}) });
  if (typeof session === "string") return { notice: session };
  return { notice: `started ${session.name} in a new session`, key: session.key };
}

/** Stop a background session this window started; its task keeps its state. */
export function sessionsStop(body: { key: string }, ctx: ApiContext): { notice: string } {
  const session = backgroundOf(ctx, body.key);
  if (!session) fail(404, "not_found", `no session ${body.key}`);
  session!.stop();
  return { notice: `stopping ${session!.name}` };
}

/** Message a session: background ones directly, other terminals through their inbox. */
export function sessionsMessage(body: { key?: string; sessionId?: string; text: string; attachments?: string[] }, ctx: ApiContext): { notice?: string } {
  if (!body.key && !body.sessionId) fail(400, "bad_request", "a session key or id is required");
  if (!body.text.trim() && !body.attachments?.length) return { notice: "type something first" };
  const text = withAttachments(body.text, body.attachments, undefined, ctx.service.projectRoot?.());
  const background = backgroundOf(ctx, body.key, body.sessionId);
  if (background) {
    if (!background.alive) fail(409, "conflict", `${background.name} has ended`);
    background.send(text);
    return {};
  }
  return { notice: ctx.service.sendToSession(body.sessionId!, text) };
}

/** Run a session in this window (stopping its background process first). */
export async function sessionsSwitch(body: { key?: string; sessionId?: string; claimTaskId?: string }, ctx: ApiContext): Promise<{ notice: string }> {
  if (!body.key && !body.sessionId && !body.claimTaskId) fail(400, "bad_request", "a session key, id or task is required");
  if (ctx.service.masterBusy()) return { notice: "this window's oracle is working — stop it, then switch" };
  if (body.claimTaskId) {
    const task = ctx.service.tasks().find((entry) => entry.id === body.claimTaskId);
    if (!task) fail(404, "not_found", `no task ${body.claimTaskId}`);
    return { notice: await ctx.service.switchTo({ name: task!.title, claimTaskId: body.claimTaskId }) };
  }
  const background = backgroundOf(ctx, body.key, body.sessionId);
  if (background) {
    return { notice: await ctx.service.switchTo({ name: background.name, ...(background.sessionId ? { sessionId: background.sessionId } : {}), background }) };
  }
  const live = ctx.service.liveSessions().find((session) => session.sessionId === body.sessionId);
  const name = live?.name ?? "that session";
  return { notice: `${name} is running in another terminal — switch there, or close it first and resume it here` };
}

/** Answer a question a background session waits on. */
export function sessionsAnswer(body: { key: string; dialogId: string; answer: DialogAnswer }, ctx: ApiContext): { notice: string } {
  const session = backgroundOf(ctx, body.key);
  if (!session) fail(404, "not_found", `no session ${body.key}`);
  if (!session!.dialogs.some((dialog) => dialog.id === body.dialogId)) fail(404, "not_found", `no question ${body.dialogId} on ${body.key}`);
  session!.answer(body.dialogId, body.answer);
  return { notice: "answer sent" };
}
