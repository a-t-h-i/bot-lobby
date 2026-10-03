/**
 * Files attached in the page's composer: images, PDFs and anything else, up
 * to 20 MB each. They are saved outside the repository (next to the agents'
 * preview images, so they are never part of a change) and the message that
 * carries them names each file by its path, which is how the agents read
 * them. Images are also served back to the page through the preview route.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { previewDir } from "../ask/relay.ts";
import { claimAttachments, sweepAttachments } from "../state/attachments.ts";
import { ATTACHMENTS_MARK } from "../lobby/prompts.ts";
import { fail } from "./api/index.ts";
import type { UploadInfo } from "./protocol.ts";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** The preview folder the attachments live in: `/files/preview/attachments/<id>`. */
export const ATTACHMENT_BUCKET = "attachments";
/** Unsent or task-less files are deleted after this long. */
const STALE_MS = 3 * 24 * 60 * 60 * 1000;
/** How many files one message may carry. */
export const MAX_ATTACHMENTS = 8;

export type Upload = UploadInfo;
type UploadKind = Upload["kind"];

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

function safeName(name: string): string {
  const flat = name.replace(/^.*[\\/]/, "").replace(/[^\w.-]+/g, "_").replace(/^\.+/, "");
  const trimmed = flat.length > 80 ? `${flat.slice(0, 40)}${flat.slice(-40)}` : flat;
  return trimmed || "file";
}

function mimeOf(name: string, claimed: string): string {
  const ext = extname(name).toLowerCase();
  return IMAGE_TYPES[ext] ?? (ext === ".pdf" ? "application/pdf" : claimed.trim() && /^[\w.+-]+\/[\w.+-]+$/.test(claimed.trim()) ? claimed.trim() : "application/octet-stream");
}

function kindOf(mime: string): UploadKind {
  if (mime.startsWith("image/") && Object.values(IMAGE_TYPES).includes(mime)) return "image";
  return mime === "application/pdf" ? "pdf" : "file";
}

/** Save one file; the id is its name in the attachments folder. */
export function saveUpload(name: string, claimedType: string, bytes: Buffer): Upload {
  sweepAttachments(STALE_MS);
  const dir = previewDir(ATTACHMENT_BUCKET);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}-${safeName(name)}`;
  writeFileSync(join(dir, id), bytes, { mode: 0o600 });
  const mime = mimeOf(name, claimedType);
  const kind = kindOf(mime);
  return { id, name: safeName(name), mime, size: bytes.length, kind, ...(kind === "image" ? { url: `/files/preview/${ATTACHMENT_BUCKET}/${id}` } : {}) };
}

/** `text`, then the files it carries by path, the way the agents read them; they belong to `taskId` and go with it. */
export function withAttachments(text: string, ids: readonly string[] | undefined, taskId?: string): string {
  if (!ids || ids.length === 0) return text;
  const dir = previewDir(ATTACHMENT_BUCKET);
  const lines = ids.slice(0, MAX_ATTACHMENTS).map((id) => {
    if (!/^[\w.-]+$/.test(id) || !existsSync(join(dir, id)) || !statSync(join(dir, id)).isFile()) fail(400, "bad_request", `the attachment ${id} is not there; attach it again`);
    return `- ${join(dir, id)} (${mimeOf(id, "")})`;
  });
  if (taskId) claimAttachments(ids.slice(0, MAX_ATTACHMENTS), taskId);
  return `${text.trim()}${text.trim() ? "\n\n" : ""}${ATTACHMENTS_MARK}\n${lines.join("\n")}`;
}
