/**
 * The lobby's local web server: the page's files, a JSON API and an event
 * stream, on 127.0.0.1 only. Pi's process runs it beside the terminal lobby.
 *
 * Who may use it (ARCHITECTURE §7):
 * - Only this machine: it listens on loopback, and a request naming any other
 *   host (a DNS-rebinding page) is refused.
 * - Only whoever has the link: the link carries a token in its `#fragment`
 *   (never sent in a URL to any server); the page trades it once for an
 *   HttpOnly, SameSite=Strict cookie. Every API call and the stream need that cookie.
 * - Never another website: no CORS headers, POST takes JSON only (a
 *   cross-site form cannot send it without a preflight nobody answers), and a
 *   foreign Origin or Sec-Fetch-Site is refused.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { LobbyService } from "./service.ts";
import type { Api, ApiErrorCode, ApiName, ApiReply, StreamEvent, Topic } from "./protocol.ts";

export interface ServerOptions {
  service: LobbyService;
  /** 32 random bytes, kept with the user's settings so a link and its cookie outlive a restart. */
  secret: Buffer;
  /** The built page: index.html, app.js, app.css. */
  staticDir: string;
  /** 0 picks a free port. */
  port?: number;
  /** How often the stream says it is alive, so phones and proxies keep it open. */
  heartbeatMs?: number;
  /** Streaming reply steps share one message per this many ms (the terminal lobby's frame). */
  frameMs?: number;
}

export interface LobbyServer {
  /** The link to print: the token rides in the fragment. */
  link: string;
  port: number;
  /** Open event streams (the page in each browser tab). */
  clients(): number;
  close(): Promise<void>;
}

export const MAX_BODY_BYTES = 1_000_000;
const COOKIE = "bot_lobby";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
/** The page loads nothing from anywhere else, so a model's Markdown cannot pull in a tracking image or a script. */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const LOGIN_FAILURES_PER_MINUTE = 10;

function derive(secret: Buffer, purpose: string): string {
  return createHmac("sha256", secret).update(purpose).digest("base64url");
}

function same(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

function cookieOf(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function baseHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function reply<T>(response: ServerResponse, status: number, body: ApiReply<T>, extra: Record<string, string> = {}): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  response.end(JSON.stringify(body));
}

function refuse(response: ServerResponse, status: number, code: ApiErrorCode, error: string): void {
  reply(response, status, { ok: false, error, code });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("the body is not JSON"), { status: 400 });
  }
}

type Handler = (body: Record<string, unknown>) => unknown;

function handlers(service: LobbyService): { [Name in ApiName]: Handler } {
  return {
    "lobby.snapshot": () => service.snapshot(),
    "lobby.send": (body) => {
      if (typeof body.text !== "string" || body.text.length > 20_000) throw Object.assign(new Error("text must be a string of at most 20,000 characters"), { status: 400 });
      return service.send(body.text) satisfies Api["lobby.send"]["result"];
    },
    "lobby.abort": () => {
      service.abort();
      return {};
    },
  };
}

export async function startLobbyServer(options: ServerOptions): Promise<LobbyServer> {
  const linkToken = derive(options.secret, "bot-lobby link v1");
  const sessionValue = derive(options.secret, "bot-lobby session v1");
  const api = handlers(options.service);
  const streams = new Set<ServerResponse>();
  const versions: Partial<Record<Topic, number>> = {};
  let failures: number[] = [];
  let port = 0;

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const allowedOrigins = () => new Set([...allowedHosts()].map((host) => `http://${host}`));

  const broadcast = (event: StreamEvent) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const stream of streams) stream.write(frame);
  };

  // A streaming reply changes dozens of times a second; clients get its newest text at most once a frame.
  let pendingReply: string | undefined;
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  const flushReply = () => {
    clearTimeout(replyTimer);
    replyTimer = undefined;
    if (pendingReply !== undefined) broadcast({ type: "reply", text: pendingReply });
    pendingReply = undefined;
  };
  const unsubscribe = options.service.onChange((change) => {
    if ("reply" in change) {
      pendingReply = change.reply;
      replyTimer ??= setTimeout(flushReply, options.frameMs ?? 40);
      return;
    }
    // A held reply step goes out before the change that may end the reply; sent after it, the page would show the finished reply as still streaming.
    flushReply();
    const version = (versions[change.topic] ?? 0) + 1;
    versions[change.topic] = version;
    broadcast({ type: "changed", topic: change.topic, version });
  });

  const signedIn = (request: IncomingMessage) => {
    const value = cookieOf(request, COOKIE);
    return value !== undefined && same(value, sessionValue);
  };

  async function serveStatic(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") return refuse(response, 405, "unsupported", "only GET");
    const relative = normalize(path === "/" ? "index.html" : decodeURIComponent(path).replace(/^\/+/, ""));
    const file = join(options.staticDir, relative);
    if (relative.startsWith("..") || !file.startsWith(options.staticDir + sep) || !TYPES[extname(file)]) return refuse(response, 404, "not_found", "no such file");
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return refuse(response, 404, "not_found", "no such file");
    }
    const html = extname(file) === ".html";
    response.writeHead(200, {
      "Content-Type": TYPES[extname(file)]!,
      // The page itself is reread each time, so a new version of bot-lobby shows at once; built files are named by content.
      "Cache-Control": html ? "no-cache" : "public, max-age=3600",
      ...(html ? { "Content-Security-Policy": CSP } : {}),
    });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  function openStream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    response.write(`retry: 2000\ndata: ${JSON.stringify({ type: "hello", versions } satisfies StreamEvent)}\n\n`);
    streams.add(response);
    const beat = setInterval(() => response.write(": alive\n\n"), options.heartbeatMs ?? 15_000);
    request.on("close", () => {
      clearInterval(beat);
      streams.delete(response);
    });
  }

  async function login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const now = Date.now();
    failures = failures.filter((at) => now - at < 60_000);
    if (failures.length >= LOGIN_FAILURES_PER_MINUTE) return refuse(response, 429, "forbidden", "too many wrong links; wait a minute");
    const body = (await readJson(request)) as { token?: unknown };
    if (typeof body.token !== "string" || !same(body.token, linkToken)) {
      failures.push(now);
      return refuse(response, 401, "unauthorized", "this link is not this lobby's (or it was reset): run /bot-lobby web in Pi for the current one");
    }
    reply(response, 200, { ok: true, result: {} }, { "Set-Cookie": `${COOKIE}=${sessionValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    baseHeaders(response);
    // DNS rebinding: a page on evil.example resolved to 127.0.0.1 still says evil.example here.
    if (!allowedHosts().has(request.headers.host ?? "")) return refuse(response, 403, "forbidden", "unknown host");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/")) return serveStatic(request, response, url.pathname);

    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    if ((origin && !allowedOrigins().has(origin)) || (site && site !== "same-origin" && site !== "none")) return refuse(response, 403, "forbidden", "cross-site request");

    if (url.pathname === "/api/events") {
      if (request.method !== "GET") return refuse(response, 405, "unsupported", "only GET");
      if (!signedIn(request)) return refuse(response, 401, "unauthorized", "open the link Pi printed");
      return openStream(request, response);
    }
    if (request.method !== "POST") return refuse(response, 405, "unsupported", "only POST");
    if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return refuse(response, 415, "unsupported", "send JSON");
    if (url.pathname === "/api/auth.login") return login(request, response);
    if (!signedIn(request)) return refuse(response, 401, "unauthorized", "open the link Pi printed");

    const name = url.pathname.slice("/api/".length) as ApiName;
    const handler = Object.hasOwn(api, name) ? api[name] : undefined;
    if (!handler) return refuse(response, 404, "not_found", `no call ${name}`);
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(response, 400, "bad_request", "the body must be a JSON object");
    reply(response, 200, { ok: true, result: await handler(body as Record<string, unknown>) });
  }

  const server: Server = createServer((request, response) => {
    route(request, response).catch((error: Error & { status?: number }) => {
      if (response.headersSent) return response.destroy();
      const status = error.status ?? 500;
      refuse(response, status, status === 413 ? "too_large" : status === 400 ? "bad_request" : "failed", status === 500 ? "the lobby could not do that" : error.message);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  return {
    link: `http://127.0.0.1:${port}/#token=${linkToken}`,
    port,
    clients: () => streams.size,
    close: async () => {
      unsubscribe();
      clearTimeout(replyTimer);
      for (const stream of streams) stream.end();
      streams.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
