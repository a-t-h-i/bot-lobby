/**
 * Reading pages and checking sources: a fetched page as readable text with
 * its title and dates (kept a few minutes, so reading on from an offset does
 * not fetch it again), and a URL's standing as a citation (reachable, where
 * it ends up, when it was published).
 */
import { fetchPage, type FetchOptions } from "./fetch.ts";
import { htmlToMarkdown, pageMeta, type PageMeta } from "./extract.ts";
import { parseHtml } from "./html.ts";

export interface ReadPage extends PageMeta {
  url: string;
  /** The URL asked for, when a redirect moved it. */
  requested?: string;
  status: number;
  contentType: string;
  /** The page as Markdown or text. */
  text: string;
  /** The body was longer than was read. */
  cut: boolean;
}

export interface SourceStatus extends PageMeta {
  url: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  finalUrl?: string;
  contentType?: string;
  /** The server's Last-Modified header, when it sends one. */
  lastModified?: string;
  error?: string;
}

const CACHE_MS = 10 * 60 * 1000;
const CACHE_SIZE = 40;
const cache = new Map<string, { page: ReadPage; at: number }>();

export function clearPageCache(): void {
  cache.clear();
}

const HTML = /html|xml/i;

function looksLikeHtml(contentType: string, text: string): boolean {
  if (/xhtml|html/i.test(contentType)) return true;
  if (contentType.trim()) return false;
  return /^\s*(<!doctype html|<html|<head|<body)/i.test(text);
}

function kilobytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A page as text: HTML to Markdown, JSON pretty, other text as it is. Binary files are refused. */
export async function readPage(url: string, options: FetchOptions = {}): Promise<ReadPage> {
  const key = url.trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.page;
  const fetched = await fetchPage(key, options);
  const type = fetched.contentType.split(";")[0]!.trim().toLowerCase();
  if (fetched.binary) {
    throw new Error(`${fetched.url} is ${type || "a binary file"}${fetched.bytes ? ` (${kilobytes(fetched.bytes)})` : ""}; only web pages and text can be read${type === "application/pdf" ? ". Look for an HTML version of it (an abstract page, docs, a release note)" : ""}`);
  }
  let page: ReadPage;
  const base = { url: fetched.url, ...(fetched.redirects.length > 0 ? { requested: key } : {}), status: fetched.status, contentType: type, cut: fetched.truncated };
  if (looksLikeHtml(type, fetched.text)) {
    const readable = htmlToMarkdown(fetched.text, fetched.url);
    const { markdown, ...meta } = readable;
    page = { ...meta, ...base, text: markdown || readable.description || "" };
  } else if (/json/.test(type)) {
    let text = fetched.text;
    try {
      text = JSON.stringify(JSON.parse(fetched.text), null, 2);
    } catch {
      // Not valid JSON after all: shown as it came.
    }
    page = { ...base, text: `\`\`\`json\n${text}\n\`\`\`` };
  } else {
    page = { ...base, text: fetched.text.replace(/\r\n?/g, "\n") };
  }
  if (!page.modified) {
    const lastModified = fetched.headers.get("last-modified");
    if (lastModified && !Number.isNaN(Date.parse(lastModified))) page.modified = new Date(lastModified).toISOString().slice(0, 10);
  }
  if (fetched.status < 400) {
    cache.set(key, { page, at: Date.now() });
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return page;
}

/** How each source stands: reachable or not, where it ends up, its title and dates. */
export async function checkSource(url: string, options: FetchOptions = {}): Promise<SourceStatus> {
  try {
    const fetched = await fetchPage(url, { ...options, maxBytes: 512 * 1024 });
    const type = fetched.contentType.split(";")[0]!.trim().toLowerCase();
    const meta = HTML.test(type) || looksLikeHtml(type, fetched.text) ? pageMeta(parseHtml(fetched.text)) : {};
    const lastModified = fetched.headers.get("last-modified") ?? undefined;
    return {
      url,
      ok: fetched.status < 400,
      status: fetched.status,
      statusText: fetched.statusText,
      ...(fetched.redirects.length > 0 ? { finalUrl: fetched.url } : {}),
      contentType: type,
      ...(lastModified ? { lastModified } : {}),
      ...meta,
    };
  } catch (error) {
    return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
