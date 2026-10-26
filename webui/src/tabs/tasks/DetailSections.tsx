/**
 * The sections of a task's detail: Request, Steps (the plan's short list; a
 * step agents are on carries their icons, how many and its ticking time, and
 * opens to who is doing what; a step not yet done can be skipped with a
 * reason, and a skipped one reads struck through with that reason), the full plan
 * folded away under them (or Proposal / the empty Plan note), Amendments,
 * Waiting on, QA risk (Jev's read of the built change) and Recent runs. The
 * plan text and steps arrive with `tasks.get`.
 */
import { useEffect, useId, useState } from "react"
import { CheckCircle2, ChevronDown, ChevronRight, Circle, CircleSlash } from "lucide-react"
import type { TaskDetail as TaskDetailData } from "@protocol"
import { executionWords } from "@/lib/phaseTiming"
import { useElapsed } from "@/lib/useElapsed"
import { cn } from "@/lib/utils"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { agentName, sourceColor, sourceLabel } from "@/tabs/lobby/types"
import { AgentIcon } from "@/ui/AgentIcon"
import { WorkingMark } from "@/ui/WorkingMark"
import { QA_RISK_WORDS, qaRiskNote } from "./words"
import { SkipStep } from "./SkipStep"

/** What the Skip on each open step needs: the task, and what to reread once a step is skipped. */
interface SkipProps {
  taskId: string
  onSkipped: () => void
}

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
      <span className="absolute size-2.5 rounded-full bg-primary/30 motion-safe:animate-status-ping" />
      <span className="size-2 rounded-full bg-primary" />
    </span>
  )
}

type StepAgent = NonNullable<StepData["agents"]>[number]

/** What an agent was told, without the `Step 2:` its brief opens with (the row is under that step already). */
export function briefLine(instruction: string): string {
  const first = instruction.split("\n").find((line) => line.trim())?.trim() ?? ""
  return first.replace(/^steps?\s+\d+(?:\s*[-–]\s*\d+)?\s*[:.\-–]\s*/i, "").replace(/^\*\*?goal\*\*?\s*[:\-–]\s*/i, "")
}

/** An agent's mark: its icon on a tile in its colour. */
function AgentTile({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-md border border-border bg-card", sourceColor(name), className)}>
      <AgentIcon source={name} className="size-3" />
    </span>
  )
}

/** The step's agents right now, children beneath their parent, each with what it was told and how long it has worked. */
function StepAgents({ id, agents, stepText }: { id: string; agents: StepAgent[]; stepText: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const top = agents.filter((agent) => !agent.parentRunId || !agents.some((parent) => parent.runId === agent.parentRunId))
  const ordered = top.flatMap((parent) => [parent, ...agents.filter((child) => child.parentRunId === parent.runId)])
  return (
    <ul id={id} aria-label="Agents on this step" className="mt-2 flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      {ordered.map((agent) => {
        const name = agentName({ domain: agent.domain } as Parameters<typeof agentName>[0])
        const child = Boolean(agent.parentRunId) && agents.some((parent) => parent.runId === agent.parentRunId)
        const started = Date.parse(agent.startedAt)
        const brief = briefLine(agent.instruction)
        const own = brief && brief.toLowerCase() !== stepText.trim().toLowerCase() ? brief : ""
        return (
          <li key={agent.runId} className="flex min-w-0 items-center gap-2.5 border-b border-border px-3 py-2 text-xs last:border-b-0">
            {child ? <span aria-hidden="true" className="ml-1.5 h-4 w-3 shrink-0 rounded-bl-md border-b border-l border-border" /> : null}
            <AgentTile name={name} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cn("font-medium", sourceColor(name))}>{sourceLabel(name)}</span>
                {child ? <span className="text-muted-foreground">child</span> : null}
                <WorkingMark className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground">working</span>
              </span>
              {own ? <span className="truncate text-muted-foreground" title={agent.instruction}>{own}</span> : null}
            </span>
            {Number.isFinite(started) ? <span className="shrink-0 tabular-nums text-muted-foreground">{executionWords(Math.max(0, now - started))}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

/** The agents on a step at a glance: their icons, how many, and how long the step has been worked on. */
function AgentsBadge({ agents, count, step, stopped }: { agents: StepAgent[]; count: number; step: StepData; stopped: boolean }) {
  const names = [...new Set(agents.map((agent) => agentName({ domain: agent.domain } as Parameters<typeof agentName>[0])))].slice(0, 3)
  return (
    <>
      {names.length > 0 ? (
        <span className="flex -space-x-1.5">
          {names.map((name) => <AgentTile key={name} name={name} className="size-[1.125rem] ring-2 ring-card" />)}
        </span>
      ) : null}
      <span>
        {count} {count === 1 ? "agent" : "agents"}
        <span className="sr-only"> working</span>
      </span>
      <span aria-hidden="true" className="text-muted-foreground/60">·</span>
      <StepTime step={step} stopped={stopped} />
    </>
  )
}

const BADGE = "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 pr-2 pl-1 text-xs font-medium text-primary"

/** When a step was skipped, as "16 Oct, 22:49". */
function skippedAt(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

/** A step the user skipped: struck through, with their reason under it. */
function SkippedStep({ step, index }: { step: StepData; index: number }) {
  const when = step.skip ? skippedAt(step.skip.at) : ""
  return (
    <li className="flex min-w-0 flex-col" data-step="skipped">
      <div className="flex min-w-0 items-start gap-2.5 text-sm">
        <CircleSlash aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">{index + 1}.</span>
        <span className="min-w-0 break-words text-muted-foreground line-through decoration-muted-foreground/50">{step.text}</span>
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">skipped</span>
      </div>
      {step.skip ? (
        <p className="step-skip-reason mt-1 ml-[3.25rem] border-l-2 border-border pl-2.5 text-xs break-words text-muted-foreground">
          <span className="font-medium text-foreground/80">Why: </span>
          {step.skip.reason}
          {when ? <span className="text-muted-foreground/70"> · {when}</span> : null}
        </p>
      ) : null}
    </li>
  )
}

function Step({ step, index, stopped, skip }: { step: StepData; index: number; stopped: boolean; skip?: SkipProps | undefined }) {
  const active = Boolean(step.active) && !stopped
  const agents = active ? step.agents ?? [] : []
  const count = agents.length || (step.activeAgentCount ?? 1)
  const [open, setOpen] = useState(false)
  const listId = useId()
  const done = step.status === "done"
  const markClass = done ? "text-success" : step.status === "current" ? "text-primary" : "text-muted-foreground"
  const Icon = done ? CheckCircle2 : Circle
  if (step.status === "skipped") return <SkippedStep step={step} index={index} />
  return (
    <li className="group/step flex min-w-0 flex-col" data-step={active ? "active" : step.status}>
      <div className="flex min-w-0 items-start gap-2.5 text-sm">
        {active ? <ActiveMark /> : <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${markClass}`} />}
        <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">{index + 1}.</span>
        <span className={cn("min-w-0 break-words", active || step.status === "current" ? "text-foreground" : "text-muted-foreground")}>{step.text}</span>
        {active && agents.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
            className={cn(BADGE, "-my-0.5 transition-colors outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
          >
            <AgentsBadge agents={agents} count={count} step={step} stopped={stopped} />
            <ChevronDown aria-hidden="true" className={cn("size-3 transition-transform duration-200", open && "rotate-180")} />
            <span className="sr-only"> (being worked on now)</span>
          </button>
        ) : active ? (
          <span className={cn(BADGE, "-my-0.5")}>
            <AgentsBadge agents={agents} count={count} step={step} stopped={stopped} />
            <span className="sr-only"> (being worked on now)</span>
          </span>
        ) : step.status === "current" && !stopped ? (
          <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs font-medium">
            next<span className="sr-only"> (the step up next)</span>
          </span>
        ) : null}
        {skip && !done && !stopped ? <SkipStep taskId={skip.taskId} index={index} text={step.text} onSkipped={skip.onSkipped} /> : null}
      </div>
      {open && agents.length > 0 ? <div className="pl-[3.25rem]"><StepAgents id={listId} agents={agents} stepText={step.text} /></div> : null}
    </li>
  )
}

function StepsSection({ steps, stopped, skip }: { steps: TaskDetailData["steps"]; stopped: boolean; skip?: SkipProps | undefined }) {
  // How many are done shows once, in the task's header; here only what the header leaves out.
  const skipped = steps.filter((step) => step.status === "skipped").length
  return (
    <Section title="Steps" {...(skipped ? { right: `${skipped} skipped` } : {})}>
      <ol className="flex flex-col gap-2" aria-label="Steps">
        {steps.map((step, index) => (
          <Step key={`${index}-${step.text}`} step={step} index={index} stopped={stopped} skip={skip} />
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
        className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
export function PlanSections({ detail, finished, skip }: { detail: TaskDetailData; finished: boolean; skip?: SkipProps }) {
  return (
    <>
      {detail.steps.length > 0 ? <StepsSection steps={detail.steps} stopped={finished} skip={skip} /> : null}
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
      {detail.qaRisk ? <QaRisk risk={detail.qaRisk} /> : null}
      <Runs runs={detail.runs} />
    </>
  )
}
