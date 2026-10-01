/**
 * The Lobby tab's task header. `lobby.snapshot` carries only `{id, title,
 * state}` today, so track, plan progress, current step and budget from the
 * terminal's `taskDetailLines` have no wire field yet; the branch comes from
 * `status`. The missing fields are reported to the Master, not invented here.
 */
import type { SnapshotTask, StatusInfo } from "@protocol"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

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
      {task && branch ? (
        <CardContent className="text-xs text-muted-foreground">
          ⎇ {branch} · owner: this window
        </CardContent>
      ) : null}
    </Card>
  )
}
