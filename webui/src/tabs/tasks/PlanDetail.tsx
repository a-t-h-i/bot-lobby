/**
 * A saved plan's detail: when it was saved, where it came from, the parts it
 * was split into, the terminal's start/discard choices as buttons (`s`, `h`,
 * `d d`), and the agreed plan itself (`plans.get`).
 */
import type { PlanDetail as PlanDetailData, TaskRow } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { Button } from "@/components/ui/button"
import { act } from "@/lib/act"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { CHECK_MARKS, agoWords } from "./words"

/** `part 2 of 3 of one plan that was split into tasks`, with its parts listed. */
function Split({ split }: { split: NonNullable<PlanDetailData["split"]> }) {
  const after = split.after.length > 0 ? `, after ${split.after.map((number) => `part ${number}`).join(" and ")}` : ""
  return (
    <>
      <p className="text-sm text-muted-foreground">
        <span className="text-primary">part {split.part} of {split.of}</span> of one plan that was split into tasks
        {after ? <span className="text-foreground">{after}</span> : null}
      </p>
      <p className="text-sm text-muted-foreground">
        {split.titles.map((title, index) => (
          <span key={`${index}-${title}`}>
            {index > 0 ? <span className="text-muted-foreground/60"> · </span> : null}
            <span className={index + 1 === split.part ? "font-medium text-foreground" : undefined}>
              {index + 1}. {title}
            </span>
          </span>
        ))}
      </p>
    </>
  )
}

function PlanSections({ planId }: { planId: string }) {
  const read = useApiRead("plans.get", { planId }, ["plans"])
  const plan = read.data
  if (!plan) {
    return read.error ? <p className="text-sm text-muted-foreground">Could not load the agreed plan. {read.error}</p> : null
  }
  return (
    <>
      {plan.issue ? (
        <p className="text-sm text-muted-foreground">
          from issue #{plan.issue.number} — {plan.issue.title}
          {plan.issue.url ? <span className="break-all"> {plan.issue.url}</span> : null}
        </p>
      ) : null}
      {plan.split ? <Split split={plan.split} /> : null}
      <Section title="Agreed plan">
        <Markdown text={plan.brief} />
      </Section>
    </>
  )
}

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
        <p className="text-sm text-muted-foreground">pending{row.age ? ` · saved ${agoWords(row.age)}` : ""}</p>
        <p className="text-xs text-muted-foreground break-all">{row.id}</p>
      </header>
      <PlanSections planId={row.id} />
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
