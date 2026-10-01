/**
 * The Lobby tab's task header. `lobby.snapshot.task` carries the widened
 * fields the terminal's `taskDetailLines` shows — track, domains, the git
 * branch, plan progress and the step under way — so the page mirrors that
 * header. The wording comes from `src/lobby/tabs/tasks.ts`; the empty state is
 * unchanged.
 */
import type { SnapshotTask, StatusInfo } from "@protocol"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** A pip per step, at most eight, as the terminal's `pips` does. */
const PIPS_MAX = 8

function trackText(track: SnapshotTask["track"]): string {
  if (!track) return ""
  return track.path === "fast" ? `fast track (${track.size})` : `full workflow (${track.size})`
}

function pipStates(done: number, total: number): boolean[] {
  const cells = Math.min(total, PIPS_MAX)
  if (cells <= 0) return []
  const filled = Math.min(cells, Math.round((Math.max(0, done) / total) * cells))
  return Array.from({ length: cells }, (_, index) => index < filled)
}

function Pips({ done, total }: { done: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 align-middle" aria-hidden="true">
      {pipStates(done, total).map((on, index) => (
        <span key={index} className={cn("h-1.5 w-3 rounded-full", on ? "bg-primary" : "bg-border")} />
      ))}
    </span>
  )
}

function Facts({ task, branch }: { task: SnapshotTask; branch?: string }) {
  const track = trackText(task.track)
  const where = task.git?.branch ?? branch
  const from = task.git?.from
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <p>{[task.id, track, (task.domains ?? []).join(", ")].filter(Boolean).join(" · ")}</p>
      {where ? <p>⎇ {where}{from ? ` · from ${from}` : ""} · owner: this window</p> : null}
      {task.progress ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Pips done={task.progress.done} total={task.progress.total} />
          <span>{task.progress.done} of {task.progress.total} steps</span>
          {task.currentStep ? (
            <span className="text-foreground/80">
              current: {task.currentStep} <span className="text-primary">◂ now</span>
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

export function TaskHeader({ task, status }: { task?: SnapshotTask; status?: StatusInfo }) {
  const branch = status?.branch ?? status?.workspace.branch
  return (
    <Card size="sm" className="shrink-0">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{task?.title ?? "No task is running in this session."}</span>
          {task ? (
            <Badge variant="outline" className="font-normal">
              {task.state}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {task ? task.id : (status?.sessionName ?? "Type a request below to start one.")}
        </CardDescription>
      </CardHeader>
      {task ? (
        <CardContent>
          <Facts task={task} branch={branch} />
        </CardContent>
      ) : null}
    </Card>
  )
}
