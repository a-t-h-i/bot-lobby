/**
 * One issue's detail: Plan it (a planning session seeded with the issue), its
 * facts, the body as GitHub Markdown and its comments. The `issues` topic
 * rereads it.
 */
import { Workflow } from "lucide-react"
import type { IssueDetailInfo } from "@protocol"
import { go, tabHash } from "@/app/router"
import { act } from "@/lib/act"
import { ActionBar } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Spinner } from "@/components/ui/spinner"
import { useApiRead } from "@/app/useApiRead"
import { formatSince } from "@/lib/format"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { ACTION_LINE, DETAIL_TITLE, NO_DESCRIPTION, factsLine } from "./words"

type Comment = IssueDetailInfo["comments"][number]

function Header({ issue, now }: { issue: IssueDetailInfo; now: number }) {
  return (
    <header className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight break-words">
        <span className="font-normal text-muted-foreground tabular-nums">#{issue.number}</span> {issue.title}
      </h2>
      <p className="text-sm text-muted-foreground">{factsLine(issue, now)}</p>
      {issue.url ? (
        <a href={issue.url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs break-all text-primary underline underline-offset-4">
          {issue.url}
        </a>
      ) : null}
    </header>
  )
}

function Comment({ comment, now }: { comment: Comment; now: number }) {
  return (
    <article className="card-raised flex flex-col gap-1.5 rounded-lg border px-3.5 py-2.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{comment.author ?? "comment"}</span>
        {comment.createdAt ? <span>{formatSince(now - Date.parse(comment.createdAt))}</span> : null}
      </div>
      <Markdown text={comment.body.trim()} />
    </article>
  )
}

function Comments({ comments, now }: { comments: Comment[]; now: number }) {
  if (comments.length === 0) return null
  return (
    <Section title="Comments" right={String(comments.length)}>
      <div className="flex flex-col gap-3">
        {comments.map((comment, index) => (
          <Comment key={index} comment={comment} now={now} />
        ))}
      </div>
    </Section>
  )
}

/** Plan it: a new planning session that starts from the issue, on the Plan tab. */
function PlanIt({ issue }: { issue: IssueDetailInfo }) {
  const plan = async () => {
    const seed = { issue: { number: issue.number, title: issue.title, ...(issue.url ? { url: issue.url } : {}) }, body: issue.body }
    if (await act("planner.new", { seed })) go(tabHash("plan"))
  }
  return (
    <ConfirmButton
      icon={Workflow}
      label={`Plan #${issue.number} with the panel`}
      text="Plan it"
      shortcut="N"
      title={`Plan #${issue.number} with the panel?`}
      description="A new planning session starts from this issue. A plan already under way waits under Plan → Previous."
      confirmLabel="Plan it"
      onConfirm={() => void plan()}
    />
  )
}

export function IssueDetail({ number }: { number: number }) {
  const read = useApiRead("issues.get", { number }, ["issues"])
  const now = Date.now()
  if (!read.data) {
    if (read.error) return <p className="text-sm text-muted-foreground">Could not load #{number}. {read.error}</p>
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        loading #{number}…
      </p>
    )
  }
  const issue = read.data.issue
  return (
    <article className="flex flex-col gap-4" aria-label={`${DETAIL_TITLE} #${number}`}>
      <ActionBar>
        <PlanIt issue={issue} />
      </ActionBar>
      <Header issue={issue} now={now} />
      <p className="text-xs text-muted-foreground">{ACTION_LINE}</p>
      <Section title="Description">
        {issue.body.trim() ? <Markdown text={issue.body.trim()} /> : <p className="text-sm text-muted-foreground">{NO_DESCRIPTION}</p>}
      </Section>
      <Comments comments={issue.comments} now={now} />
    </article>
  )
}
