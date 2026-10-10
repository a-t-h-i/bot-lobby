/**
 * The sections of a task's detail: Request, Steps (the plan's short list, the
 * steps a worker is on marked `active · 1m 12s` and ticking), the full plan
 * folded away under them (or Proposal / the empty Plan note), Amendments,
 * Waiting on, QA risk (Jev's read of the built change) and Recent runs. The
 * plan text and steps arrive with `tasks.get`.
 */
import { useId, useState } from "react"
import { AlertCircle, CheckCircle2, ChevronRight, Circle, XCircle } from "lucide-react"
import type { TaskDetail as TaskDetailData } from "@protocol"
import { executionWords } from "@/lib/phaseTiming"
import { useElapsed } from "@/lib/useElapsed"
import { cn } from "@/lib/utils"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { QA_RISK_WORDS, qaRiskNote } from "./words"

type StepData = TaskDetailData["steps"][number]

/** A worker's time on the step, ticking while it works (`stopped` once the task has ended). */
function StepTime({ step, stopped }: { step: StepData; stopped: boolean }) {
  const elapsed = useElapsed(!stopped, step)
  return <span className="tabular-nums">{executionWords((step.workedMs ?? 0) + elapsed)}</span>
}

/** The mark of a step under way: a dot that breathes while a worker is on it. */
function ActiveMark() {
  return (
    <span aria-hidden="true" className="relative mt-[0.3125rem] grid size-4 shrink-0 place-items-center">
      <span className="absolute size-2.5 rounded-full bg-primary/30 motion-safe:animate-ping" />
      <span className="size-2 rounded-full bg-primary" />
    </span>
  )
}

function Step({ step, index, stopped }: { step: StepData; index: number; stopped: boolean }) {
  const active = Boolean(step.active) && !stopped
  const count = step.activeAgentCount ?? 1
  const done = step.status === "done"
  const markClass = done ? "text-success" : step.status === "current" ? "text-primary" : "text-muted-foreground"
  const Icon = done ? CheckCircle2 : Circle
  return (
    <li className="flex items-start gap-2.5 text-sm" data-step={active ? "active" : step.status}>
      {active ? <ActiveMark /> : <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${markClass}`} />}
      <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">{index + 1}.</span>
      <span className={cn("min-w-0 break-words", active || step.status === "current" ? "text-foreground" : "text-muted-foreground")}>{step.text}{active ? <span className="ml-1 text-xs text-primary">({count} {count === 1 ? "agent working" : "agents working"})</span> : null}</span>
      {active ? (
        <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          active · <StepTime step={step} stopped={stopped} />
          <span className="sr-only"> (being worked on now)</span>
        </span>
      ) : step.status === "current" && !stopped ? (
        <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs font-medium">
          next<span className="sr-only"> (the step up next)</span>
        </span>
      ) : null}
    </li>
  )
}

function StepsSection({ steps, stopped }: { steps: TaskDetailData["steps"]; stopped: boolean }) {
  const done = steps.filter((step) => step.status === "done").length
  return (
    <Section title="Steps" right={`${done}/${steps.length} done`}>
      <ol className="flex flex-col gap-2" aria-label="Steps">
        {steps.map((step, index) => (
          <Step key={`${index}-${step.text}`} step={step} index={index} stopped={stopped} />
        ))}
      </ol>
    </Section>
  )
}

/** The rest of the plan (its detail) under the steps, folded away until asked for. */
function FullPlan({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const body = useId()
  return (
    <Section title="Full plan">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={body}
        onClick={() => setOpen((now) => !now)}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform duration-200 ease-snap", open && "rotate-90")} />
        {open ? "Hide the details" : "Read the details of each step"}
      </button>
      {open ? (
        <div id={body}>
          <Markdown text={text} />
        </div>
      ) : null}
    </Section>
  )
}

function PlanSection({ detail, finished }: { detail: TaskDetailData; finished: boolean }) {
  if (detail.plan && detail.planDetails) return <FullPlan text={detail.planDetails} />
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
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <span className="min-w-0 break-words text-muted-foreground">
              {item.kind} {item.detail}
            </span>
          </li>
        ))}
        {detail.blockers.map((blocker, index) => (
          <li key={`${index}-${blocker.reason}`} className="flex gap-2">
            <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="min-w-0 break-words text-muted-foreground">
              {blocker.reason} (needs: {blocker.need})
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** How much QA the built change warrants, as Jev read its diff: the level, how deep QA goes, where it looks and why. */
function QaRisk({ risk }: { risk: NonNullable<TaskDetailData["qaRisk"]> }) {
  const words = QA_RISK_WORDS[risk.risk]
  return (
    <Section title="QA risk" right={qaRiskNote(risk)}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm" data-qa-risk={risk.risk}>
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", words.tone)}>{words.label}</span>
        <span className="text-muted-foreground">{words.depth}</span>
      </p>
      {risk.focusAreas.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground" aria-label="What QA looks at first">
          {risk.focusAreas.map((area) => (
            <li key={area} className="break-words">{area}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs break-words text-muted-foreground">
        {risk.riskFactors.join(" · ")}
        {risk.qaRequired ? ` · existing tests ${risk.existingTestsLikelySufficient ? "likely enough" : "likely not enough"}` : ""}
      </p>
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

/** Steps first, to skim; then the request and the plan in full — the sections above Comments. */
export function PlanSections({ detail, finished }: { detail: TaskDetailData; finished: boolean }) {
  return (
    <>
      {detail.steps.length > 0 ? <StepsSection steps={detail.steps} stopped={finished} /> : null}
      {detail.request ? (
        <Section title="Request">
          <Markdown text={detail.request} />
        </Section>
      ) : null}
      <PlanSection detail={detail} finished={finished} />
    </>
  )
}

/** Amendments, Waiting on, QA risk and Recent runs — the sections below Comments. */
export function DetailTrailer({ detail }: { detail: TaskDetailData }) {
  return (
    <>
      <Amendments amendments={detail.amendments} />
      <Waiting detail={detail} />
      {detail.qaRisk ? <QaRisk risk={detail.qaRisk} /> : null}
      <Runs runs={detail.runs} />
    </>
  )
}
