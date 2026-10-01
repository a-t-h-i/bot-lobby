/**
 * The Quick fix list (batch-2 §h): jobs newest first, one 44 px row each with
 * its status mark, the first line of the request and the time it has run.
 */
import type { QuickFixJob } from "@protocol"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { STATUS_MARKS, elapsed, jobTitle } from "./words"

export function StatusMark({ status }: { status: QuickFixJob["status"] }) {
  if (status === "running") return <Spinner className="size-3.5" aria-label="running" />
  return (
    <>
      <span aria-hidden="true">{STATUS_MARKS[status]}</span>
      <span className="sr-only">{status}</span>
    </>
  )
}

function Row({ job, selected, now, onSelect }: { job: QuickFixJob; selected: boolean; now: number; onSelect: (id: string) => void }) {
  const time = elapsed(job, now)
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(job.id)}
        className="flex min-h-11 w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=true]:bg-muted aria-[current=true]:ring-2 aria-[current=true]:ring-inset aria-[current=true]:ring-ring"
      >
        <span className="flex h-5 w-4 shrink-0 items-center justify-center text-foreground">
          <StatusMark status={job.status} />
        </span>
        <span className={cn("min-w-0 flex-1 break-words", selected ? "font-medium text-foreground" : "text-foreground")}>{jobTitle(job)}</span>
        {time ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{time}</span> : null}
      </button>
    </li>
  )
}

export function JobList({ jobs, selectedId, now, onSelect }: { jobs: readonly QuickFixJob[]; selectedId?: string; now: number; onSelect: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-0.5 p-1">
      {jobs.map((job) => (
        <Row key={job.id} job={job} selected={job.id === selectedId} now={now} onSelect={onSelect} />
      ))}
    </ul>
  )
}
