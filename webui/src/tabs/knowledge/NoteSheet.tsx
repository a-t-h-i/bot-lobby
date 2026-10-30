/**
 * One note in the slide-over, after the design: who keeps it and in which
 * file with Pin, Edit, Comment and Delete as keycaps beside Close; the note
 * large, the comments left on it (each can be taken back), its tags, "Where
 * it came from" (who wrote it and each change, an edit restorable), "Used by
 * agents" (its agent's runs over the last two weeks and the tasks they were
 * for) and Move to (another agent's file, with its comments, pin and history).
 */
import { useState, type CSSProperties } from "react"
import { Check, MessageSquarePlus, Pencil, Pin, Trash2, Undo2 } from "lucide-react"
import type { KnowledgeViewData } from "@protocol"
import { act } from "@/lib/act"
import { useTaskTitles } from "@/lib/taskTitles"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { NoteEditor, NoteText } from "./NoteCard"
import { AGENT_COLORS, ago, initial, useBars, type Note } from "./notes"
import { AGENT_LABELS, AGENT_ORDER, entryRef, overWarning, type KnowledgeAgentName } from "./words"

interface HeadProps {
  note: Note
  onPin: () => void
  onEdit: () => void
  onComment: () => void
  onDelete: () => void
}

/** The sheet's top row: the note's agent and file, then its actions as keycaps (Close follows). */
export function NoteHead({ note, onPin, onEdit, onComment, onDelete }: HeadProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="cs-knwh min-w-0" style={{ "--c": AGENT_COLORS[note.agent] } as CSSProperties}>
        <span className="cs-kat" aria-hidden="true">{initial(note.agent)}</span>
        <span className="truncate"><b>{AGENT_LABELS[note.agent]}</b> · {note.file}</span>
      </div>
      <div className="cs-knwhx">
        <button type="button" className="cs-kc cs-sm cs-ib cs-tip cs-b" data-tip={note.pinned ? "Unpin" : "Pin to the top"} aria-label={note.pinned ? "Unpin" : "Pin to the top"} aria-pressed={note.pinned} data-on={note.pinned || undefined} onClick={onPin}><Pin aria-hidden="true" className="size-3.5" /></button>
        <button type="button" className="cs-kc cs-sm cs-ib cs-tip cs-b" data-tip="Edit" aria-label="Edit the note" onClick={onEdit}><Pencil aria-hidden="true" className="size-3.5" /></button>
        <button type="button" className="cs-kc cs-sm cs-ib cs-tip cs-b" data-tip="Comment" aria-label="Comment on the note" onClick={onComment}><MessageSquarePlus aria-hidden="true" className="size-3.5" /></button>
        <ConfirmButton iconOnly side="bottom" className="cs-kc cs-sm cs-ib" icon={Trash2} label="Delete the note" title="Delete this note?" description="The note and its comments are removed. The version before is archived." confirmLabel="Delete note" variant="destructive" onConfirm={onDelete} />
      </div>
    </div>
  )
}

interface Props {
  note: Note
  view?: KnowledgeViewData
  commenting: boolean
  onCommenting: (on: boolean) => void
  onTag: (tag: string) => void
  onMove: (agent: KnowledgeAgentName) => void
  onChanged: () => void
}

/** Who did a history line: you, or the agent named. */
function whoOf(by: string): { name: string; letter: string; color: string } {
  if (by === "you") return { name: "You", letter: "Y", color: "var(--c-orc)" }
  const agent = AGENT_ORDER.find((one) => AGENT_LABELS[one].toLowerCase().startsWith(by.toLowerCase()) || (one === "master" && /oracle|master/i.test(by)))
  return { name: by, letter: by.charAt(0).toUpperCase(), color: agent ? AGENT_COLORS[agent] : "var(--muted-foreground)" }
}

export function NoteSheet({ note, view, commenting, onCommenting, onTag, onMove, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const titles = useTaskTitles()
  const { agent, file } = note
  const ref = entryRef(note.entry)
  const run = async (write: () => Promise<unknown>) => {
    setBusy(true)
    const done = (await write()) !== undefined
    setBusy(false)
    if (done) onChanged()
    return done
  }
  const bars = useBars(note.uses)
  // The tasks its agent's runs were for, newest first, once each.
  const tasks = [...new Map(note.uses.filter((use) => use.taskId).map((use) => [use.taskId!, use.at])).entries()].slice(0, 5)
  return (
    <article aria-label={`${AGENT_LABELS[agent]} note`}>
      <NoteText className="cs-knwt" text={note.text} />
      {note.comments.length ? (
        <ul className="cs-kwu mt-2.5">
          {note.comments.map((comment) => (
            <li key={comment.id}>
              <span title={comment.text}>{comment.text}</span>
              <button type="button" className="cs-knb cs-tip cs-b" data-tip="Take it back" aria-label="Take the comment back" disabled={busy} onClick={() => void run(() => act("knowledge.unnote", { id: comment.id }))}><Undo2 aria-hidden="true" className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {commenting ? (
        <div className="mt-3">
          <NoteEditor initial="" label="Comment on this note" action="Add comment" placeholder="Tell the agent what to change; it reads comments with the note" onSave={(text) => run(() => act("knowledge.comment", { agent, file, ref, text }))} onCancel={() => onCommenting(false)} />
        </div>
      ) : null}
      {note.tags.length ? (
        <div className="cs-knwtg">
          {note.tags.map((tag) => <button key={tag} type="button" className="cs-ktg" onClick={() => onTag(tag)}>#{tag}</button>)}
        </div>
      ) : null}
      <h3 className="cs-kwh">Where it came from</h3>
      {note.history.length ? (
        <ul className="cs-kwtl">
          {note.history.map((event) => {
            const who = whoOf(event.by)
            return (
              <li key={event.id} className="cs-kwi" style={{ "--c": who.color } as CSSProperties}>
                <span className="cs-kat" aria-hidden="true">{who.letter}</span>
                <div className="cs-tx"><b>{who.name}</b>{event.what}<em>{ago(event.at)}</em></div>
                {event.before ? (
                  <button type="button" className="cs-knb cs-tip cs-b" data-tip="Restore this version" aria-label={`Restore the version before: ${event.before}`} disabled={busy} onClick={() => void run(() => act("knowledge.restore", { agent, file, ref, event: event.id }))}><Undo2 aria-hidden="true" className="size-3.5" /></button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : <p className="cs-hd2 m-0">It was in {AGENT_LABELS[agent]}'s {file} before its history was kept.</p>}
      {view?.over ? <p className="cs-kagw">{overWarning(file)}</p> : null}
      <h3 className="cs-kwh">Used by agents<span>{note.uses.length ? `${note.uses.length} ${note.uses.length === 1 ? "use" : "uses"} in 30 days` : "never"}</span></h3>
      <div className="cs-kwb" aria-hidden="true">
        {bars.map((height, index) => <i key={index} data-z={height === 0 || undefined} style={{ height: `${height || 8}%` }} />)}
      </div>
      {tasks.length ? (
        <ul className="cs-kwu mt-3">
          {tasks.map(([id, at]) => <li key={id}><Check aria-hidden="true" className="size-3.5" /><span>{titles[id] ?? `Task ${id}`}</span><i>{ago(at)}</i></li>)}
        </ul>
      ) : note.uses.length === 0 ? <p className="cs-hd2 m-0 mt-2">No agent has used this note yet.</p> : null}
      <h3 className="cs-kwh">Move to</h3>
      <div className="cs-kwmv">
        {AGENT_ORDER.map((other) => (
          <button key={other} type="button" className="cs-knb cs-tip cs-b" data-tip={other === agent ? `Kept by ${AGENT_LABELS[other]}` : `Move to ${AGENT_LABELS[other]}`} aria-label={other === agent ? `Kept by ${AGENT_LABELS[other]}` : `Move to ${AGENT_LABELS[other]}`} aria-pressed={other === agent} data-on={other === agent || undefined} disabled={busy || other === agent} style={{ "--c": AGENT_COLORS[other] } as CSSProperties} onClick={() => onMove(other)}>
            {initial(other)}
          </button>
        ))}
      </div>
    </article>
  )
}
