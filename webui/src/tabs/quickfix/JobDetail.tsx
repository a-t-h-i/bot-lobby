/**
 * A quick fix's detail: facts, the request, the oracle's route
 * or hold note, the live steps, the files it edited, an error and the report —
 * with the buttons the job's status allows (cancel while it waits or runs;
 * run anyway or start as a task while it is held).
 */
import { TriangleAlert } from "lucide-react"
import type { QuickFixJob } from "@protocol"
import { CircleStop, ListPlus, Play } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { act } from "@/lib/act"
import { formatClock } from "@/lib/format"
import { ActionBar, ActionButton } from "@/ui/Actions"
import { ConfirmButton } from "@/ui/ConfirmButton"
import { Markdown } from "@/ui/Markdown"
import { Section } from "@/ui/Section"
import { factsLine, noStepsText } from "./words"

function Notes({ job }: { job: QuickFixJob }) {
  const held = job.status === "held"
  return (
    <>
      {job.route ? <p className="text-sm text-muted-foreground">Routed {job.route}</p> : null}
      {job.note && held ? <p className="flex items-start gap-2 border-b border-warning/30 px-3 pb-2 text-sm text-foreground">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>Held: {job.note}.</span>
        </p> : null}
      {job.note && !held ? <p className="text-sm text-muted-foreground">{job.routed ? `Routed here by the oracle — ${job.note}` : job.note}</p> : null}
      {job.routed && !job.note ? <p className="text-sm text-muted-foreground">Routed here by the oracle.</p> : null}
    </>
  )
}

function Steps({ job }: { job: QuickFixJob }) {
  const running = job.status === "running"
  if (job.steps.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {running ? <Spinner className="size-3.5" /> : null}
        {noStepsText(job.status)}
      </p>
    )
  }
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {job.steps.map((step, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatClock(step.at)}</span>
          <span className="flex h-5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
            {step.pending && running ? <Spinner className="size-3.5" /> : <span className="size-1.5 rounded-full bg-muted-foreground/40" />}
          </span>
          <span className="min-w-0 break-words text-muted-foreground">{step.pending && running ? `${step.text}…` : step.text}</span>
        </li>
      ))}
    </ol>
  )
}

function Actions({ job }: { job: QuickFixJob }) {
  if (job.status === "held") {
    return (
      <ActionBar>
        <ActionButton label="Run anyway" icon={Play} tone="primary" onClick={() => void act("quickfix.runAnyway", { id: job.id })} />
        <ActionButton label="Turn it into a task" icon={ListPlus} onClick={() => void act("quickfix.movedToTask", { id: job.id })} />
      </ActionBar>
    )
  }
  if (job.status !== "queued" && job.status !== "running") return null
  return (
    <ActionBar>
      <ConfirmButton
        icon={CircleStop}
        label="Cancel the quick fix"
        title="Cancel this quick fix?"
        description="The agent stops. Files it already edited stay as they are."
        confirmLabel="Cancel quick fix"
        variant="destructive"
        onConfirm={() => void act("quickfix.cancel", { id: job.id })}
      />
    </ActionBar>
  )
}

export function JobDetail({ job, now }: { job: QuickFixJob; now: number }) {
  return (
    <article className="flex flex-col gap-4" aria-label="Quick fix detail">
      <Actions job={job} />
      <header className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground break-all">{job.id}</p>
        <p className="text-sm text-foreground">{factsLine(job, now)}</p>
      </header>
      <Markdown text={job.prompt} />
      <Notes job={job} />
      <Section title="Steps">
        <Steps job={job} />
      </Section>
      {job.files?.length ? (
        <Section title="Edited">
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {job.files.map((file) => (
              <li key={file} className="break-all">
                · {file}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {job.error ? <p className="border-b border-destructive/30 px-3 pb-2 text-sm text-destructive">{job.error}</p> : null}
      {job.report ? (
        <Section title="Report">
          <Markdown text={job.report} />
        </Section>
      ) : null}
    </article>
  )
}
