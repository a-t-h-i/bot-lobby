/**
 * Attached files: each goes up on its own as the raw body of
 * `POST /api/files.upload`, and the message that carries it names its id.
 */
import type { ApiReply, UploadInfo } from "@protocol"
import { ApiError } from "./api.ts"

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENTS = 8

/** `1.2 MB`, `340 KB`, `812 B`. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export async function uploadFile(file: File): Promise<UploadInfo> {
  if (file.size === 0) throw new Error(`${file.name || "That file"} is empty.`)
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name || "That file"} is larger than 20 MB.`)
  const query = new URLSearchParams({ name: file.name || "pasted-file", type: file.type })
  const response = await fetch(`/api/files.upload?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
    credentials: "same-origin",
  })
  const reply = (await response.json().catch(() => undefined)) as ApiReply<UploadInfo> | undefined
  if (!reply) throw new ApiError(`the lobby answered ${response.status}`, "failed", response.status)
  if (!reply.ok) throw new ApiError(reply.error, reply.code, response.status)
  return reply.result
}
