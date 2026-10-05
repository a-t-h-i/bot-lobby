/**
 * A saved plan's detail: when it was saved, where it came from, the parts it
 * was split into, the start/discard choices as buttons, and the agreed plan
 * itself (`plans.get`).
 */
import type { PlanDetail as PlanDetailData, TaskRow } from "@protocol"
import { useApiRead } from "@/app/useApiRead"
import { Play, SquareArrowOutUpRight, Trash2 } from "lucide-react"
import { act } from "@/lib/act"
import { ActionBar, ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { agoWords } from "./words"
import { CheckMark } from "@/ui/task-facts"

/** `part 2 of 3 of one plan that was split into tasks`, with its parts listed. */
function Split({ split }: { split: NonNullable<PlanDetailData["split"]> }) {
  const after = split.after.length > 0 ? `, after ${split.after.map((number) => `part ${number}`).join(" and ")}` : ""
  return (
    <>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-primary">part {split.part} of {split.of}</span> of one plan that was split into tasks
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
      <ActionBar>
        <ActionButton label="Start here" icon={Play} tone="primary" shortcut="S" onClick={() => void start("here")} />
        <ActionButton label="Start in a new session" text="New session" icon={SquareArrowOutUpRight} shortcut="N" onClick={() => void start("session")} />
        <ConfirmButton
          icon={Trash2}
          label="Discard"
          shortcut="Delete"
          title={`Discard "${row.title}"?`}
          description="The saved plan is removed from the list. This cannot be undone."
          confirmLabel="Discard"
          variant="destructive"
          onConfirm={() => void discard()}
        />
      </ActionBar>
      <header className="flex flex-col gap-1">
        <h2 className="flex items-start gap-2.5 text-lg font-medium">
          <CheckMark check="open" className="mt-1.5" />
          <span className="min-w-0 break-words">{row.title}</span>
        </h2>
        <p className="text-sm text-muted-foreground">pending{row.age ? ` · saved ${agoWords(row.age)}` : ""}</p>
        <p className="text-xs text-muted-foreground break-all">{row.id}</p>
      </header>
      <PlanSections planId={row.id} />
    </article>
  )
}
