/**
 * A task's plan comments: each as a soft card with its text as Markdown (and
 * any files it carries) and where it stands. New ones are written in the
 * floating box below, with its Comment target picked.
 */
import { CheckCircle2, Circle, CircleDot } from "lucide-react"
import type { PlanComment } from "@protocol"
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

function CommentItem({ comment }: { comment: PlanComment }) {
  const age = formatSince(Date.now() - Date.parse(comment.createdAt))
  const Icon = COMMENT_ICONS[comment.status]
  return (
    <li className="rounded-2xl border border-border bg-card/50 px-4 py-3">
      <Markdown text={comment.text} />
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className={comment.status === "addressed" ? "size-3.5 text-success" : "size-3.5"} />
        {COMMENT_WORDS[comment.status]}, {age}
      </p>
    </li>
  )
}

export function Comments({ taskId, finished, canComment }: { taskId: string; finished: boolean; canComment: boolean }) {
  const read = useApiRead("tasks.comments", { taskId }, ["tasks"])
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
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </ul>
      )}
    </section>
  )
}
