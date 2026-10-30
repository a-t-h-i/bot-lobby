/**
 * One note in the slide-over: who keeps it and in which file, Edit (E),
 * Comment (C), Add after (A) and Delete in the top row; the note large, its
 * tags, the comments left on it (each can be taken back), where it sits in
 * the file, and Move to (another agent's file: added there, then removed
 * here). Edit file (F) opens the whole file.
 */
import { useState, type CSSProperties } from "react"
import { FilePen, MessageSquarePlus, Pencil, Plus, Trash2, Undo2 } from "lucide-react"
import type { KnowledgeViewData } from "@protocol"
import { act } from "@/lib/act"
import { ActionBar, ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { FileEditor } from "./Editors"
import { NoteEditor, NoteText } from "./NoteCard"
import { AGENT_COLORS, initial, type Note } from "./notes"
import { AGENT_LABELS, AGENT_ORDER, entryRef, overWarning, type KnowledgeAgentName } from "./words"

type Draft = "edit" | "comment" | "add"

interface Props {
  note: Note
  view?: KnowledgeViewData
  onTag: (tag: string) => void
  onMove: (agent: KnowledgeAgentName) => void
  onDelete: () => void
  onChanged: () => void
}

export function NoteHead({ note }: { note: Note }) {
  return (
    <div className="cs-knwh" style={{ "--c": AGENT_COLORS[note.agent] } as CSSProperties}>
      <span className="cs-kat" aria-hidden="true">{initial(note.agent)}</span>
      <span><b>{AGENT_LABELS[note.agent]}</b> · {note.file}</span>
    </div>
  )
}

export function NoteSheet({ note, view, onTag, onMove, onDelete, onChanged }: Props) {
  const [draft, setDraft] = useState<Draft>()
  const [fileOpen, setFileOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { agent, file } = note
  const ref = entryRef(note.entry)
  const run = async (write: () => Promise<unknown>) => {
    setBusy(true)
    const done = (await write()) !== undefined
    setBusy(false)
    if (done) onChanged()
    return done
  }
  const save = (text: string) => {
    if (draft === "edit") return run(() => act("knowledge.edit", { agent, file, ref, text }))
    if (draft === "comment") return run(() => act("knowledge.comment", { agent, file, ref, text }))
    return run(() => act("knowledge.add", { agent, file, ref, text }))
  }
  const off = Boolean(draft) || busy
  return (
    <article aria-label={`${AGENT_LABELS[agent]} note`}>
      <ActionBar className="cs-abm">
        <ActionButton iconOnly side="bottom" className="cs-ibk" label="Edit the note" icon={Pencil} shortcut="E" disabled={off} onClick={() => setDraft("edit")} />
        <ActionButton iconOnly side="bottom" className="cs-ibk" label="Comment on the note" icon={MessageSquarePlus} shortcut="C" disabled={off} onClick={() => setDraft("comment")} />
        <ActionButton iconOnly side="bottom" className="cs-ibk" label="Add a note after it" icon={Plus} shortcut="A" disabled={off} onClick={() => setDraft("add")} />
        <ActionButton iconOnly side="bottom" className="cs-ibk" label="Edit the whole file" icon={FilePen} shortcut="F" disabled={off || !view} onClick={() => setFileOpen(true)} />
        <ConfirmButton iconOnly side="bottom" className="cs-ibk" icon={Trash2} label="Delete the note" shortcut="Delete" title="Delete this note?" description="The note and its comments are removed. The version before is archived." confirmLabel="Delete note" variant="destructive" disabled={off} onConfirm={onDelete} />
      </ActionBar>
      {draft === "edit" ? (
        <NoteEditor initial={note.entry.text} label="Edit note" action="Save" onSave={save} onCancel={() => setDraft(undefined)} />
      ) : (
        <NoteText className="cs-knwt" text={note.text} />
      )}
      {note.tags.length ? (
        <div className="cs-knwtg">
          {note.tags.map((tag) => <button key={tag} type="button" className="cs-ktg" onClick={() => onTag(tag)}>#{tag}</button>)}
        </div>
      ) : null}
      {draft === "comment" || draft === "add" ? (
        <div className="mt-4">
          <NoteEditor initial="" label={draft === "comment" ? "Comment on this note" : "Add a note after it"} action={draft === "comment" ? "Add comment" : "Add note"} placeholder={draft === "comment" ? "Your comment" : `What should ${AGENT_LABELS[agent]} keep in mind?`} onSave={save} onCancel={() => setDraft(undefined)} />
        </div>
      ) : null}
      <h3 className="cs-kwh">Comments <span>{note.comments.length || "none yet"}</span></h3>
      {note.comments.length ? (
        <ul className="cs-kwu">
          {note.comments.map((comment) => (
            <li key={comment.id}>
              <span title={comment.text}>{comment.text}</span>
              <button type="button" className="cs-knb cs-tip cs-b" data-tip="Take it back" aria-label="Take the comment back" disabled={busy} onClick={() => void run(() => act("knowledge.unnote", { id: comment.id }))}><Undo2 aria-hidden="true" className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      ) : <p className="cs-hd2 m-0">Comment on a note to tell the agent what to change; it reads comments with the note.</p>}
      <h3 className="cs-kwh">Where it lives</h3>
      <p className="m-0 text-[13px] text-muted-foreground">{AGENT_LABELS[agent]}'s {file}{view ? ` · ${view.entries.length} entries` : ""}</p>
      {view?.over ? <p className="cs-kagw">{overWarning(file)}</p> : null}
      <h3 className="cs-kwh">Move to</h3>
      <div className="cs-kwmv">
        {AGENT_ORDER.map((other) => (
          <button key={other} type="button" className="cs-knb cs-tip cs-b" data-tip={other === agent ? `Kept by ${AGENT_LABELS[other]}` : `Move to ${AGENT_LABELS[other]}`} aria-label={other === agent ? `Kept by ${AGENT_LABELS[other]}` : `Move to ${AGENT_LABELS[other]}`} aria-pressed={other === agent} data-on={other === agent || undefined} disabled={busy || other === agent} style={{ "--c": AGENT_COLORS[other] } as CSSProperties} onClick={() => onMove(other)}>
            {initial(other)}
          </button>
        ))}
      </div>
      {view ? <FileEditor open={fileOpen} file={file} initial={view.content} busy={busy} onClose={() => setFileOpen(false)} onSave={(text) => { setFileOpen(false); void run(() => act("knowledge.replaceFile", { agent, file, text })) }} /> : null}
    </article>
  )
}
