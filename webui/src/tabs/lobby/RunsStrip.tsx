/**
 * The runs strip: one chip per agent run with its status mark, agent name, the
 * step in flight and how long it has been going. Elapsed times tick once a
 * second only while something is running, and use the pure formatter so a
 * non-finite span reads `0s` rather than `NaN`.
 */
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Check, X } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { formatElapsed } from "@/lib/format"
import { cn } from "@/lib/utils"
import { agentName, sourceColor, sourceLabel, type LobbyRun } from "./types"

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function statusMark(status: string | undefined): ReactNode {
  if (status === "running") return <Spinner aria-hidden="true" role="presentation" className="size-3.5" />
  if (status === "success") return <Check aria-hidden="true" className="size-3.5 text-success" />
  if (status === "failed" || status === "timeout" || status === "error") return <X aria-hidden="true" className="size-3.5 text-destructive" />
  return <span className="size-1.5 rounded-full bg-muted-foreground/50" />
}

function elapsedOf(run: LobbyRun, now: number): string {
  const start = run.startedAt ? Date.parse(run.startedAt) : Number.NaN
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now
  return formatElapsed(end - start)
}

export function RunsStrip({ runs }: { runs: LobbyRun[] }) {
  const now = useNow(runs.some((run) => run.status === "running"))
  if (runs.length === 0) return null
  return (
    <ul className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-2" aria-label="Runs">
      {runs.map((run, index) => (
        <li key={run.runId ?? index} className="flex items-center gap-2 rounded-full border border-border bg-background py-1 pr-3 pl-2 text-xs">
          <span className="flex size-4 items-center justify-center">{statusMark(run.status)}</span>
          <span className="sr-only">{run.status ?? "unknown"}</span>
          <span className={cn("font-medium", sourceColor(agentName(run)))}>{sourceLabel(agentName(run))}</span>
          {run.activity ?? run.step ? <span className="max-w-[18rem] truncate text-muted-foreground">{run.activity ?? run.step}</span> : null}
          <span className="tabular-nums text-muted-foreground">{elapsedOf(run, now)}</span>
        </li>
      ))}
    </ul>
  )
}
