/**
 * The sections of a task's detail: Request, Steps (the plan's short list; a
 * step agents are on carries their icons, how many and its ticking time, and
 * opens to who is doing what; a step not yet done can be skipped with a
 * reason, and a skipped one reads struck through with that reason), the full plan
 * folded away under them (or Proposal / the empty Plan note), Amendments,
 * Waiting on, QA risk (Jev's read of the built change) and Recent runs. The
 * plan text and steps arrive with `tasks.get`.
 */
import { useEffect, useId, useState, type CSSProperties } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { TaskDetail as TaskDetailData } from "@protocol"
import { executionWords } from "@/lib/phaseTiming"
import { useElapsed } from "@/lib/useElapsed"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { agentName, sourceLabel } from "@/tabs/lobby/types"
import { AgentIcon, agentColor } from "@/ui/AgentIcon"
import { MarkDot } from "@/ui/task-facts"
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

type StepAgent = NonNullable<StepData["agents"]>[number]

/** What an agent was told, without the `Step 2:` its brief opens with (the row is under that step already). */
export function briefLine(instruction: string): string {
  const first = instruction.split("\n").find((line) => line.trim())?.trim() ?? ""
  return first.replace(/^steps?\s+\d+(?:\s*[-–]\s*\d+)?\s*[:.\-–]\s*/i, "").replace(/^\*\*?goal\*\*?\s*[:\-–]\s*/i, "")
}

const nameOf = (agent: StepAgent) => agentName({ domain: agent.domain } as Parameters<typeof agentName>[0])

/** The step's agents right now as a thin tree, children beneath their parent: a branch that flows in the agent's colour, its tile, what it was told and how long it has worked. */
function StepAgents({ id, agents, stepText }: { id: string; agents: StepAgent[]; stepText: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const top = agents.filter((agent) => !agent.parentRunId || !agents.some((parent) => parent.runId === agent.parentRunId))
  const ordered = top.flatMap((parent) => [parent, ...agents.filter((child) => child.parentRunId === parent.runId)])
  return (
    <ul id={id} aria-label="Agents on this step" className="cs-arows">
      {ordered.map((agent) => {
        const name = nameOf(agent)
        const child = Boolean(agent.parentRunId) && agents.some((parent) => parent.runId === agent.parentRunId)
        const started = Date.parse(agent.startedAt)
        const brief = briefLine(agent.instruction)
        const own = brief && brief.toLowerCase() !== stepText.trim().toLowerCase() ? brief : ""
        return (
          <li key={agent.runId} className="cs-arow" data-child={child ? "true" : undefined} style={{ "--ac": agentColor(name) } as CSSProperties}>
            <span aria-hidden="true" className="cs-bt" />
            <span aria-hidden="true" className="cs-be" />
            <span aria-hidden="true" className="cs-tile"><AgentIcon source={name} /></span>
            <span className="cs-ab2">
              <span className="cs-ab2h">
                <b>{sourceLabel(name)}</b>
                {child ? <span className="text-muted-foreground">child</span> : null}
                <span className="cs-live">working</span>
              </span>
              {own ? <span className="cs-br" title={agent.instruction}>{own}</span> : null}
            </span>
            {Number.isFinite(started) ? <span className="cs-tm">{executionWords(Math.max(0, now - started))}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

/** The agents on a step at a glance: their round tiles pulsing, how many, and how long the step has been worked on. */
function AgentsBadge({ agents, count, step, stopped }: { agents: StepAgent[]; count: number; step: StepData; stopped: boolean }) {
  const names = [...new Set(agents.map(nameOf))].slice(0, 3)
  return (
    <>
      {names.length > 0 ? (
        <span className="cs-avs" aria-hidden="true">
          {names.map((name) => <i key={name} style={{ "--ac": agentColor(name) } as CSSProperties}><AgentIcon source={name} /></i>)}
        </span>
      ) : null}
      <span className="cs-cn1">
        {count} {count === 1 ? "agent" : "agents"}
        <span className="sr-only"> working</span>
      </span>
      <span aria-hidden="true" className="cs-dm">·</span>
      <StepTime step={step} stopped={stopped} />
    </>
  )
}

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
    <li className="cs-stp" data-k="skip" data-step="skipped">
      <div className="cs-stpa">
        <MarkDot mark="skip" />
        <span className="cs-n">{index + 1}.</span>
        <span className="cs-tx">{step.text}</span>
        <span className="cs-skd">skipped</span>
      </div>
      {step.skip ? (
        <p className="cs-why step-skip-reason">
          <b>Why: </b>
          {step.skip.reason}
          {when ? <span className="text-[var(--faint)]"> · {when}</span> : null}
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
  if (step.status === "skipped") return <SkippedStep step={step} index={index} />
  const next = step.status === "current" && !stopped
  const kind = active ? "now" : done ? "done" : next ? "next" : "todo"
  return (
    <li className="cs-stp" data-k={kind} data-step={active ? "active" : step.status}>
      <div className="cs-stpa">
        <MarkDot mark={active ? "now" : done ? "done" : "open"} />
        <span className="cs-n">{index + 1}.</span>
        <span className="cs-tx">{step.text}</span>
        {active ? (
          <button type="button" aria-expanded={agents.length > 0 ? open : undefined} aria-controls={agents.length > 0 ? listId : undefined} disabled={agents.length === 0} onClick={() => setOpen((value) => !value)} className="cs-abdg">
            <AgentsBadge agents={agents} count={count} step={step} stopped={stopped} />
            {agents.length > 0 ? <ChevronDown aria-hidden="true" className="size-3" /> : null}
            <span className="sr-only"> (being worked on now)</span>
          </button>
        ) : next ? (
          <span className="cs-nx">
            next<span className="sr-only"> (the step up next)</span>
          </span>
        ) : null}
        {skip && !done && !stopped ? <SkipStep taskId={skip.taskId} index={index} text={step.text} onSkipped={skip.onSkipped} /> : null}
      </div>
      {open && agents.length > 0 ? <StepAgents id={listId} agents={agents} stepText={step.text} /> : null}
    </li>
  )
}

function StepsSection({ steps, stopped, skip }: { steps: TaskDetailData["steps"]; stopped: boolean; skip?: SkipProps | undefined }) {
  // How many are done shows once, in the task's header; here only what the header leaves out.
  const skipped = steps.filter((step) => step.status === "skipped").length
  return (
    <Section title="Steps" {...(skipped ? { right: `${skipped} skipped` } : {})}>
      <ol className="cs-stl" aria-label="Steps">
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
        className="cs-fold w-fit"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
        {open ? "Hide the details" : "Read the details of each step"}
      </button>
      {open ? (
        <div id={body} className="cs-fpb">
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
      <ul className="cs-bl">
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
      <p className="cs-qa1" data-qa-risk={risk.risk}>
        <span className="cs-bdg" data-t={words.tone}>{words.label}</span>
        <span className="text-muted-foreground">{words.depth}</span>
      </p>
      {risk.focusAreas.length > 0 ? (
        <ul className="cs-bl" aria-label="What QA looks at first">
          {risk.focusAreas.map((area) => (
            <li key={area} className="break-words">{area}</li>
          ))}
        </ul>
      ) : null}
      <p className="cs-qaf">
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
      <ul className="cs-bl cs-plain">
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
