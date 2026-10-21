/*
 * The Lobby: the chat with the team (the oracle and, when a message is
 * theirs, the other agents), the agents' activity folded in place between its
 * messages (Alt+A opens or folds every run of steps). One column at every
 * width. Thinking is not a pane: its orb floats over every
 * page (see `app/Thinking.tsx`).
 */
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { Spinner } from "@/components/ui/spinner"
import { lobbyStore } from "@/lib/store"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { Conversation } from "./Conversation"
import type { ActivityEntry } from "./types"

const panesOf = (status?: StatusInfo) => status?.panels ?? { conversation: true, activity: true, thinking: true }

function LobbyView({ data, status }: { data?: LobbySnapshot; status?: StatusInfo }) {
  const panes = panesOf(status)
  if (!panes.conversation) return null
  const activity = panes.activity ? (data?.activity as ActivityEntry[] | undefined) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation
        chat={data?.chat ?? []}
        {...(activity ? { activity } : {})}
        reply={data?.reply}
        busy={status?.busy ?? false}
        {...(data?.answering ? { answering: data.answering } : {})}
        hasOlder={data?.hasOlderChat ?? false}
        hasTask={Boolean(data?.task)}
      />
    </div>
  )
}

export function LobbyTab() {
  const lobby = useTopic<LobbySnapshot>("lobby")
  const status = useTopic<StatusInfo>("status")
  if (!lobby.data && lobby.loading) return <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner /><span>Connecting…</span></div>
  if (!lobby.data && lobby.error) return <ErrorState message={lobby.error} onRetry={() => lobbyStore.onHello({})} />
  return <LobbyView data={lobby.data} status={status.data} />
}
