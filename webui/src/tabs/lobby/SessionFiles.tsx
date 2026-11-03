/**
 * The Lobby's files card on a wide window, under the tasks card: the files
 * you attached in this session and the files its agents edited, in two folds
 * (one open at a time, like the tasks card). An edited file opens in the code
 * viewer, on its diff while the working tree still differs from HEAD; an
 * attached image opens in the lightbox. Nothing shows while the session has
 * no files, or while the window is too narrow (surface.css hides it there).
 */
import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, FileCode2, FileText, Image as ImageIcon, Paperclip } from "lucide-react"
import type { CodeChange } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { filePathOf, openCode } from "@/app/code/codeStore"
import { projectUrl } from "@/lib/project"
import { lightboxClick } from "@/ui/Lightbox"
import { splitAttachments, type AttachmentRef } from "@/ui/Attachments"
import { sourceLabel, type ActivityEntry, type ChatEntry } from "./types"

const IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
/** An activity step that edits a file: `editing zen.ts`, `writing src/a.ts`. */
const EDIT = /\b(?:editing|writing)\s+(\S+)/i

interface Edited {
  name: string
  at: number
  by: string
  live: boolean
  change?: CodeChange
}

const baseName = (path: string) => path.split("/").at(-1) ?? path

/** Every file the session's messages carried, newest first, each once. */
function attachedFiles(chat: readonly ChatEntry[]): AttachmentRef[] {
  const seen = new Map<string, AttachmentRef>()
  for (let index = chat.length - 1; index >= 0; index--) {
    const entry = chat[index]!
    if (entry.role !== "you") continue
    for (const file of splitAttachments(entry.text).files) if (!seen.has(file.id)) seen.set(file.id, file)
  }
  return [...seen.values()]
}

/** Every file an agent edited, newest first, each once, matched to its working-tree change when one name fits. */
function editedFiles(activity: readonly ActivityEntry[], changes: readonly CodeChange[]): Edited[] {
  const byName = new Map<string, CodeChange[]>()
  for (const change of changes) {
    const key = baseName(change.path)
    byName.set(key, [...(byName.get(key) ?? []), change])
  }
  const seen = new Map<string, Edited>()
  for (let index = activity.length - 1; index >= 0; index--) {
    const entry = activity[index]!
    const match = EDIT.exec(entry.text)
    const name = match ? filePathOf(match[1]!.replace(/[)"'`\],.;:!?…]+$/, "")) : undefined
    if (!name || seen.has(name)) continue
    const exact = changes.find((change) => change.path === name)
    const named = byName.get(baseName(name))
    const change = exact ?? (named?.length === 1 ? named[0] : undefined)
    seen.set(name, { name, at: entry.at, by: entry.source, live: entry.pending, ...(change ? { change } : {}) })
  }
  return [...seen.values()]
}

function Fold({ label, count, open, onToggle, children }: { label: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <li className="cs-twi" data-open={open ? "true" : undefined}>
      <button type="button" className="cs-twh" aria-expanded={open} onClick={onToggle}>
        <span className="cs-twt">{label}</span>
        <span className="cs-twn">{count}</span>
        <ChevronDown aria-hidden="true" className="cs-twc" />
      </button>
      <div className="cs-twb">
        <div>{open ? <ul className="cs-sfl">{children}</ul> : null}</div>
      </div>
    </li>
  )
}

function EditedRow({ file }: { file: Edited }) {
  const path = file.change?.path ?? file.name
  const counts = file.change && (file.change.additions !== undefined || file.change.deletions !== undefined)
  return (
    <li>
      <button type="button" className="cs-sfr" data-live={file.live ? "true" : undefined} data-tip={`${path}, edited by ${sourceLabel(file.by)}`} onClick={() => openCode(path, file.change ? "diff" : "code")}>
        <FileCode2 aria-hidden="true" className="cs-sfi" />
        <span className="cs-sfn">{baseName(path)}</span>
        {counts ? (
          <span className="cs-sfc">
            <span>+{file.change!.additions ?? 0}</span>
            <span>−{file.change!.deletions ?? 0}</span>
          </span>
        ) : file.change?.status === "deleted" ? <span className="cs-sfc">deleted</span> : null}
      </button>
    </li>
  )
}

function AttachedRow({ file }: { file: AttachmentRef }) {
  const Icon = IMAGES.has(file.mime) ? ImageIcon : file.mime === "application/pdf" ? FileText : Paperclip
  const inner = (
    <>
      <Icon aria-hidden="true" className="cs-sfi" />
      <span className="cs-sfn">{file.name}</span>
    </>
  )
  if (!IMAGES.has(file.mime)) return <li><span className="cs-sfr" data-still="true" title={file.name}>{inner}</span></li>
  const src = projectUrl(`/files/preview/attachments/${file.id}`)
  return (
    <li>
      <a className="cs-sfr" href={src} target="_blank" rel="noopener noreferrer" data-tip={`Open ${file.name}`} onClick={lightboxClick({ src, alt: file.name })}>
        {inner}
      </a>
    </li>
  )
}

type Section = "edited" | "attached"

export function SessionFiles({ chat, activity }: { chat: readonly ChatEntry[]; activity: readonly ActivityEntry[] }) {
  const changes = useApiRead("code.changes", {}, ["lobby", "tasks"])
  const attached = useMemo(() => attachedFiles(chat), [chat])
  const edited = useMemo(() => editedFiles(activity, changes.data?.files ?? []), [activity, changes.data])
  const [chosen, setChosen] = useState<Section | null | undefined>(undefined)
  const total = attached.length + edited.length
  if (total === 0) return null
  // The edited files start open (the attached ones when nothing was edited); after that the user's choice holds (null: both folded).
  const open = chosen === undefined ? (edited.length > 0 ? "edited" : "attached") : chosen
  const toggle = (section: Section) => setChosen(open === section ? null : section)
  return (
    <aside className="cs-tw cs-sf" aria-label="Files in this session">
      <h2 className="cs-twl">
        Files
        <b>{total}</b>
      </h2>
      <ul className="cs-twx" data-scroll-hints>
        {edited.length > 0 ? (
          <Fold label="Changed by agents" count={edited.length} open={open === "edited"} onToggle={() => toggle("edited")}>
            {edited.map((file) => <EditedRow key={file.name} file={file} />)}
          </Fold>
        ) : null}
        {attached.length > 0 ? (
          <Fold label="Attached by you" count={attached.length} open={open === "attached"} onToggle={() => toggle("attached")}>
            {attached.map((file) => <AttachedRow key={file.id} file={file} />)}
          </Fold>
        ) : null}
      </ul>
    </aside>
  )
}
