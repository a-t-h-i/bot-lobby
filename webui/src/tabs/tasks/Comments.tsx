/**
 * A task's plan comments (the terminal's `Comments` section): each with its
 * mark, its text as Markdown and where it stands, plus a box to add one.
 * Wording is `tasks.ts`'s `COMMENT_WORDS`.
 */
import type { PlanComment } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { act } from "@/lib/act"
import { formatSince } from "@/lib/format"
import { NoteForm } from "@/ui/NoteForm"
import { Markdown } from "@/ui/Markdown"
import { Rule } from "@/ui/Frame"

const COMMENT_MARKS: Record<PlanComment["status"], string> = { open: "○", delivered: "◐", addressed: "✓" }
const COMMENT_WORDS: Record<PlanComment["status"], string> = {
  open: "waiting for the owning session",
  delivered: "sent to the oracle",
  addressed: "plan amended",
}

function CommentItem({ comment }: { comment: PlanComment }) {
  const age = formatSince(Date.now() - Date.parse(comment.createdAt))
  return (
    <li className="flex gap-2">
      <span className="shrink-0 text-foreground" aria-hidden="true">
        {COMMENT_MARKS[comment.status]}
      </span>
      <div className="min-w-0 flex-1">
        <Markdown text={comment.text} />
        <p className="text-xs text-muted-foreground">
          — {COMMENT_WORDS[comment.status]}, {age}
        </p>
      </div>
    </li>
  )
}

export function Comments({ taskId, finished, canComment }: { taskId: string; finished: boolean; canComment: boolean }) {
  const read = useApiRead("tasks.comments", { taskId }, ["tasks"])
  const comments = read.data?.comments ?? []
  const open = comments.filter((comment) => comment.status !== "addressed").length
  const send = async (text: string) => {
    const result = await act("tasks.comment", { taskId, text })
    read.reload()
    return result !== undefined
  }
  return (
    <section aria-labelledby={`comments-${taskId}`} className="flex flex-col gap-3">
      <h3 id={`comments-${taskId}`} className="text-sm">
        <Rule title="Comments" right={open > 0 ? `${open} open` : undefined} />
      </h3>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {finished ? "No comments." : "No comments yet — comment on the plan below; the oracle amends it."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </ul>
      )}
      {canComment ? <NoteForm label="Comment on the plan" buttonLabel="Add comment" onSend={send} /> : null}
    </section>
  )
}
