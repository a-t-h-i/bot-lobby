/**
 * The questionnaire slideout (batch-1 §d): docked directly above the composer
 * on every tab, never modal. One question at a time, `1 of N` across the
 * queue; `Esc` minimises it to a chip above the composer and keeps every
 * answer; `Cancel` asks before leaving. A late answer (the terminal won the
 * race) surfaces the shared "already answered in the terminal" notice.
 */
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ANSWERED_IN_TERMINAL } from "@shared"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { WebPrompt } from "@protocol"
import { QuestionCard } from "./QuestionCard"
import { parsePrompt, promptSummary } from "./payload"

interface PromptSlideoutProps {
  prompts: WebPrompt[]
  answer: (id: string, value: unknown) => Promise<void>
  dismiss: (id: string) => Promise<void>
}

function QueueTitle({ prompt, index, total }: { prompt: WebPrompt; index: number; total: number }) {
  const who = prompt.from ? `${prompt.from} asks · ` : ""
  return (
    <p className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
      {who}
      {total > 1 ? `${index + 1} of ${total}` : "Question"}
    </p>
  )
}

function LeavePrompt({ submitting, onKeep, onLeave }: { submitting: boolean; onKeep: () => void; onLeave: () => void }) {
  return (
    <div className="flex flex-col gap-3" role="alert">
      <p className="text-sm">Leave without answering? The oracle will not guess for you.</p>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="lg" className="h-11" onClick={onKeep}>
          Keep answering
        </Button>
        <Button type="button" size="lg" className="h-11" disabled={submitting} onClick={onLeave}>
          {submitting ? "Leaving…" : "Leave"}
        </Button>
      </div>
    </div>
  )
}

export function PromptSlideout({ prompts, answer, dismiss }: PromptSlideoutProps) {
  const [index, setIndex] = useState(0)
  const [minimized, setMinimized] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const count = prompts.length
  const at = Math.min(index, Math.max(0, count - 1))
  const active = prompts[at]
  const view = active ? parsePrompt(active) : undefined

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, count - 1)))
  }, [count])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || count === 0) return
      if (leaving) setLeaving(false)
      else setMinimized(true)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [count, leaving])

  if (!active) return null

  async function settle(action: Promise<void>, failure: string): Promise<void> {
    setSubmitting(true)
    try {
      await action
      setLeaving(false)
    } catch (error) {
      if (error instanceof ApiError && error.code === "question_withdrawn") toast(ANSWERED_IN_TERMINAL)
      else toast(error instanceof Error ? error.message : failure)
    } finally {
      setSubmitting(false)
    }
  }

  const identified = active as WebPrompt
  return (
    <>
      <section
        aria-label="Question from the lobby"
        className={cn("shrink-0 border-t bg-background", minimized && "hidden")}
      >
        <div className="flex max-h-[50svh] flex-col gap-3 overflow-y-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <QueueTitle prompt={identified} index={at} total={count} />
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setMinimized(true)}>
              Minimise
            </Button>
          </div>
          {view ? (
            leaving ? (
              <LeavePrompt
                submitting={submitting}
                onKeep={() => setLeaving(false)}
                onLeave={() => void settle(dismiss(identified.id), "Could not leave the question")}
              />
            ) : (
              <QuestionCard
                key={identified.id}
                view={view}
                submitting={submitting}
                onAnswer={(value) => void settle(answer(identified.id, value), "Could not send the answer")}
                onCancel={() => setLeaving(true)}
              />
            )
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">This question cannot be shown here.</p>
              <Button type="button" size="lg" className="h-11" disabled={submitting} onClick={() => void settle(dismiss(identified.id), "Could not dismiss the question")}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      </section>
      {minimized ? (
        <div className="flex items-center gap-2 border-t bg-muted/50 px-4 py-2 text-xs">
          <span aria-hidden="true">⧉</span>
          <span className="min-w-0 flex-1 truncate">
            {count} question{count === 1 ? "" : "s"} open
            {count > 1 ? ` · ${at + 1} of ${count}` : ""}
            {view ? ` · ${promptSummary(view)}` : ""}
          </span>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setMinimized(false)}>
            Reopen
          </Button>
        </div>
      ) : null}
    </>
  )
}
