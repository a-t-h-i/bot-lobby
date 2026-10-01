/**
 * The Excalidraw tab over HTTP: the shared sessions, adding one from a link
 * or making a new room, assigning agents, and checking a room. Sessions are
 * listed with masked links (`room <id>`); only `reveal` returns the full
 * link, so the page holds a room key only while it shows one. Actions answer
 * with the same notice text the terminal shows.
 */
import { EXCALIDRAW_AGENTS, type ExcalidrawAgent, type ExcalidrawSession } from "../../excalidraw/sessions.ts";
import { maskedLink, parseRoomLink } from "../../excalidraw/room.ts";
import type { ExcalidrawAgentName, ExcalidrawSessionInfo } from "../protocol.ts";
import type { ApiContext } from "./index.ts";
import { fail } from "./index.ts";

/** A session with its key hidden, for every call but `reveal`. */
export function masked(session: ExcalidrawSession): ExcalidrawSessionInfo {
  const link = parseRoomLink(session.link);
  return {
    id: session.id,
    name: session.name,
    masked: link ? maskedLink(link) : "invalid link",
    agents: [...session.agents],
    contribute: session.contribute,
    addedAt: session.addedAt,
  };
}

function pick(ctx: ApiContext, id: string): ExcalidrawSession {
  const session = ctx.service.excalidraw.list().find((entry) => entry.id === id);
  if (!session) fail(404, "not_found", "no such session");
  return session!;
}

/** Every session, oldest first, with masked links. */
export function excalidrawList(ctx: ApiContext): { sessions: ExcalidrawSessionInfo[] } {
  return { sessions: ctx.service.excalidraw.list().map(masked) };
}

/** Add a session from a link the user pasted, named `name` (or after its room). */
export function excalidrawAdd(body: { link: string; name?: string }, ctx: ApiContext): { notice: string; id?: string } {
  const added = ctx.service.excalidraw.add(body.link, body.name);
  if (!added.session) {
    if (added.notice.startsWith("that is not")) fail(400, "bad_request", added.notice);
    fail(409, "conflict", added.notice);
  }
  return { notice: added.notice, id: added.session!.id };
}

/** Make a new room, for the user to open in Excalidraw. */
export function excalidrawCreate(body: { name?: string }, ctx: ApiContext): { notice: string; id?: string } {
  const made = ctx.service.excalidraw.create(body.name);
  if (!made.session) fail(409, "conflict", made.notice);
  return { notice: made.notice, id: made.session!.id };
}

/** Remove a session (agents lose it at once; the room itself is untouched). */
export function excalidrawRemove(body: { id: string }, ctx: ApiContext): { notice: string } {
  const notice = ctx.service.excalidraw.remove(body.id);
  if (notice === "no such session") fail(404, "not_found", notice);
  return { notice };
}

/** Rename a session. */
export function excalidrawRename(body: { id: string; name: string }, ctx: ApiContext): { notice: string } {
  const notice = ctx.service.excalidraw.rename(body.id, body.name);
  if (notice === "no such session") fail(404, "not_found", notice);
  if (notice === "a session needs a name") fail(400, "bad_request", notice);
  return { notice };
}

/** Assign a session to an agent, or take it back. */
export function excalidrawToggleAgent(body: { id: string; agent: ExcalidrawAgentName }, ctx: ApiContext): { notice: string } {
  if (!isAgent(body.agent)) fail(400, "bad_request", `no agent ${body.agent}`);
  const notice = ctx.service.excalidraw.toggleAgent(body.id, body.agent as ExcalidrawAgent);
  if (notice === "no such session") fail(404, "not_found", notice);
  return { notice };
}

function isAgent(value: string): value is ExcalidrawAgent {
  return (EXCALIDRAW_AGENTS as readonly string[]).includes(value);
}

/** Assign a session to every agent, or (when they all have it) to none. */
export function excalidrawToggleAll(body: { id: string }, ctx: ApiContext): { notice: string } {
  const notice = ctx.service.excalidraw.toggleAll(body.id);
  if (notice === "no such session") fail(404, "not_found", notice);
  return { notice };
}

/** Let the agents draw in a session, or only look at it. */
export function excalidrawToggleContribute(body: { id: string }, ctx: ApiContext): { notice: string } {
  const notice = ctx.service.excalidraw.toggleContribute(body.id);
  if (notice === "no such session") fail(404, "not_found", notice);
  return { notice };
}

/** Check a session: join the room for a moment and report who is there. */
export async function excalidrawCheck(body: { id: string }, ctx: ApiContext): Promise<{ ok: boolean; text: string }> {
  const session = pick(ctx, body.id);
  return ctx.service.checkExcalidraw(session);
}

/** The full room link — the only call that returns one. */
export function excalidrawReveal(body: { id: string }, ctx: ApiContext): { link: string } {
  return { link: pick(ctx, body.id).link };
}
