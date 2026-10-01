/**
 * Who may use the loopback server: whoever holds the link. The link carries
 * a token in its `#fragment` (never sent to any server); the page trades it
 * once for an HttpOnly, SameSite=Strict cookie. Pure helpers plus the secret
 * file; the server wires them to HTTP.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { globalConfigDir } from "../state/project.ts";

/** Largest JSON body the server reads; past it the request is refused. */
export const MAX_BODY_BYTES = 1_000_000;
/** Session cookie name. */
export const COOKIE_NAME = "bl_session";
/** Wrong link tokens per minute before the server locks logins out. */
export const LOGIN_FAILURES_PER_MINUTE = 10;
/** The lockout window (and the failure window) in milliseconds. */
export const LOGIN_WINDOW_MS = 60_000;

function derive(secret: Buffer, purpose: string): string {
  return createHmac("sha256", secret).update(purpose).digest("base64url");
}

/** The token the link carries (`#token=…`). */
export function linkToken(secret: Buffer): string {
  return derive(secret, "bot-lobby link v1");
}

/** The cookie value a signed-in browser holds. */
export function sessionValue(secret: Buffer): string {
  return derive(secret, "bot-lobby session v1");
}

/** Constant-time string compare (both sides hashed first, so lengths match). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** Path of the secret file: `web.json` under the user-global config dir. */
export function webSecretPath(): string {
  return join(globalConfigDir(), "web.json");
}

/** Leave a file readable only by its owner; fix it when it is wider. */
function ensurePrivate(path: string): void {
  try {
    if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, 0o600);
  } catch {
    // A file that cannot be inspected is replaced by the caller.
  }
}

function writeSecret(path: string): Buffer {
  const secret = randomBytes(32);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ secret: secret.toString("base64") }), { mode: 0o600 });
  ensurePrivate(path);
  return secret;
}

function readSecret(path: string): Buffer | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { secret?: unknown };
    if (typeof raw.secret !== "string") return undefined;
    const secret = Buffer.from(raw.secret, "base64");
    return secret.length === 32 ? secret : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The loopback secret, created on first use. A corrupt file is replaced
 * (`replaced` says so, and the caller logs a notice); a file that is wider
 * than 0600 is narrowed in place.
 */
export function loadOrCreateSecret(): { secret: Buffer; created: boolean; replaced: boolean } {
  const path = webSecretPath();
  if (!existsSync(path)) return { secret: writeSecret(path), created: true, replaced: false };
  const secret = readSecret(path);
  if (!secret) return { secret: writeSecret(path), created: false, replaced: true };
  ensurePrivate(path);
  return { secret, created: false, replaced: false };
}

/** A new secret, signing everyone out (the next step's `web reset`). */
export function resetSecret(): Buffer {
  return writeSecret(webSecretPath());
}

/** The `Set-Cookie` value for a signed-in browser. */
export function sessionCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
}

/** One cookie's value from a `Cookie` header. */
export function cookieOf(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** Whether the request carries this server's session cookie. */
export function isSignedIn(cookieHeader: string | undefined, session: string): boolean {
  const value = cookieOf(cookieHeader, COOKIE_NAME);
  return value !== undefined && value.length > 0 && safeEqual(value, session);
}

/** Hosts a loopback server on `port` answers to (DNS rebinding names anything else). */
export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

/** Whether `Host` names this loopback server. */
export function isHostAllowed(host: string | undefined, port: number): boolean {
  return host !== undefined && allowedHosts(port).has(host.trim().toLowerCase());
}

/** Origins this loopback server answers to. */
function allowedOrigins(port: number): Set<string> {
  return new Set([...allowedHosts(port)].map((host) => `http://${host}`));
}

/** A foreign `Origin` or a cross-site `Sec-Fetch-Site` (never another website). */
export function isCrossSite(origin: string | undefined, site: string | undefined, port: number): boolean {
  if (origin !== undefined && origin !== "" && !allowedOrigins(port).has(origin)) return true;
  return site === "cross-site" || site === "same-site";
}

/** Wrong link tokens in the last minute; past the limit logins lock out for that minute. */
export class LoginGuard {
  private failures: number[] = [];
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Whether logins are locked out right now. */
  blocked(at = this.now()): boolean {
    this.failures = this.failures.filter((seen) => at - seen < LOGIN_WINDOW_MS);
    return this.failures.length >= LOGIN_FAILURES_PER_MINUTE;
  }

  /** Record a wrong token. */
  noteFailure(at = this.now()): void {
    this.failures = [...this.failures.filter((seen) => at - seen < LOGIN_WINDOW_MS), at];
  }
}
