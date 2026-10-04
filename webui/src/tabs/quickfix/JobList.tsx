/**
 * The Quick fix list: jobs newest first, one row each with its status mark,
 * the first line of the request and the time it has run.
 */
import { Check, Clock, Minus, Pause, X } from "lucide-react"
import type { QuickFixJob } from "@protocol"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { elapsed, jobTitle } from "./words"

export function StatusMark({ status }: { status: QuickFixJob["status"] }) {
  if (status === "running") return <Spinner className="size-3.5" aria-label="running" />
  const Icon = { queued: Clock, success: Check, failed: X, timeout: X, cancelled: Minus, held: Pause, running: Clock }[status]
  const tone = status === "success" ? "text-success" : status === "failed" || status === "timeout" ? "text-destructive" : status === "held" ? "text-warning" : "text-muted-foreground"
  return (
    <>
      <Icon aria-hidden="true" className={`size-4 ${tone}`} />
      <span className="sr-only">{status}</span>
    </>
  )
}

function Row({ job, selected, now, onSelect }: { job: QuickFixJob; selected: boolean; now: number; onSelect: (id: string) => void }) {
  const time = elapsed(job, now)
  return (
    <li>
      <button aria-keyshortcuts="Enter Space" aria-describedby="focused-action-help"
        type="button"
        data-row
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(job.id)}
        className="flex min-h-9 w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=true]:bg-accent"
      >
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
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
    <ul className="flex flex-col divide-y divide-border px-2 pb-2">
      {jobs.map((job) => (
        <Row key={job.id} job={job} selected={job.id === selectedId} now={now} onSelect={onSelect} />
      ))}
    </ul>
  )
}
