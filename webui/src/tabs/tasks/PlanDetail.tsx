/**
 * A saved plan's detail: when it was saved, where it came from, and the
 * terminal's start/discard choices as buttons (`s`, `h`, `d d`). The agreed
 * plan itself is not on the wire yet, so only the row's facts show.
 */
import type { TaskRow } from "@protocol"
import { Button } from "@/components/ui/button"
import { act } from "@/lib/act"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { CHECK_MARKS, agoWords } from "./words"

export function PlanDetail({ row, onGone }: { row: TaskRow; onGone: () => void }) {
  const start = async (where: "here" | "session") => {
    if (await act("plans.start", { planId: row.id, where })) onGone()
  }
  const discard = async () => {
    if (await act("plans.discard", { planId: row.id })) onGone()
  }
  return (
    <article className="flex flex-col gap-4" aria-label={row.title}>
      <header className="flex flex-col gap-1">
        <h2 className="flex gap-2 text-base font-medium">
          <span aria-hidden="true">{CHECK_MARKS.open}</span>
          <span className="min-w-0 break-words">{row.title}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          pending{row.age ? ` · saved ${agoWords(row.age)}` : ""}
        </p>
        <p className="text-xs text-muted-foreground break-all">{row.id}</p>
        {row.issue ? <p className="text-sm text-muted-foreground">from issue #{row.issue}</p> : null}
      </header>
      <div className="flex flex-wrap gap-2">
        <Button className="h-10" onClick={() => void start("here")}>
          Start here
        </Button>
        <Button variant="outline" className="h-10" onClick={() => void start("session")}>
          Start in a new session
        </Button>
        <ConfirmButton
          label="Discard"
          title={`Discard "${row.title}"?`}
          description="The saved plan is removed from the list. This cannot be undone."
          confirmLabel="Discard"
          variant="destructive"
          onConfirm={() => void discard()}
        />
      </div>
    </article>
  )
}
