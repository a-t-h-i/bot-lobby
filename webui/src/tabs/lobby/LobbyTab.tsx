/*
 * The Lobby. From 1024 px the Conversation and the Activity log sit side by
 * side; Activity folds away into a button in the side rail (Alt+A). Thinking is
 * not a pane: it opens from a floating bubble in a dialog (Alt+T). Below 1024
 * px there is room for one pane at a time, so a switcher picks between them.
 */
import { useState } from "react"
import { Activity, MessageSquare, type LucideIcon } from "lucide-react"
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { Keys } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCollapsed } from "@/lib/collapsed"
import { lobbyStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { useWide } from "@/ui/SplitPane"
import type { LobbySnapshot, StatusInfo } from "@protocol"
import { ActivityLog } from "./ActivityLog"
import { Conversation } from "./Conversation"
import { RunsStrip } from "./RunsStrip"
import { TaskHeader } from "./TaskHeader"
import { Thoughts } from "./Thoughts"
import { runsOf } from "./types"

interface LobbyViewProps {
  data?: LobbySnapshot
  status?: StatusInfo
  activityFolded: boolean
  thinkingFolded: boolean
  toggleActivity: () => void
  toggleThinking: () => void
}
const keyOf = (status: StatusInfo | undefined, action: string) => status?.keys.find((key) => key.action === action)?.label
const panesOf = (status?: StatusInfo) => status?.panels ?? { conversation: true, activity: true, thinking: true }

function RailButton({ name, icon: Icon, shortcut, onClick }: { name: string; icon: LucideIcon; shortcut?: string | undefined; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Expand ${name}`}
          aria-expanded={false}
          aria-keyshortcuts={shortcut}
          onClick={onClick}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 ease-snap outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-95"
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        Expand {name}
        {shortcut ? <Keys chord={shortcut} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}

function SideRail(props: LobbyViewProps) {
  const panes = panesOf(props.status)
  return (
    <aside aria-label="Minimized panes" className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-border py-2">
      {panes.activity && props.activityFolded ? <RailButton name="Activity" icon={Activity} shortcut={keyOf(props.status, "activity")} onClick={props.toggleActivity} /> : null}
    </aside>
  )
}

function MainPanes(props: LobbyViewProps) {
  const { data, status, activityFolded, toggleActivity } = props
  const panes = panesOf(status)
  const activity = panes.activity && !activityFolded
  if (!panes.conversation && !activity) return null
  const both = panes.conversation && activity
  return (
    <div className={cn("grid min-h-0 flex-1", both ? "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] divide-x divide-border" : "grid-cols-1")}>
      {panes.conversation ? <Conversation chat={data?.chat ?? []} reply={data?.reply} busy={status?.busy ?? false} hasOlder={data?.hasOlderChat ?? false} hasTask={Boolean(data?.task)} /> : null}
      {activity ? <ActivityLog entries={data?.activity ?? []} collapsed={false} onToggle={toggleActivity} shortcut={keyOf(status, "activity")} /> : null}
    </div>
  )
}

function WideView(props: LobbyViewProps) {
  const { status } = props
  const panes = panesOf(status)
  const rail = panes.activity && props.activityFolded
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MainPanes {...props} />
      </div>
      {rail ? <SideRail {...props} /> : null}
    </div>
  )
}

type Pane = "conversation" | "activity"

/** One pane at a time on a small screen: a switcher with a hint of what is going on in the others. */
function NarrowView({ data, status }: LobbyViewProps) {
  const panes = panesOf(status)
  const available: Array<{ id: Pane; label: string; icon: LucideIcon }> = [
    ...(panes.conversation ? [{ id: "conversation" as const, label: "Conversation", icon: MessageSquare }] : []),
    ...(panes.activity ? [{ id: "activity" as const, label: "Activity", icon: Activity }] : []),
  ]
  const [picked, setPicked] = useState<Pane>("conversation")
  const view = available.find((entry) => entry.id === picked) ?? available[0]
  const running = (data?.activity ?? []).filter((entry) => entry.pending).length
  if (!view) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {available.length > 1 ? (
        <div role="radiogroup" aria-label="Pane" className="flex shrink-0 items-center gap-0.5 border-b border-border px-3 py-2">
          {available.map((entry) => {
            const on = entry.id === view.id
            const Icon = entry.icon
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPicked(entry.id)}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
                  on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {entry.label}
                {entry.id === "activity" && running > 0 ? <Spinner aria-hidden="true" role="presentation" className="size-3" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      {view.id === "conversation" ? <Conversation chat={data?.chat ?? []} reply={data?.reply} busy={status?.busy ?? false} hasOlder={data?.hasOlderChat ?? false} hasTask={Boolean(data?.task)} bare /> : null}
      {view.id === "activity" ? <ActivityLog entries={data?.activity ?? []} collapsed={false} bare /> : null}
    </div>
  )
}

function LobbyView(props: LobbyViewProps) {
  const { data, status } = props
  const wide = useWide()
  const panes = panesOf(status)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border">
        <TaskHeader task={data?.task} status={status} />
        <RunsStrip runs={runsOf(data)} />
      </div>
      {wide ? <WideView {...props} /> : <NarrowView {...props} />}
      {panes.thinking ? <Thoughts thoughts={data?.thoughts ?? []} collapsed={props.thinkingFolded} onToggle={props.toggleThinking} shortcut={keyOf(status, "thinking")} /> : null}
    </div>
  )
}

export function LobbyTab() {
  const lobby = useTopic<LobbySnapshot>("lobby")
  const status = useTopic<StatusInfo>("status")
  const [activityFolded, toggleActivity] = useCollapsed("lobby.activity")
  const [thinkingFolded, toggleThinking] = useCollapsed("lobby.thinking")
  if (!lobby.data && lobby.loading) return <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner /><span>Connecting…</span></div>
  if (!lobby.data && lobby.error) return <ErrorState message={lobby.error} onRetry={() => lobbyStore.onHello({})} />
  return <LobbyView data={lobby.data} status={status.data} activityFolded={activityFolded} thinkingFolded={thinkingFolded} toggleActivity={toggleActivity} toggleThinking={toggleThinking} />
}
