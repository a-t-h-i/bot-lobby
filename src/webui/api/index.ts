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
import type { LobbyService } from "../../lobby/service.ts";
import { statusGet } from "./status.ts";
import { lobbyAbort, lobbyHistory, lobbySend, lobbySnapshot } from "./lobby.ts";
import { promptsAnswer, promptsDismiss, promptsList } from "./prompts.ts";

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
    schema: Type.Object({ text: Type.String({ maxLength: 20_000 }) }, { additionalProperties: false }),
    run: (body, ctx) => lobbySend(body as { text: string }, ctx),
  };
  routes["lobby.abort"] = { schema: Empty, run: (_body, ctx) => lobbyAbort(ctx) };
  routes["prompts.list"] = { schema: Empty, run: (_body, ctx) => promptsList(ctx) };
  routes["prompts.answer"] = {
    schema: Type.Object({ id: Type.String(), answer: Type.Any() }, { additionalProperties: false }),
    run: (body, ctx) => promptsAnswer(body as { id: string; answer: unknown }, ctx),
  };
  routes["prompts.dismiss"] = {
    schema: Type.Object({ id: Type.String() }, { additionalProperties: false }),
    run: (body, ctx) => promptsDismiss(body as { id: string }, ctx),
  };
  return routes;
}

const ROUTES = buildRoutes();

/** Whether the router knows a call (defined names only; never inherited ones). */
export function isKnownCall(name: string): boolean {
  return Object.hasOwn(ROUTES, name);
}

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
  return checked.run(body as Record<string, unknown>, ctx);
}

/** Read the call name from `POST /api/<group>.<action>` (undefined for anything else). */
export function callName(url: URL): string | undefined {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return undefined;
  const name = path.slice("/api/".length);
  return /^[a-z]+\.[a-zA-Z]+$/.test(name) ? name : undefined;
}

export type { ApiName };
