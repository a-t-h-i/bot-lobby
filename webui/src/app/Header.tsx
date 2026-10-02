/**
 * The title line, as the terminal's top line (D-21): `◆ workspace (⎇ branch)`,
 * the tabs as cells of the line, then what this session is doing, the AUTO
 * mode marker and the stream state, all as text on the page. Below 1400 px the
 * tabs take a line of their own under the title; from 1400 px everything sits
 * on one line, as in the terminal.
 */
import type { ReactNode } from "react"
import { Spinner } from "@/components/ui/spinner"
import type { ConnectionState } from "@/lib/events"
import type { SnapshotTask, StatusInfo } from "@protocol"

function Connection({ state }: { state: ConnectionState }) {
  if (state === "live") {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">● </span>connected
      </span>
    )
  }
  if (state === "connecting") {
    return (
      <span className="flex items-center gap-[1ch] text-muted-foreground">
        <Spinner aria-hidden="true" role="presentation" />
        reconnecting…
      </span>
    )
  }
  return <span className="font-bold text-destructive">✗ connection lost</span>
}

export function Header({
  status,
  task,
  connection,
  tabs,
}: {
  status?: StatusInfo
  task?: SnapshotTask
  connection: ConnectionState
  tabs: ReactNode
}) {
  const name = status?.workspace.name ?? "bot-lobby"
  const branch = status?.branch ?? status?.workspace.branch
  const busy = status?.busy ?? false

  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[2ch] px-[1ch] text-sm [grid-template-areas:'title_status'_'tabs_tabs'] min-[1400px]:grid-cols-[auto_auto_minmax(0,1fr)_auto] min-[1400px]:gap-x-[1ch] min-[1400px]:[grid-template-areas:'title_sep_tabs_status']">
      <span className="truncate leading-10 [grid-area:title]">
        <span className="font-bold text-primary">◆ {name}</span>
        {branch ? <span className="text-muted-foreground"> (⎇ {branch})</span> : null}
      </span>
      <span aria-hidden="true" className="hidden text-border [grid-area:sep] min-[1400px]:block">
        │
      </span>
      <div className="min-w-0 [grid-area:tabs]">{tabs}</div>
      <div className="flex min-w-0 items-center gap-[2ch] whitespace-nowrap [grid-area:status]">
        <span className="flex min-w-0 items-center gap-[1ch]">
          {busy ? <Spinner aria-hidden="true" role="presentation" /> : <span aria-hidden="true" className="text-muted-foreground">●</span>}
          {task ? (
            <span className="truncate">
              {task.id} <span className="text-muted-foreground">{task.state}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{status?.sessionName ?? "no task in this session"}</span>
          )}
        </span>
        <span className="text-muted-foreground">⟳ AUTO</span>
        <Connection state={connection} />
      </div>
    </header>
  )
}
