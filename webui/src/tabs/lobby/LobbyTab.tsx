/* Expanded panes share the content grid; folded panes live only in the side rail. */
import { Activity, Brain, type LucideIcon } from "lucide-react"
import { ErrorState } from "@/app/States"
import { useTopic } from "@/app/hooks"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCollapsed } from "@/lib/collapsed"
import { lobbyStore } from "@/lib/store"
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

function RailButton({ name, icon: Icon, shortcut, onClick }: { name: string; icon: LucideIcon; shortcut?: string; onClick: () => void }) {
  return <Tooltip>
    <TooltipTrigger asChild><Button variant="ghost" className="size-10 shrink-0" aria-label={`Expand ${name}`} onClick={onClick}><Icon aria-hidden="true" className="size-4" /></Button></TooltipTrigger>
    <TooltipContent side="left">Expand {name}{shortcut ? ` (${shortcut})` : ""}</TooltipContent>
  </Tooltip>
}

function SideRail(props: LobbyViewProps) {
  const panes = panesOf(props.status)
  return <aside aria-label="Minimized panes" className="flex w-10 shrink-0 flex-col border-l border-border">
    {panes.activity && props.activityFolded ? <RailButton name="Activity" icon={Activity} shortcut={keyOf(props.status, "activity")} onClick={props.toggleActivity} /> : null}
    {panes.thinking && props.thinkingFolded ? <RailButton name="Thinking" icon={Brain} shortcut={keyOf(props.status, "thinking")} onClick={props.toggleThinking} /> : null}
  </aside>
}

function MainPanes(props: LobbyViewProps) {
  const { data, status, activityFolded, toggleActivity } = props
  const panes = panesOf(status)
  const activity = panes.activity && !activityFolded
  if (!panes.conversation && !activity) return null
  return <div className={`grid min-h-0 flex-1 gap-4 ${panes.conversation && activity ? "grid-rows-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:grid-rows-1" : "grid-rows-1"}`}>
    {panes.conversation ? <Conversation chat={data?.chat ?? []} reply={data?.reply} busy={status?.busy ?? false} hasOlder={data?.hasOlderChat ?? false} hasTask={Boolean(data?.task)} /> : null}
    {activity ? <ActivityLog entries={data?.activity ?? []} collapsed={false} onToggle={toggleActivity} shortcut={keyOf(status, "activity")} /> : null}
  </div>
}

function LobbyView(props: LobbyViewProps) {
  const { data, status } = props
  const panes = panesOf(status)
  const rail = (panes.activity && props.activityFolded) || (panes.thinking && props.thinkingFolded)
  return <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-2">
    <TaskHeader task={data?.task} status={status} />
    <RunsStrip runs={runsOf(data)} />
    <div className="flex min-h-0 flex-1 gap-2">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <MainPanes {...props} />
        {panes.thinking && !props.thinkingFolded ? <Thoughts thoughts={data?.thoughts ?? []} collapsed={false} onToggle={props.toggleThinking} shortcut={keyOf(status, "thinking")} /> : null}
      </div>
      {rail ? <SideRail {...props} /> : null}
    </div>
  </div>
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
