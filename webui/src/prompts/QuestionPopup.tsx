/**
 * The questionnaire as a pop-up in the middle of the window, over a blurred
 * backdrop. One question at a time, `1 of N` across the queue. `Later` (or
 * Esc) puts it away without losing a word: a small button in the header
 * brings it back. `Cancel` asks before leaving. A late answer (another window
 * answered first) surfaces the shared "already answered" notice.
 */
import { useEffect, useState } from "react"
import { HelpCircle, X } from "lucide-react"
import { ANSWERED_ELSEWHERE } from "@shared"
import { Button } from "@/components/ui/button"
import { Popup } from "@/components/ui/popup"
import { ApiError } from "@/lib/api"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { toast } from "@/lib/toast"
import type { WebPrompt } from "@protocol"
import { QuestionCard } from "./QuestionCard"
import { parsePrompt } from "./payload"

interface QuestionPopupProps {
  prompts: WebPrompt[]
  answer: (id: string, value: unknown) => Promise<void>
  dismiss: (id: string) => Promise<void>
  /** Whether the popup is put away (the header shows the button that brings it back). */
  minimized: boolean
  onMinimize: (minimized: boolean) => void
}

function LeavePrompt({ submitting, onKeep, onLeave }: { submitting: boolean; onKeep: () => void; onLeave: () => void }) {
  return (
    <div className="flex flex-col gap-4" role="alert">
      <p className="text-sm">Leave without answering? The oracle will not guess for you.</p>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onKeep}>
          Keep answering
        </Button>
        <Button type="button" disabled={submitting} onClick={onLeave}>
          {submitting ? "Leaving…" : "Leave"}
        </Button>
      </div>
    </div>
  )
}

/** The header's way back to a question that was put away. */
export function QuestionsPill({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <Button type="button" variant="soft" onClick={onOpen} aria-label={`${count} question${count === 1 ? "" : "s"} waiting — open`} className="gap-1.5 text-warning">
      <HelpCircle aria-hidden="true" />
      <span className="tabular-nums">{count}</span>
      <span className="hidden sm:inline">waiting</span>
    </Button>
  )
}

export function QuestionPopup({ prompts, answer, dismiss, minimized, onMinimize }: QuestionPopupProps) {
  const [leaving, setLeaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const count = prompts.length
  const active = prompts[0]
  const view = active ? parsePrompt(active) : undefined
  const wants = count > 0 && !minimized
  const shown = useOverlaySlot(wants, PRIORITY.question)

  useEffect(() => {
    if (count === 0) {
      setLeaving(false)
      onMinimize(false)
    }
  }, [count, onMinimize])

  async function settle(action: Promise<void>, failure: string): Promise<void> {
    setSubmitting(true)
    try {
      await action
      setLeaving(false)
    } catch (error) {
      if (error instanceof ApiError && error.code === "question_withdrawn") toast(ANSWERED_ELSEWHERE)
      else toast.error(error instanceof Error ? error.message : failure)
    } finally {
      setSubmitting(false)
    }
  }

  const who = active?.from ? `${active.from} asks` : "A question"
  return (
    <Popup
      open={wants && shown && Boolean(active)}
      label="Question from the lobby"
      dismissOnBackdrop={false}
      onOpenChange={(open) => {
        if (open) return
        if (leaving) setLeaving(false)
        else onMinimize(true)
      }}
      className="max-w-3xl"
    >
      {active ? (
        <section aria-label="Question from the lobby" className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center gap-3 px-6 pt-5 pb-3">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
              {who}
              {count > 1 ? ` · 1 of ${count}` : ""}
            </p>
            <Button type="button" variant="ghost" size="icon" aria-label="Later: put the question away" title="Later · Esc" onClick={() => onMinimize(true)}>
              <X aria-hidden="true" />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {view ? (
              leaving ? (
                <LeavePrompt submitting={submitting} onKeep={() => setLeaving(false)} onLeave={() => void settle(dismiss(active.id), "Could not leave the question")} />
              ) : (
                <QuestionCard
                  key={active.id}
                  view={view}
                  submitting={submitting}
                  onAnswer={(value) => void settle(answer(active.id, value), "Could not send the answer")}
                  onCancel={() => setLeaving(true)}
                />
              )
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">This question cannot be shown here.</p>
                <Button type="button" disabled={submitting} onClick={() => void settle(dismiss(active.id), "Could not dismiss the question")}>
                  Dismiss
                </Button>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </Popup>
  )
}
