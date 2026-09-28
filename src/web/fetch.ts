/**
 * Fetching a page for a model, safely: http(s) only, public addresses only
 * (a page cannot send the researcher to localhost, the LAN or a cloud
 * metadata endpoint, through a redirect either), a size cap, a time limit,
 * and the body decoded by its declared charset.
 * `BOT_LOBBY_WEB_ALLOW_PRIVATE=1` lifts the address rule (a local docs server).
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Fetcher = typeof fetch;
export type Lookup = (host: string) => Promise<string[]>;

export interface FetchOptions {
  signal?: AbortSignal;
  /** Bytes read at most; the rest is cut off. */
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  /** Swappable for tests. */
  fetch?: Fetcher;
  lookup?: Lookup;
  allowPrivate?: boolean;
}

export interface FetchedPage {
  /** Where the page was finally read from, after redirects. */
  url: string;
  status: number;
  statusText: string;
  contentType: string;
  headers: Headers;
  /** The body as text; empty for a binary one (a PDF, an image), which is not read. */
  text: string;
  bytes: number;
  truncated: boolean;
  binary: boolean;
  redirects: string[];
}

export const MAX_BYTES = 3 * 1024 * 1024;
export const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
export const USER_AGENT = "Mozilla/5.0 (compatible; bot-lobby research; +https://github.com/a-t-h-i/bot-lobby)";
const ACCEPT = "text/html,application/xhtml+xml,text/markdown;q=0.9,text/plain;q=0.8,application/json;q=0.7,*/*;q=0.5";

/** True for an address that is not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(ip);
  if (version === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (version === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) {
      const [high = "0", low = "0"] = ip.slice(7).split(":");
      const value = (Number.parseInt(high, 16) << 16) | Number.parseInt(low, 16);
      return isPrivateAddress([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join("."));
    }
    return /^(fc|fd|fe[89ab]|ff)/.test(ip);
  }
  return false;
}

const defaultLookup: Lookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Why a URL may not be fetched, or undefined when it may: not http(s), a
 * private or local host, or a name that resolves to one. A name that does not
 * resolve here is let through (a proxy may resolve it; the fetch then says).
 */
export async function blockedReason(url: URL, lookup: Lookup = defaultLookup, allowPrivate = process.env.BOT_LOBBY_WEB_ALLOW_PRIVATE === "1"): Promise<string | undefined> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return `only http and https pages can be fetched, not ${url.protocol.replace(/:$/, "")}`;
  if (url.username || url.password) return "URLs with credentials in them are not fetched";
  if (allowPrivate) return undefined;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  const local = "is a private or local address; only public pages are fetched (BOT_LOBBY_WEB_ALLOW_PRIVATE=1 allows it)";
  if (isIP(host)) return isPrivateAddress(host) ? `${host} ${local}` : undefined;
  if (host === "localhost" || /\.(localhost|local|internal|home\.arpa|lan)$/.test(host) || !host.includes(".")) return `${host} ${local}`;
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return undefined;
  }
  const inside = addresses.find(isPrivateAddress);
  return inside ? `${host} resolves to ${inside}, which ${local}` : undefined;
}

function charsetOf(contentType: string, head: Uint8Array): string {
  const declared = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  if (declared) return declared;
  if (!/html|xml/i.test(contentType)) return "utf-8";
  const sniff = new TextDecoder("latin1").decode(head.subarray(0, 2048));
  return /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(sniff)?.[1] ?? "utf-8";
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(await response.arrayBuffer()).subarray(0, maxBytes), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

const TEXTUAL = /^(text\/|application\/(json|xml|xhtml\+xml|javascript|x-javascript|ecmascript|x-yaml|yaml|toml)\b|[^;]*\+(json|xml)\b)/i;

/** True for a content type read as text (an unlabelled body counts). */
export function isTextual(contentType: string): boolean {
  return !contentType.trim() || TEXTUAL.test(contentType.trim());
}

/** A friendlier message for why a fetch failed. */
export function fetchError(error: unknown, url: string): Error {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const name = (error as { name?: string })?.name;
  if (name === "TimeoutError") return new Error(`${url} did not answer in time`);
  if (name === "AbortError") return new Error(`fetching ${url} was stopped`);
  const code = cause?.code ?? "";
  const reason = code === "ENOTFOUND" ? "the host does not exist" : code === "ECONNREFUSED" ? "the connection was refused" : code === "CERT_HAS_EXPIRED" || /CERT|SSL|TLS/.test(code) ? "its TLS certificate is not valid" : cause?.message ?? (error instanceof Error ? error.message : String(error));
  return new Error(`could not fetch ${url}: ${reason}`);
}

/**
 * Fetch a public page (following up to five redirects, each checked like the
 * first) and read at most `maxBytes` of it as text. Throws with a readable
 * reason when the URL is refused or unreachable; an HTTP error status is a
 * page like any other, for the caller to judge.
 */
export async function fetchPage(input: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const lookup = options.lookup ?? defaultLookup;
  const allowPrivate = options.allowPrivate ?? process.env.BOT_LOBBY_WEB_ALLOW_PRIVATE === "1";
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`"${input}" is not a URL`);
  }
  const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const redirects: string[] = [];
  let method = options.method ?? "GET";
  let body = options.body;
  for (;;) {
    const blocked = await blockedReason(url, lookup, allowPrivate);
    if (blocked) throw new Error(`not fetched: ${blocked}`);
    let response: Response;
    try {
      response = await fetcher(url.href, {
        method,
        ...(body !== undefined ? { body } : {}),
        redirect: "manual",
        signal,
        headers: { "user-agent": USER_AGENT, accept: options.accept ?? ACCEPT, "accept-language": "en;q=0.9, *;q=0.5", ...options.headers },
      });
    } catch (error) {
      throw fetchError(error, url.href);
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      if (redirects.length >= MAX_REDIRECTS) throw new Error(`${input} redirects more than ${MAX_REDIRECTS} times`);
      redirects.push(url.href);
      url = new URL(location, url);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!isTextual(contentType)) {
      await response.body?.cancel().catch(() => {});
      const length = Number(response.headers.get("content-length") ?? 0);
      return { url: url.href, status: response.status, statusText: response.statusText, contentType, headers: response.headers, text: "", bytes: Number.isFinite(length) ? length : 0, truncated: false, binary: true, redirects };
    }
    let read: { bytes: Uint8Array; truncated: boolean };
    try {
      read = await readCapped(response, options.maxBytes ?? MAX_BYTES);
    } catch (error) {
      throw fetchError(error, url.href);
    }
    return {
      url: url.href,
      status: response.status,
      statusText: response.statusText,
      contentType,
      headers: response.headers,
      text: decode(read.bytes, charsetOf(contentType, read.bytes)),
      bytes: read.bytes.byteLength,
      truncated: read.truncated,
      binary: false,
      redirects,
    };
  }
}
