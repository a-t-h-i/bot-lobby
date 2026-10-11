import { useEffect, useState } from "react"
import type { SnapshotTask } from "@protocol"
import { Spinner } from "@/components/ui/spinner"
import { formatElapsed } from "@/lib/format"
import { cn } from "@/lib/utils"
import { agentName, sourceColor, sourceLabel, type LobbyRun } from "./types"

export function workingGroups(task: SnapshotTask | undefined, runs: LobbyRun[]) {
  const live = [...new Map(runs.map((run, index) => [run.runId ?? String(index), run])).values()]
    .filter((run) => run.status === "running" && !run.finishedAt)
  const assigned = new Set<string>()
  const groups: Array<{ text: string; runs: LobbyRun[] }> = []
  for (const step of task?.activeSteps ?? []) {
    const members = live.filter((run) => step.runIds?.includes(run.runId ?? "") || (!step.runIds && task?.activeSteps?.length === 1 && run.role === "worker"))
    if (!members.length) continue
    for (const run of members) if (run.runId) assigned.add(run.runId)
    groups.push({ text: step.text, runs: members })
  }
  const phases: Record<string, string> = { scout: "Scouting", researcher: "Research", reviewer: "Review", worker: "Implementation" }
  for (const run of live) {
    if (run.runId && assigned.has(run.runId)) continue
    const text = phases[run.role ?? ""] ?? "Current work"
    const group = groups.find((entry) => entry.text === text)
    if (group) group.runs.push(run)
    else groups.push({ text, runs: [run] })
  }
  return groups
}

function AgentRow({ run, now }: { run: LobbyRun; now: number }) {
  const waiting = run.note?.startsWith("waiting on you")
  const elapsed = run.activeMs !== undefined
    ? run.activeMs + (waiting ? 0 : Math.max(0, now - (run.lastEventAt ?? now)))
    : now - Date.parse(run.startedAt ?? "")
  return (
    <li className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-xs", run.parentRunId && "ml-4 border-l border-border pl-3")}>
      <Spinner aria-hidden="true" role="presentation" className="size-3 shrink-0" />
      <span className={cn("font-medium", sourceColor(agentName(run)))}>{sourceLabel(agentName(run))}</span>
      {run.parentRunId ? <span className="text-muted-foreground">child</span> : null}
      <span className="min-w-0 flex-1 truncate" title={run.instruction}>{run.instruction?.split("\n")[0] ?? run.step ?? "Working"}</span>
      <span className="tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</span>
      {run.endsAt !== undefined && !waiting ? <span className="tabular-nums text-muted-foreground">{formatElapsed(Math.max(0, run.endsAt - now))} left</span> : null}
      <span className="basis-full pl-5 text-muted-foreground">{run.note ?? ([run.activity, run.detail].filter(Boolean).join(" ") || "Starting…")}</span>
    </li>
  )
}

export function CurrentWork({ task, runs }: { task?: SnapshotTask; runs: LobbyRun[] }) {
  const groups = workingGroups(task, runs)
  const active = groups.length > 0
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  if (!active) return null
  return (
    <section aria-label="Current step agents" className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border bg-muted/20 px-5 py-3">
      {groups.map((group, index) => (
        <details key={`${index}:${group.text}`} open className="py-1">
          <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {group.text} <span className="ml-2 text-xs font-normal text-muted-foreground">{group.runs.length} working</span>
          </summary>
          <ul aria-label={`Agents working on ${group.text}`} className="mt-1">
            {group.runs.filter((run) => !run.parentRunId || !group.runs.some((parent) => parent.runId === run.parentRunId))
              .flatMap((parent) => [parent, ...group.runs.filter((child) => child.parentRunId === parent.runId)])
              .map((run, row) => <AgentRow key={run.runId ?? row} run={run} now={now} />)}
          </ul>
        </details>
      ))}
    </section>
  )
}
