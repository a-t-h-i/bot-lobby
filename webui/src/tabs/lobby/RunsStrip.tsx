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
import { agentName, type LobbyRun } from "./types"

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
  if (status === "running") return <Spinner className="size-3" aria-hidden="true" role="presentation" />
  if (status === "success") return "✓"
  if (status === "failed" || status === "timeout" || status === "error") return "✗"
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
    <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label="Runs">
      <span className="text-xs font-medium text-muted-foreground">Runs</span>
      {runs.map((run, index) => (
        <Badge key={run.runId ?? index} variant="outline" className="h-7 gap-1.5 font-normal">
          <span aria-hidden="true" className="text-muted-foreground">
            {statusMark(run.status)}
          </span>
          <span className="sr-only">{run.status ?? "unknown"}</span>
          <span className="font-medium">{agentName(run)}</span>
          {run.activity ?? run.step ? (
            <span className="text-muted-foreground">{run.activity ?? run.step}</span>
          ) : null}
          <span className="tabular-nums text-muted-foreground">{elapsedOf(run, now)}</span>
        </Badge>
      ))}
    </div>
  )
}
