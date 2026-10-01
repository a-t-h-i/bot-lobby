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
import { Pips, trackText } from "@/ui/task-facts"

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
