/**
 * The sections of a task's detail (batch-2 §f, `taskDetailLines` order):
 * Request, Progress, Approved plan (or Proposal / the empty Plan note),
 * Amendments, Waiting on and Recent runs. Wording and marks are copied from
 * `src/lobby/tabs/tasks.ts`; the plan text and steps arrive with `tasks.get`.
 */
import type { TaskDetail as TaskDetailData } from "@protocol"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"

const DONE = "☑"
const OPEN = "☐"

function Step({ step, index }: { step: TaskDetailData["steps"][number]; index: number }) {
  const mark = step.status === "done" ? DONE : OPEN
  const markClass = step.status === "done" ? "text-primary" : step.status === "current" ? "text-foreground" : "text-muted-foreground"
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`shrink-0 ${markClass}`} aria-hidden="true">
        {mark}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
      <span className={step.status === "current" ? "min-w-0 break-words text-foreground" : "min-w-0 break-words text-muted-foreground"}>{step.text}</span>
      {step.status === "current" ? (
        <span className="shrink-0 font-medium text-primary">
          ◂ now<span className="sr-only"> (current step)</span>
        </span>
      ) : null}
    </li>
  )
}

function ProgressSection({ steps }: { steps: TaskDetailData["steps"] }) {
  const done = steps.filter((step) => step.status === "done").length
  return (
    <Section title="Progress" right={`${done}/${steps.length} steps`}>
      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => (
          <Step key={`${index}-${step.text}`} step={step} index={index} />
        ))}
      </ol>
    </Section>
  )
}

function PlanSection({ detail, finished }: { detail: TaskDetailData; finished: boolean }) {
  if (detail.plan) {
    return (
      <Section title="Approved plan">
        <Markdown text={detail.plan} />
      </Section>
    )
  }
  if (detail.proposal) {
    return (
      <Section title={finished ? "Proposal" : "Proposal (no plan yet)"}>
        <Markdown text={detail.proposal} />
      </Section>
    )
  }
  return (
    <Section title="Plan">
      <p className="text-sm text-muted-foreground">
        {finished ? "It ended before a plan was made." : "No proposal or plan yet — the oracle is still clarifying or scouting."}
      </p>
    </Section>
  )
}

function Amendments({ amendments }: { amendments: string[] }) {
  if (amendments.length === 0) return null
  return (
    <Section title="Amendments">
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {amendments.map((amendment) => (
          <li key={amendment} className="break-words">
            {amendment}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Waiting({ detail }: { detail: TaskDetailData }) {
  if (detail.waiting.length === 0 && detail.blockers.length === 0) return null
  return (
    <Section title="Waiting on">
      <ul className="flex flex-col gap-1 text-sm">
        {detail.waiting.map((item, index) => (
          <li key={`${index}-${item.kind}`} className="flex gap-2">
            <span className="shrink-0 text-primary" aria-hidden="true">
              !
            </span>
            <span className="min-w-0 break-words text-muted-foreground">
              {item.kind} {item.detail}
            </span>
          </li>
        ))}
        {detail.blockers.map((blocker, index) => (
          <li key={`${index}-${blocker.reason}`} className="flex gap-2">
            <span className="shrink-0 text-destructive" aria-hidden="true">
              ✗
            </span>
            <span className="min-w-0 break-words text-muted-foreground">
              {blocker.reason} (needs: {blocker.need})
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Runs({ runs }: { runs: string[] }) {
  if (runs.length === 0) return null
  return (
    <Section title="Recent runs">
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {runs.map((run, index) => (
          <li key={`${index}-${run}`} className="break-words">
            {run}
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** Request, Progress and the plan — the sections above Comments. */
export function PlanSections({ detail, finished }: { detail: TaskDetailData; finished: boolean }) {
  return (
    <>
      {detail.request ? (
        <Section title="Request">
          <Markdown text={detail.request} />
        </Section>
      ) : null}
      {detail.steps.length > 0 ? <ProgressSection steps={detail.steps} /> : null}
      <PlanSection detail={detail} finished={finished} />
    </>
  )
}

/** Amendments, Waiting on and Recent runs — the sections below Comments. */
export function DetailTrailer({ detail }: { detail: TaskDetailData }) {
  return (
    <>
      <Amendments amendments={detail.amendments} />
      <Waiting detail={detail} />
      <Runs runs={detail.runs} />
    </>
  )
}
