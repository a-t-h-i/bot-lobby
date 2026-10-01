/**
 * The fixed header: workspace and branch, the task in view, the AUTO mode
 * marker and the stream state. At 768 px the parts wrap onto a second line; at
 * 1024 px and up they sit on one.
 */
import { Circle, CircleDot, RotateCw, WifiOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { ConnectionState } from "@/lib/events"
import type { SnapshotTask, StatusInfo } from "@protocol"

function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "live") {
    return (
      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
        <Circle className="size-2 fill-current" aria-hidden="true" />
        Connected
      </Badge>
    )
  }
  if (state === "connecting") {
    return (
      <Badge variant="secondary" className="gap-1 font-normal">
        <CircleDot className="size-3 animate-pulse" aria-hidden="true" />
        Reconnecting…
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="gap-1 font-normal">
      <WifiOff className="size-3" aria-hidden="true" />
      Connection lost
    </Badge>
  )
}

export function Header({
  status,
  task,
  connection,
}: {
  status?: StatusInfo
  task?: SnapshotTask
  connection: ConnectionState
}) {
  const name = status?.workspace.name ?? "bot-lobby"
  const branch = status?.branch ?? status?.workspace.branch
  const state = task ? `${task.id} ${task.state}` : (status?.sessionName ?? "no task in this session")

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2">
      <span className="text-sm font-semibold tracking-tight">
        ◆ {name}
        {branch ? <span className="font-normal text-muted-foreground"> (⎇ {branch})</span> : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{state}</span>
      <Badge variant="outline" className="gap-1 font-normal">
        <RotateCw className="size-3" aria-hidden="true" />
        AUTO
      </Badge>
      <ConnectionBadge state={connection} />
    </header>
  )
}
