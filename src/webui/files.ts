/**
 * Preview images over HTTP: `GET /files/preview/<task>/<name>`. Only files
 * under that task's preview dir (resolved with `realpath`, so symlinks cannot
 * escape it), only `.png/.jpg/.jpeg/.gif/.webp`, with the right type and
 * `nosniff`. The session cookie is required, like everywhere else.
 */
import type { ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { previewDir } from "../ask/relay.ts";
import { applyBaseHeaders, HttpError, sendError } from "./api/index.ts";

const PREVIEW_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function previewsRoot(): string {
  return join(tmpdir(), "bot-lobby-previews");
}

/** Whether `task`/`name` name a file without reaching outside their folder. */
export function isPreviewName(task: string, name: string): boolean {
  if (!/^[\w.-]+$/.test(task) || !/^[\w.-]+$/.test(name)) return false;
  const ext = extname(name).toLowerCase();
  return PREVIEW_TYPES[ext] !== undefined;
}

/** An absolute image path under the previews root as its preview URL, if it is one. */
export function previewUrlFor(absPath: string): string | undefined {
  const root = previewsRoot();
  const resolved = resolve(absPath);
  if (resolved !== root && !resolved.startsWith(root + sep)) return undefined;
  const rel = relative(root, resolved);
  const [task, name, ...rest] = rel.split(sep);
  if (!task || !name || rest.length > 0 || !isPreviewName(task, name)) return undefined;
  return `/files/preview/${task}/${name}`;
}

/** Every absolute preview path in a prompt payload as its preview URL. */
export function rewritePreviewImages(payload: unknown): unknown {
  if (typeof payload === "string") return previewUrlFor(payload) ?? payload;
  if (Array.isArray(payload)) return payload.map(rewritePreviewImages);
  if (payload && typeof payload === "object") {
    return Object.fromEntries(Object.entries(payload as Record<string, unknown>).map(([key, value]) => [key, rewritePreviewImages(value)]));
  }
  return payload;
}

/** The preview file's bytes, jailed to its task's preview dir, or undefined when refused. */
export async function readPreview(task: string, name: string): Promise<{ body: Buffer; type: string } | undefined> {
  if (!isPreviewName(task, name)) return undefined;
  let real: string;
  try {
    real = await realpath(join(previewDir(task), name));
  } catch {
    return undefined;
  }
  let base: string;
  try {
    base = await realpath(previewDir(task));
  } catch {
    return undefined;
  }
  if (real !== base && !real.startsWith(base + sep)) return undefined;
  try {
    return { body: await readFile(real), type: PREVIEW_TYPES[extname(name).toLowerCase()]! };
  } catch {
    return undefined;
  }
}

/** Serve one preview; 401 without the cookie, 404 for anything jailed away. */
export async function servePreview(res: ServerResponse, task: string, name: string, signedIn: boolean): Promise<void> {
  if (!signedIn) {
    sendError(res, "unauthorized", "open the link Pi printed", 401);
    return;
  }
  const found = await readPreview(task, name);
  if (!found) throw new HttpError(404, "not_found", "no such preview");
  applyBaseHeaders(res);
  res.writeHead(200, { "Content-Type": found.type, "Cache-Control": "no-store" });
  res.end(found.body);
}
