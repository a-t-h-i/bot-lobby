/**
 * A task's plan comments: each as a flat row with its text as Markdown (and
 * any files it carries) and where it stands. New ones are written in the
 * floating box below, with its Comment target picked.
 */
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineEditor } from "@/ui/InlineEditor"
import { call } from "@/lib/api"
import { useTopic } from "@/app/hooks"
import { CheckCircle2, Circle, CircleDot } from "lucide-react"
import type { PlanComment, StatusInfo } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { formatSince } from "@/lib/format"
import { Markdown } from "@/ui/Markdown"
import { Rule } from "@/ui/Frame"

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
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className={comment.status === "addressed" ? "size-3.5 text-success" : "size-3.5"} />
        {COMMENT_WORDS[comment.status]}, {age}{comment.editedAt ? " (edited)" : ""}
      </p>
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
  return <li className="border-b border-border px-4 py-3">
    {editing ? <InlineEditor text={current.text} onSave={save} onCancel={() => setEditing(false)} /> : <Markdown text={current.text} />}
    <div className="flex items-center justify-between gap-2"><CommentMeta comment={current} />
      {own && !editing ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button> : null}
    </div>
  </li>
}

export function Comments({ taskId, finished, canComment }: { taskId: string; finished: boolean; canComment: boolean }) {
  const read = useApiRead("tasks.comments", { taskId }, ["tasks"])
  const status = useTopic<StatusInfo>("status")
  const comments = read.data?.comments ?? []
  const open = comments.filter((comment) => comment.status !== "addressed").length
  return (
    <section aria-labelledby={`comments-${taskId}`} className="flex flex-col gap-3">
      <h3 id={`comments-${taskId}`} className="text-sm">
        <Rule title="Comments" right={open > 0 ? `${open} open` : undefined} />
      </h3>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {finished ? "No comments." : canComment ? "No comments yet. Comment on the plan in the box below (Markdown and images work); the oracle amends it." : "No comments yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {comments.map((comment) => (
            <CommentItem key={`${taskId}-${comment.id}`} taskId={taskId} comment={comment} own={Boolean(comment.by && comment.by === status.data?.sessionId)} />
          ))}
        </ul>
      )}
    </section>
  )
}
