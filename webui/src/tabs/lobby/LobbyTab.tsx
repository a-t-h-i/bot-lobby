/**
 * The Lobby tab (batch-1 §c): the task header, the runs strip, the
 * conversation and activity panes side by side at ≥ 1024 px and stacked
 * below it, and the thinking pane under both. Data comes from the `lobby` and
 * `status` topics, kept fresh by the event stream; the composer is docked by
 * the shell.
 */
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { Spinner } from "@/components/ui/spinner"
import { lobbyStore } from "@/lib/store"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { ActivityLog } from "./ActivityLog"
import { Conversation } from "./Conversation"
import { RunsStrip } from "./RunsStrip"
import { TaskHeader } from "./TaskHeader"
import { Thoughts } from "./Thoughts"
import { runsOf } from "./types"

function LobbyLoading() {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      <span>Connecting…</span>
    </div>
  )
}

export function LobbyTab() {
  const lobby = useTopic<LobbySnapshot>("lobby")
  const status = useTopic<StatusInfo>("status")
  const data = lobby.data
  if (!data && lobby.loading) return <LobbyLoading />
  if (!data && lobby.error) return <ErrorState message={lobby.error} onRetry={() => lobbyStore.onHello({})} />
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 px-[1ch] pb-1">
      <TaskHeader task={data?.task} status={status.data} />
      <RunsStrip runs={runsOf(data)} />
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-x-[1ch] lg:grid-rows-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Conversation
          chat={data?.chat ?? []}
          reply={data?.reply}
          busy={status.data?.busy ?? false}
          hasOlder={data?.hasOlderChat ?? false}
          hasTask={Boolean(data?.task)}
        />
        <ActivityLog entries={data?.activity ?? []} />
      </div>
      <Thoughts thoughts={data?.thoughts ?? []} />
    </div>
  )
}
