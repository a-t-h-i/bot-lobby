/**
 * The Lobby tab: the task header, the runs strip, the conversation and
 * activity cards side by side on wide windows and stacked on narrow ones, and
 * the thinking card under both. Activity and Thinking can be minimized to
 * their title bar (remembered in this browser; `Alt+A` and `Alt+T` do it from the keyboard), and the cards glide to their
 * new places. The panes switched off in Settings stay away. Data comes from
 * the `lobby` and `status` topics, kept fresh by the event stream; the
 * composer floats over the window from the shell.
 */
import { motion } from "motion/react"
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { Spinner } from "@/components/ui/spinner"
import { useCollapsed } from "@/lib/collapsed"
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

const GLIDE = { type: "spring", stiffness: 420, damping: 38 } as const

export function LobbyTab() {
  const lobby = useTopic<LobbySnapshot>("lobby")
  const status = useTopic<StatusInfo>("status")
  const [activityFolded, toggleActivity] = useCollapsed("lobby.activity")
  const [thinkingFolded, toggleThinking] = useCollapsed("lobby.thinking")
  const data = lobby.data
  const keyOf = (action: string) => status.data?.keys.find((info) => info.action === action)?.label
  const panes = status.data?.panels ?? { conversation: true, activity: true, thinking: true }
  // An expanded Activity sits beside the conversation; a minimized one drops to a bar under it.
  const sideActivity = panes.activity && !activityFolded
  const showMain = panes.conversation || sideActivity
  const both = panes.conversation && sideActivity
  if (!data && lobby.loading) return <LobbyLoading />
  if (!data && lobby.error) return <ErrorState message={lobby.error} onRetry={() => lobbyStore.onHello({})} />
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-2">
      <TaskHeader task={data?.task} status={status.data} />
      <RunsStrip runs={runsOf(data)} />
      {showMain ? (
        <motion.div layout="position" transition={GLIDE} className={`grid min-h-0 flex-1 gap-4 ${both ? "grid-rows-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:grid-rows-1" : "grid-rows-1"}`}>
          {panes.conversation ? (
            <Conversation
              chat={data?.chat ?? []}
              reply={data?.reply}
              busy={status.data?.busy ?? false}
              hasOlder={data?.hasOlderChat ?? false}
              hasTask={Boolean(data?.task)}
            />
          ) : null}
          {sideActivity ? <ActivityLog entries={data?.activity ?? []} collapsed={false} onToggle={toggleActivity} shortcut={keyOf("activity")} /> : null}
        </motion.div>
      ) : null}
      {panes.activity && activityFolded ? (
        <motion.div layout="position" transition={GLIDE} className="shrink-0">
          <ActivityLog entries={data?.activity ?? []} collapsed onToggle={toggleActivity} shortcut={keyOf("activity")} />
        </motion.div>
      ) : null}
      {panes.thinking ? (
        <motion.div layout="position" transition={GLIDE} className="shrink-0">
          <Thoughts thoughts={data?.thoughts ?? []} collapsed={thinkingFolded} onToggle={toggleThinking} shortcut={keyOf("thinking")} />
        </motion.div>
      ) : null}
    </div>
  )
}
