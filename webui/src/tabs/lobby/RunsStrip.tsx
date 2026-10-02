/**
 * The runs strip: one chip per agent run with its status mark, agent name, the
 * step in flight and how long it has been going. Elapsed times tick once a
 * second only while something is running, and use the pure formatter so a
 * non-finite span reads `0s` rather than `NaN`.
 */
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { formatElapsed } from "@/lib/format"
import { cn } from "@/lib/utils"
import { agentName, sourceColor, type LobbyRun } from "./types"

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
  if (status === "running") return <Spinner aria-hidden="true" role="presentation" />
  if (status === "success") return <span className="text-success">✓</span>
  if (status === "failed" || status === "timeout" || status === "error") return <span className="text-destructive">✗</span>
  return "·"
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
    <div className="flex shrink-0 flex-wrap items-center gap-x-[2ch] gap-y-1 text-sm" aria-label="Runs">
      <span className="font-bold text-primary">Runs</span>
      {runs.map((run, index) => (
        <Badge key={run.runId ?? index} variant="ghost" className="h-6 gap-[1ch] px-0 text-sm font-normal">
          <span aria-hidden="true" className="text-muted-foreground">
            {statusMark(run.status)}
          </span>
          <span className="sr-only">{run.status ?? "unknown"}</span>
          <span className={cn(sourceColor(agentName(run)))}>{agentName(run)}</span>
          {run.activity ?? run.step ? (
            <span className="text-muted-foreground">{run.activity ?? run.step}</span>
          ) : null}
          <span className="tabular-nums text-muted-foreground">{elapsedOf(run, now)}</span>
        </Badge>
      ))}
    </div>
  )
}
