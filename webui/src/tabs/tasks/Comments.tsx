/**
 * A task's plan comments: each as a sunk card with its text as Markdown (and
 * any files it carries) and where it stands. A new one is written in the field
 * under them (Enter adds it, Shift+Enter breaks the line, Esc cancels), or in
 * the floating box with its Comment target picked.
 */
import { useId, useState, type KeyboardEvent } from "react"
import { act } from "@/lib/act"
import { Button } from "@/components/ui/button"
import { InlineEditor } from "@/ui/InlineEditor"
import { call } from "@/lib/api"
import { useTopic } from "@/app/hooks"
import { CheckCircle2, Circle, CircleDot, MessageSquarePlus } from "lucide-react"
import type { PlanComment, StatusInfo } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { formatSince } from "@/lib/format"
import { Markdown } from "@/ui/Markdown"

const COMMENT_ICONS: Record<PlanComment["status"], typeof Circle> = { open: Circle, delivered: CircleDot, addressed: CheckCircle2 }
const COMMENT_WORDS: Record<PlanComment["status"], string> = {
  open: "waiting for the owning session",
  delivered: "sent to the oracle",
  addressed: "plan amended",
}

function CommentMeta({ comment }: { comment: PlanComment }) {
  const age = formatSince(Date.now() - Date.parse(comment.createdAt))
  const Icon = COMMENT_ICONS[comment.status]
  return (
      <>
        <Icon aria-hidden="true" className="size-3.5" />
        {COMMENT_WORDS[comment.status]}, {age}{comment.editedAt ? " (edited)" : ""}
      </>
  )
}

function CommentItem({ comment, taskId, own }: { comment: PlanComment; taskId: string; own: boolean }) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<PlanComment>()
  const current = saved && (saved.editedAt ?? "") > (comment.editedAt ?? "") ? saved : comment
  const save = async (text: string) => {
    const result = await call("tasks.editComment", { taskId, commentId: comment.id, text })
    setSaved(result.comment)
  }
  return <li className="cs-cmc">
    {editing ? <InlineEditor text={current.text} onSave={save} onCancel={() => setEditing(false)} /> : <Markdown text={current.text} />}
    <div className="cs-cmeta" data-s={current.status}><CommentMeta comment={current} />
      {own && !editing ? <button type="button" className="cs-eb" onClick={() => setEditing(true)}>Edit</button> : null}
    </div>
  </li>
}

/** The field for a new comment: Add comment opens it, Enter adds the comment, Esc cancels. */
function AddComment({ taskId, onAdded }: { taskId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const field = useId()
  if (!open) return <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}><MessageSquarePlus aria-hidden="true" />Add comment</Button>
  const add = async () => {
    if (busy || !text.trim()) return
    setBusy(true)
    const done = (await act("tasks.comment", { taskId, text: text.trim() })) !== undefined
    setBusy(false)
    if (!done) return
    setText("")
    setOpen(false)
    onAdded()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false) }
    else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void add() }
  }
  return <div>
    <label htmlFor={field} className="sr-only">Your comment</label>
    <textarea id={field} autoFocus className="cs-ta2" placeholder="Your comment" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
    <div className="cs-fa">
      <span className="cs-hint2">Enter adds the comment · Esc cancels</span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
      <Button size="sm" disabled={busy || !text.trim()} onClick={() => void add()}>Add comment</Button>
    </div>
  </div>
}

export function Comments({ taskId, finished, canComment }: { taskId: string; finished: boolean; canComment: boolean }) {
  const read = useApiRead("tasks.comments", { taskId }, ["tasks"])
  const status = useTopic<StatusInfo>("status")
  const comments = read.data?.comments ?? []
  const open = comments.filter((comment) => comment.status !== "addressed").length
  return (
    <section aria-labelledby={`comments-${taskId}`} className="cs-sec flex flex-col gap-3">
      <h3 id={`comments-${taskId}`} className="cs-rl">
        Comments{open > 0 ? <span className="cs-rr">{open} open</span> : null}
      </h3>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {finished ? "No comments." : canComment ? "No comments yet. Comment on the plan here or in the box below (Markdown and images work there); the oracle amends it." : "No comments yet."}
        </p>
      ) : (
        <ul className="cs-cm">
          {comments.map((comment) => (
            <CommentItem key={`${taskId}-${comment.id}`} taskId={taskId} comment={comment} own={Boolean(comment.by && comment.by === status.data?.sessionId)} />
          ))}
        </ul>
      )}
      {canComment ? <AddComment taskId={taskId} onAdded={read.reload} /> : null}
    </section>
  )
}
