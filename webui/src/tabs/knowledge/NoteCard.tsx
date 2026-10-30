/**
 * A note card: who keeps it (a tile and the agent's name in its colour) and
 * in which file, the note itself (a click opens it in the slide-over), the
 * comments left on it, then its tags and where it sits. Pointing at it shows
 * a grip to drag it onto another agent, Edit and Delete; Edit turns the card
 * into a box in place (Enter saves, Shift+Enter breaks the line, Esc cancels).
 */
import { useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react"
import { FileText, GripVertical, MessageSquare, Pencil, Trash2 } from "lucide-react"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { AGENT_COLORS, initial, type Note } from "./notes"
import { AGENT_LABELS, ARCHIVE_HINT } from "./words"

/** The note's text with `code` spans drawn as code. */
export function NoteText({ text, className, onClick }: { text: string; className: string; onClick?: () => void }) {
  const parts = text.split(/(`[^`]+`)/g).filter(Boolean)
  return (
    <p className={className} onClick={onClick}>
      {parts.map((part, index) => (part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <span key={index} className="cs-cod">{part.slice(1, -1)}</span> : <span key={index}>{part}</span>))}
    </p>
  )
}

/** Writing a note in place: the box, the archive hint, Cancel and the main action. */
export function NoteEditor({ initial: start, label, action, placeholder, onSave, onCancel }: { initial: string; label: string; action: string; placeholder?: string; onSave: (text: string) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(start)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (busy || !text.trim()) return
    setBusy(true)
    const done = await onSave(text.trim())
    setBusy(false)
    if (done) onCancel()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel() }
    else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void save() }
  }
  return (
    <div>
      <textarea autoFocus aria-label={label} className="cs-knta" value={text} placeholder={placeholder} disabled={busy} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
      <div className="cs-knea">
        <span className="cs-h2">{ARCHIVE_HINT}</span>
        <button type="button" className="cs-kc cs-sm" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="cs-kc cs-sm cs-pri" onClick={() => void save()} disabled={busy || !text.trim()}>{action}</button>
      </div>
    </div>
  )
}

interface NoteCardProps {
  note: Note
  selected: boolean
  dragging: boolean
  activeTags: string[]
  onOpen: () => void
  onTag: (tag: string) => void
  onDragStart: () => void
  onDragEnd: () => void
  onSave: (text: string) => Promise<boolean>
  onDelete: () => void
}

export function NoteCard({ note, selected, dragging, activeTags, onOpen, onTag, onDragStart, onDragEnd, onSave, onDelete }: NoteCardProps) {
  const [editing, setEditing] = useState(false)
  const color = AGENT_COLORS[note.agent]
  const drag = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", note.key)
    onDragStart()
  }
  return (
    <article className="cs-knc" data-sel={selected || undefined} data-drag={dragging || undefined} draggable={!editing} onDragStart={drag} onDragEnd={onDragEnd} aria-label={`${AGENT_LABELS[note.agent]}: ${note.text}`}>
      <div className="cs-knch" style={{ "--c": color } as CSSProperties}>
        <span className="cs-knd" aria-hidden="true"><GripVertical className="size-3.5" /></span>
        <span className="cs-kat" aria-hidden="true">{initial(note.agent)}</span>
        <b>{AGENT_LABELS[note.agent]}</b>
        <span className="cs-fl">· {note.file}</span>
        <div className="cs-kna">
          <button type="button" className="cs-knb cs-h cs-tip cs-b" data-tip="Edit" aria-label="Edit the note" onClick={() => setEditing(true)}><Pencil className="size-3.5" aria-hidden="true" /></button>
          <ConfirmButton iconOnly className="cs-knb cs-h cs-dg" icon={Trash2} label="Delete the note" title="Delete this note?" description="The note and its comments are removed. The version before is archived." confirmLabel="Delete note" variant="destructive" onConfirm={onDelete} />
        </div>
      </div>
      {editing ? (
        <NoteEditor initial={note.entry.text} label="Edit note" action="Save" onSave={onSave} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <NoteText className="cs-knx" text={note.text} onClick={onOpen} />
          {note.comments.map((comment) => (
            <p key={comment.id} className="cs-knn"><MessageSquare aria-hidden="true" className="size-3.5" /><span>{comment.text}</span></p>
          ))}
          <div className="cs-knf3">
            {note.tags.length ? (
              <div className="cs-tg">
                {note.tags.map((tag) => <button key={tag} type="button" className="cs-ktg" data-on={activeTags.includes(tag) || undefined} onClick={() => onTag(tag)}>#{tag}</button>)}
              </div>
            ) : null}
            <div className="cs-pv">
              <button type="button" className="cs-src" onClick={onOpen}><FileText aria-hidden="true" className="size-3.5 flex-none" /><span>{AGENT_LABELS[note.agent]} · {note.file}</span></button>
              {note.comments.length ? <span className="cs-use">{note.comments.length} {note.comments.length === 1 ? "comment" : "comments"}</span> : null}
            </div>
          </div>
        </>
      )}
    </article>
  )
}
