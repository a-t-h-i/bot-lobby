/**
 * One pull request's detail: its facts, the actions line, Jev's
 * read, our review (status, steps, verdict and findings) with the focus input
 * and its buttons, the changed files in a scrolling box, the description and
 * the discussion. The `git` topic rereads all of it, so a running review's
 * steps arrive as they happen.
 */
import { useEffect, useState } from "react"
import type { PullDetailInfo, PullFileInfo, PullNoteInfo, PullReadInfo, PullReviewInfo } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { BookOpen, CircleStop, Play } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { act } from "@/lib/act"
import { formatSince } from "@/lib/format"
import { ActionBar, ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { ACTIONS_LINE, FOCUS_HINT, FOCUS_LABEL, JEV_FAILED, NO_DESCRIPTION, NOT_POSTED, READING, STALE, branchLine, changeSize, factsLine, readNote, reviewNote, stateLine } from "./words"

/** The clock for a running review's elapsed time; ticks only while one runs. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return active ? now : Date.now()
}

function Header({ pull, now }: { pull: PullDetailInfo; now: number }) {
  return (
    <header className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold tracking-tight break-words">
        <span className="font-normal text-muted-foreground tabular-nums">#{pull.number}</span> {pull.title}
      </h2>
      <p className="text-sm text-muted-foreground">{factsLine(pull, now)}</p>
      <p className="text-sm tabular-nums">{branchLine(pull)}</p>
      {stateLine(pull) ? <p className="text-sm text-muted-foreground">{stateLine(pull)}</p> : null}
      {pull.url ? (
        <a href={pull.url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs break-all text-primary underline underline-offset-4">
          {pull.url}
        </a>
      ) : null}
    </header>
  )
}

function JevReadLine({ read }: { read: PullReadInfo }) {
  return (
    <Section title="Jev's read" right={readNote(read)}>
      {read.status === "running" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3.5" />
          {READING}
        </p>
      ) : null}
      {read.status === "failed" ? <p className="text-sm text-foreground">{read.error ?? JEV_FAILED}</p> : null}
      {read.status === "done" && read.line ? <Markdown text={read.line} /> : null}
    </Section>
  )
}

function ReviewBody({ review, now }: { review: PullReviewInfo; now: number }) {
  return (
    <>
      {review.model ? <p className="text-xs text-muted-foreground">{[review.model, review.thinking].filter(Boolean).join(" · ")}</p> : null}
      {review.focus ? <p className="text-sm text-muted-foreground">focus: {review.focus}</p> : null}
      {review.saved ? <p className="text-xs text-muted-foreground">kept from {formatSince(now - review.startedAt)}</p> : null}
      {review.stale ? <p className="text-sm text-foreground">{STALE}</p> : null}
      {review.status === "running" ? <ReviewSteps steps={review.steps} /> : null}
      {review.status === "cancelled" ? <p className="text-sm text-muted-foreground">stopped</p> : null}
      {review.status === "failed" || review.status === "timeout" ? <p className="text-sm text-destructive">✗ {review.error ?? review.status}</p> : null}
      {review.text ? <Markdown text={review.text} /> : null}
    </>
  )
}

function ReviewSteps({ steps }: { steps: string[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
      {steps.slice(-6).map((step, index) => (
        <li key={index} className="break-words">
          · {step}
        </li>
      ))}
    </ul>
  )
}

/** The optional focus for the next review: what it should look at most. */
function FocusInput({ number, focus, onChange }: { number: number; focus: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`focus-${number}`} className="text-[0.8125rem] font-medium text-foreground">
        {FOCUS_LABEL}
      </label>
      <Textarea id={`focus-${number}`} value={focus} rows={2} maxLength={2000} onChange={(event) => onChange(event.target.value)} />
      <p className="text-xs text-muted-foreground">{FOCUS_HINT}</p>
    </div>
  )
}

function ReviewBox({ number, review, now, focus, onFocus }: { number: number; review?: PullReviewInfo; now: number; focus: string; onFocus: (value: string) => void }) {
  return (
    <Section title="Review" right={review ? reviewNote(review, now) : undefined}>
      {review ? <ReviewBody review={review} now={now} /> : null}
      <FocusInput number={number} focus={focus} onChange={onFocus} />
      <p className="text-xs text-muted-foreground">A read-only agent reviews it — {NOT_POSTED}.</p>
    </Section>
  )
}

function Files({ files }: { files: PullFileInfo[] }) {
  return (
    <Section title="Files" right={String(files.length)}>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm tabular-nums">
          <tbody>
            {files.map((file) => (
              <tr key={file.path} className="border-b last:border-0">
                <td className="max-w-0 px-3 py-1.5 break-all">{file.path}</td>
                <td className="px-3 py-1.5 text-right text-xs whitespace-nowrap text-muted-foreground">{changeSize(file.additions, file.deletions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function Note({ note, now }: { note: PullNoteInfo; now: number }) {
  const state = note.state && note.state !== "COMMENTED" ? note.state.toLowerCase().replace(/_/g, " ") : ""
  const right = [state, note.at ? formatSince(now - Date.parse(note.at)) : ""].filter(Boolean).join(" · ")
  return (
    <article className="card-raised flex flex-col gap-1.5 rounded-lg border px-3.5 py-2.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{note.author ?? "comment"}</span>
        {right ? <span>{right}</span> : null}
      </div>
      {note.body.trim() ? <Markdown text={note.body.trim()} /> : null}
    </article>
  )
}

function Notes({ notes, now }: { notes: PullNoteInfo[]; now: number }) {
  if (notes.length === 0) return null
  return (
    <Section title="Discussion" right={String(notes.length)}>
      <div className="flex flex-col gap-3">
        {notes.map((note, index) => (
          <Note key={index} note={note} now={now} />
        ))}
      </div>
    </Section>
  )
}

function Loading({ number, error }: { number: number; error?: string }) {
  if (error) return <p className="text-sm text-muted-foreground">Could not load #{number}. {error}</p>
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-3.5" />
      loading #{number}…
    </p>
  )
}

export function PullDetail({ number, onChanged }: { number: number; onChanged?: () => void }) {
  const read = useApiRead("git.pull", { number }, ["git"])
  const [focus, setFocus] = useState("")
  const running = read.data?.review?.status === "running"
  const now = useNow(running)
  if (!read.data) return <Loading number={number} error={read.error} />
  const { pull, review, read: jev } = read.data
  const refresh = () => {
    read.reload()
    onChanged?.()
  }
  const start = async () => {
    const text = focus.trim()
    setFocus("")
    await act("git.review", { number, ...(text ? { focus: text } : {}) })
    refresh()
  }
  const readIt = async () => {
    await act("git.jev", { number })
    refresh()
  }
  const stop = async () => {
    await act("git.cancelReview", { number })
    refresh()
  }
  return (
    <article className="flex flex-col gap-4" aria-label={`Pull request #${number}`}>
      <ActionBar>
        <ActionButton label="Review" icon={Play} tone="primary" shortcut="V" disabled={running} onClick={() => void start()} />
        <ActionButton label="Jev's read" icon={BookOpen} shortcut="Q" disabled={running} onClick={() => void readIt()} />
        {running ? (
          <ConfirmButton
            icon={CircleStop}
            label="Stop the review"
            text="Stop"
            shortcut="X"
            title="Stop this review?"
            description="The agent stops reading the pull request. Nothing is posted to GitHub."
            confirmLabel="Stop review"
            variant="destructive"
            onConfirm={() => void stop()}
          />
        ) : null}
      </ActionBar>
      <Header pull={pull} now={now} />
      <p className="text-xs text-muted-foreground">{ACTIONS_LINE}</p>
      {jev ? <JevReadLine read={jev} /> : null}
      <ReviewBox number={number} review={review} now={now} focus={focus} onFocus={setFocus} />
      {pull.files.length > 0 ? <Files files={pull.files} /> : null}
      <Section title="Description">
        {pull.body.trim() ? <Markdown text={pull.body.trim()} /> : <p className="text-sm text-muted-foreground">{NO_DESCRIPTION}</p>}
      </Section>
      <Notes notes={pull.notes} now={now} />
    </article>
  )
}
