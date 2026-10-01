/**
 * The lobby's loopback server: the committed `webui/dist` page, a JSON API
 * and an event stream over the shared `LobbyService`, on 127.0.0.1 only.
 * Opt-in (a later step starts it); nothing here writes to stdout or stderr —
 * route errors go to `lobbyFeed`. One server per process.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../state/project.ts";
import { lobbyFeed } from "../lobby/feed.ts";
import type { LobbyService } from "../lobby/service.ts";
import {
  MAX_BODY_BYTES,
  LoginGuard,
  isCrossSite,
  isHostAllowed,
  isSignedIn,
  linkToken,
  loadOrCreateSecret,
  resetSecret,
  safeEqual,
  sessionCookie,
  sessionValue,
} from "./auth.ts";
import { callName, HttpError, routeApiCall, sendError, sendJson } from "./api/index.ts";
import { distDir, serveStatic } from "./static.ts";
import { EventHub } from "./events.ts";
import { servePreview } from "./files.ts";

/** The default port; the server tries it, then the next free port up to +20. */
export const DEFAULT_PORT = 7347;
/** How many ports past the base are tried. */
export const PORT_RANGE = 20;

export interface WebServerOptions {
  service: LobbyService;
  /** Base port (config `lobby.web.port` once a later step adds it). */
  port?: number;
  /** The built page; defaults to `webui/dist`. */
  dist?: string;
  /** Skip the secret file (tests); otherwise loaded from `web.json`. */
  secret?: Buffer;
  /** Stream heartbeat for tests; 15 s in production. */
  heartbeatMs?: number;
}

export interface WebServer {
  /** The link to print: the token rides in the fragment. */
  link: string;
  port: number;
  /** Open event streams (the page in each browser tab). */
  clients(): number;
  /** Follow another service (session switch); open streams hear `hello` again. */
  rebind(service: LobbyService): void;
  /** A new secret (every cookie until now stops working); returns the new link. */
  reset(): string;
  close(): Promise<void>;
}

let current: WebServer | undefined;
let exitHooked = false;

/** The base port: config `lobby.web.port` once it exists, else the default. */
function basePort(override?: number): number {
  if (override !== undefined) return override;
  try {
    const web = (loadConfig().lobby as unknown as { web?: { port?: number } }).web;
    if (typeof web?.port === "number" && web.port >= 0) return web.port;
  } catch {
    // An unreadable config only means the default port.
  }
  return DEFAULT_PORT;
}

function hookExit(): void {
  if (exitHooked) return;
  exitHooked = true;
  process.once("exit", () => {
    void current?.close();
  });
}

/** Read a JSON body, capped at a megabyte (413 past it, 400 when it is no JSON). */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "the body is larger than 1,000,000 bytes");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_request", "the body is not JSON");
  }
}

function numParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

interface RouteState {
  service: LobbyService;
  port: number;
  link: string;
  session: string;
  guard: LoginGuard;
  hub: EventHub;
  root: string;
}

async function login(req: IncomingMessage, res: ServerResponse, state: RouteState): Promise<void> {
  if (state.guard.blocked()) {
    sendError(res, "rate_limited", "too many wrong links; wait a minute", 429);
    return;
  }
  const body = (await readJson(req)) as { token?: unknown };
  if (typeof body.token !== "string" || !safeEqual(body.token, state.link)) {
    state.guard.noteFailure();
    sendError(res, "unauthorized", "this link is not this lobby's (or it was reset)", 401);
    return;
  }
  sendJson(res, 200, { ok: true, result: {} }, { "Set-Cookie": sessionCookie(state.session) });
}

function openStream(req: IncomingMessage, res: ServerResponse, url: URL, state: RouteState): void {
  state.hub.add(req, res, {
    activityAfter: numParam(url, "activityAfter"),
    thoughtsAfter: numParam(url, "thoughtsAfter"),
    chatAfter: numParam(url, "chatAfter"),
  });
  req.on("close", () => state.hub.remove(res));
}

async function routeApi(req: IncomingMessage, res: ServerResponse, url: URL, state: RouteState): Promise<void> {
  if (req.method !== "POST") {
    sendError(res, "unsupported", "only POST", 405);
    return;
  }
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    sendError(res, "unsupported", "send JSON", 415);
    return;
  }
  if (url.pathname === "/api/auth.login") return login(req, res, state);
  if (!isSignedIn(req.headers.cookie, state.session)) {
    sendError(res, "unauthorized", "open the link Pi printed", 401);
    return;
  }
  const name = callName(url);
  if (name === undefined) {
    sendError(res, "not_found", `no call ${url.pathname.slice("/api/".length)}`, 404);
    return;
  }
  const result = await routeApiCall(name, await readJson(req), { service: state.service, port: state.port });
  sendJson(res, 200, { ok: true, result });
}

function previewNames(url: URL): { task: string; name: string } | undefined {
  const parts = url.pathname.slice("/files/preview/".length).split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { task: parts[0]!, name: parts[1]! };
}

async function route(req: IncomingMessage, res: ServerResponse, state: RouteState): Promise<void> {
  if (!isHostAllowed(req.headers.host, state.port)) {
    sendError(res, "forbidden", "unknown host", 403);
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/files/preview/")) {
    if (req.method !== "GET") {
      sendError(res, "unsupported", "only GET", 405);
      return;
    }
    const names = previewNames(url);
    if (!names) {
      sendError(res, "not_found", "no such preview", 404);
      return;
    }
    await servePreview(res, names.task, names.name, isSignedIn(req.headers.cookie, state.session));
    return;
  }
  if (!url.pathname.startsWith("/api/")) {
    await serveStatic(req, res, url.pathname, state.root);
    return;
  }
  if (isCrossSite(req.headers.origin, req.headers["sec-fetch-site"] as string | undefined, state.port)) {
    sendError(res, "forbidden", "cross-site request", 403);
    return;
  }
  if (url.pathname === "/api/events") {
    if (req.method !== "GET") {
      sendError(res, "unsupported", "only GET", 405);
      return;
    }
    if (!isSignedIn(req.headers.cookie, state.session)) {
      sendError(res, "unauthorized", "open the link Pi printed", 401);
      return;
    }
    openStream(req, res, url, state);
    return;
  }
  await routeApi(req, res, url, state);
}

function tryListen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function isBusy(error: unknown): boolean {
  return (error as { code?: string }).code === "EADDRINUSE";
}

/** Start the loopback server; one per process (a second start throws). */
export async function startWebServer(options: WebServerOptions): Promise<WebServer> {
  if (current) throw new Error("the web server is already running");
  const loaded = options.secret ? { secret: options.secret, created: false, replaced: false } : loadOrCreateSecret();
  if (loaded.replaced) lobbyFeed.log("LOBBY", "the web link was reset: web.json was unreadable", "warning");
  const link = linkToken(loaded.secret);
  const session = sessionValue(loaded.secret);
  const hub = new EventHub(options.heartbeatMs);
  hub.attach(options.service);
  const state: RouteState = {
    service: options.service,
    port: 0,
    link,
    session,
    guard: new LoginGuard(),
    hub,
    root: distDir(options.dist),
  };
  const server: Server = createServer((req, res) => {
    route(req, res, state).catch((error: Error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) sendError(res, error.code, error.message, error.status);
      else {
        lobbyFeed.log("LOBBY", `the web server could not do that — ${error.message}`, "error");
        sendError(res, "failed", "the lobby could not do that", 500);
      }
    });
  });
  const base = basePort(options.port);
  let bound = 0;
  for (let port = base; port <= base + PORT_RANGE; port += 1) {
    try {
      await tryListen(server, port);
      bound = (server.address() as AddressInfo)?.port || port;
      break;
    } catch (error) {
      if (!isBusy(error)) throw error;
    }
  }
  if (!bound) {
    hub.close();
    throw new Error(`no free port from ${base} to ${base + PORT_RANGE}`);
  }
  state.port = bound;
  hookExit();
  const api: WebServer = {
    link: `http://127.0.0.1:${bound}/#token=${link}`,
    port: bound,
    clients: () => hub.clients(),
    rebind: (service) => {
      state.service = service;
      hub.attach(service);
      hub.hello();
    },
    reset: () => {
      const secret = resetSecret();
      state.link = linkToken(secret);
      state.session = sessionValue(secret);
      state.guard = new LoginGuard();
      return `http://127.0.0.1:${state.port}/#token=${state.link}`;
    },
    close: async () => {
      hub.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      if (current === api) current = undefined;
    },
  };
  current = api;
  return api;
}

/** The running server, if any. */
export function currentWebServer(): WebServer | undefined {
  return current;
}


