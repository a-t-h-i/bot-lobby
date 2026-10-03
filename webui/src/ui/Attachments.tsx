/**
 * The files a message carries. The server appends them to a message as
 * `Attached files:` and one `- <path> (<type>)` line each (see
 * `src/webui/uploads.ts`); `splitAttachments` takes that block off the text
 * and `AttachmentList` shows images as thumbnails (through the preview route)
 * and everything else as a chip with its name.
 */
import { FileText, Paperclip } from "lucide-react"
import { ATTACHMENTS_MARK } from "@shared"

export interface AttachmentRef {
  id: string
  name: string
  mime: string
}

const LINE = /^-\s+(.+?)\s+\(([^()\s]+\/[^()\s]+)\)\s*$/

/** The text without its attachments block, and the files the block named. */
export function splitAttachments(text: string): { body: string; files: AttachmentRef[] } {
  const at = text.lastIndexOf(`${ATTACHMENTS_MARK}\n`)
  if (at < 0 || (at > 0 && text[at - 1] !== "\n")) return { body: text, files: [] }
  const lines = text.slice(at + ATTACHMENTS_MARK.length + 1).split("\n").filter(Boolean)
  const files: AttachmentRef[] = []
  for (const line of lines) {
    const match = LINE.exec(line)
    if (!match) return { body: text, files: [] }
    const id = match[1]!.split(/[\\/]/).pop() ?? ""
    if (!/^[\w.-]+$/.test(id)) return { body: text, files: [] }
    files.push({ id, name: id.replace(/^[a-z0-9]+-/, ""), mime: match[2]! })
  }
  return files.length > 0 ? { body: text.slice(0, at).trimEnd(), files } : { body: text, files: [] }
}

const IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

export function AttachmentList({ files }: { files: AttachmentRef[] }) {
  if (files.length === 0) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached files">
      {files.map((file) => (
        <li key={file.id}>
          {IMAGES.has(file.mime) ? (
            <a href={`/files/preview/attachments/${file.id}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md border border-border bg-muted/40 transition-transform duration-150 ease-snap hover:scale-[1.02]">
              <img src={`/files/preview/attachments/${file.id}`} alt={file.name} loading="lazy" className="max-h-40 max-w-56 object-cover" />
            </a>
          ) : (
            <span className="inline-flex max-w-64 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {file.mime === "application/pdf" ? <FileText aria-hidden="true" className="size-4 shrink-0" /> : <Paperclip aria-hidden="true" className="size-4 shrink-0" />}
              <span className="truncate">{file.name}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
