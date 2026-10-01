/**
 * The built page (`webui/dist`), served from loopback with a per-response
 * Content-Security-Policy nonce. `index.html` carries `__CSP_NONCE__` (its
 * meta and the nonce attributes Vite emits); every response replaces each
 * occurrence with a fresh nonce and sends the CSP carrying that same nonce.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { applyBaseHeaders, HttpError } from "./api/index.ts";

/** The placeholder the built `index.html` carries where the nonce goes. */
export const NONCE_PLACEHOLDER = "__CSP_NONCE__";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
};

/** Where the built page lives; tests point `BOT_LOBBY_WEBUI_DIST` at a fixture. */
export function distDir(override?: string): string {
  return override ?? process.env.BOT_LOBBY_WEBUI_DIST ?? join(process.cwd(), "webui", "dist");
}

/** A fresh base64 nonce (16 random bytes) for one `index.html` response. */
export function freshNonce(): string {
  return randomBytes(16).toString("base64");
}

/** The page loads nothing from anywhere else, so model Markdown cannot pull in a tracker or a script. */
export function cspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Resolve a URL path to a file under `root`, or undefined when refused. */
export function resolveStaticPath(urlPath: string, root: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  const relative = normalize(decoded === "/" ? "index.html" : decoded.replace(/^\/+/, ""));
  if (relative === "" || relative.startsWith("..") || relative.includes(`..${sep}`)) return undefined;
  const file = join(root, relative);
  if (!file.startsWith(root + sep) && file !== join(root, "index.html")) return undefined;
  if (TYPES[extname(file).toLowerCase()] === undefined) return undefined;
  return file;
}

/** Refusals from static serving read as 404s (nothing outside the folder exists). */
function missing(): HttpError {
  return new HttpError(404, "not_found", "no such file");
}

function sendHtml(res: ServerResponse, html: string, nonce: string): void {
  applyBaseHeaders(res);
  res.writeHead(200, {
    "Content-Type": TYPES[".html"]!,
    "Content-Security-Policy": cspHeader(nonce),
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function sendAsset(res: ServerResponse, body: Buffer, ext: string): void {
  applyBaseHeaders(res);
  res.writeHead(200, { "Content-Type": TYPES[ext]!, "Cache-Control": "public, max-age=31536000, immutable" });
  res.end(body);
}

/**
 * Serve one static path. Only GET and HEAD; `index.html` gets a fresh nonce
 * per response, hashed assets are immutable for a year. Throws `HttpError`
 * (404) for traversals, unknown extensions and missing files.
 */
export async function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string, root: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "unsupported", "only GET");
  const file = resolveStaticPath(urlPath, root);
  if (!file) throw missing();
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    throw missing();
  }
  if (req.method === "HEAD") {
    applyBaseHeaders(res);
    res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()]! });
    res.end();
    return;
  }
  const ext = extname(file).toLowerCase();
  if (ext === ".html") {
    const nonce = freshNonce();
    sendHtml(res, body.toString("utf8").split(NONCE_PLACEHOLDER).join(nonce), nonce);
    return;
  }
  sendAsset(res, body, ext);
}
